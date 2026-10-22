import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { MockConnector, MOCK_ORGANIZATIONS } from "@/lib/connectors/mock";
import { exportInvoice, getExportContext, type ExportChoices, type ExportContext } from "@/lib/invoices/export";
import { sampleInvoice } from "@/lib/invoice/sample";
import { getInvoice, ingestFile, saveReview } from "@/lib/invoices/service";
import { listSupplierProducts } from "@/lib/products/service";
import { listSuppliers } from "@/lib/suppliers/service";

// In-memory libSQL + GEMINI_MOCK + DESTINATION_MOCK (see vitest.config.mts).
beforeAll(async () => {
  await migrate(db(), { migrationsFolder: "./drizzle" });
});
beforeEach(() => MockConnector.reset());

const ALPHA = `zoho-books:${MOCK_ORGANIZATIONS[0].id}`;
const BETA = `zoho-books:${MOCK_ORGANIZATIONS[1].id}`;
const mock = (key = ALPHA) => new MockConnector(MOCK_ORGANIZATIONS.find((o) => `zoho-books:${o.id}` === key)!);

let n = 0;
async function reviewedInvoice(patch: Partial<typeof sampleInvoice> = {}) {
  const { id } = await ingestFile({ data: Buffer.from(`%PDF-1.4\n% export ${n++}\n%%EOF`), filename: "x.pdf" });
  // Fix the sample's deliberately wrong line before "saving the review".
  const lineItems = sampleInvoice.lineItems.map((l, i) => (i === 1 ? { ...l, lineTotal: 256.21 } : l));
  await saveReview(id, { ...sampleInvoice, lineItems, ...patch });
  return id;
}

/** What a user accepting every suggestion would send. */
function accept(ctx: ExportContext, patch: Partial<ExportChoices> = {}): ExportChoices {
  return {
    supplier: {
      externalId: ctx.linked?.externalId ?? ctx.candidates.find((c) => c.exact)?.externalId ?? null,
      updateFields: [],
      updateExternal: false,
    },
    destination: ctx.destination.key,
    taxes: Object.fromEntries(ctx.rates.map((r) => [r.key, r.suggestedTaxId])),
    lines: ctx.lines.map((l) => ({ item: l.suggested, accountId: ctx.defaultAccountId ?? "a-cogs" })),
    force: false,
    ...patch,
  };
}

describe("export flow", () => {
  it("is unavailable until the review is saved", async () => {
    const { id } = await ingestFile({ data: Buffer.from("%PDF-1.4\n% unreviewed\n%%EOF"), filename: "u.pdf" });
    expect(await getExportContext(id)).toBeNull();
    await expect(
      exportInvoice(id, {
        supplier: { externalId: null, updateFields: [], updateExternal: false },
        destination: ALPHA,
        taxes: {},
        lines: [],
      }),
    ).rejects.toThrow("Save the review");
  });

  it("picks the organization from the buyer ΑΦΜ", async () => {
    const id = await reviewedInvoice({ invoiceNumber: "ORG-1" });
    const ctx = (await getExportContext(id))!;
    expect(ctx.destination.key).toBe(ALPHA);
    expect(ctx.matchedBuyer).toBe(true);
    expect(ctx.destinations.map((d) => d.key)).toEqual([ALPHA, BETA]);

    const beta = await reviewedInvoice({ invoiceNumber: "ORG-2", buyer: { name: "Beta", taxId: "800000002" } });
    expect((await getExportContext(beta))!.destination.key).toBe(BETA);

    // An explicit choice wins.
    expect((await getExportContext(id, BETA))!.destination.key).toBe(BETA);
  });

  it("matches vendor, taxes and items, creates missing items and records products", async () => {
    const id = await reviewedInvoice();
    const ctx = (await getExportContext(id))!;

    expect(ctx.local).toBeNull(); // first time we see this supplier
    expect(ctx.candidates[0]).toMatchObject({ externalId: "v-1001", exact: true }); // "S.A." vs "SA"
    expect(ctx.rates).toEqual([{ key: "24", label: "24%", suggestedTaxId: "t-24" }]);
    expect(ctx.lines.map((l) => l.suggested)).toEqual([
      { mode: "item", itemId: "i-2001" }, // via the item's purchase description
      { mode: "item", itemId: "i-2002" }, // "Toner cartridge HP 26A" ~ "Toner HP 26A black"
      { mode: "new", name: "Delivery", sku: null },
    ]);
    expect(ctx.lines.every((l) => !l.knownProduct)).toBe(true);

    const choices = accept(ctx);
    choices.lines[2].item = { mode: "new", name: "Μεταφορικά", sku: "SHIP" };
    const result = await exportInvoice(id, choices);
    expect(result.externalId).toMatch(/^b-/);
    expect(await getInvoice(id)).toMatchObject({ status: "exported", destination: ALPHA });

    const store = mock().store;
    expect(store.items.at(-1)).toMatchObject({ name: "Μεταφορικά", sku: "SHIP", vendorId: "v-1001", purchaseAccountId: "a-cogs" });
    const createdId = store.items.at(-1)!.id;
    expect(store.bills[0].mapping.lines.map((l) => l.itemId)).toEqual(["i-2001", "i-2002", createdId]);

    const supplier = (await listSuppliers()).find((s) => s.supplier.name === sampleInvoice.supplier.name)!;
    const products = await listSupplierProducts(supplier.supplier.id);
    expect(products.map((p) => [p.product.supplierCode, p.product.timesSeen, p.links[0]?.externalItemId])).toEqual([
      ["PAP-A4-80", 1, "i-2001"],
      [null, 1, createdId], // "Delivery" has no supplier code: identified by description
      ["TON-HP26A", 1, "i-2002"],
    ]);
  });

  it("reuses product links next time, per organization", async () => {
    const first = await reviewedInvoice({ invoiceNumber: "P-1" });
    const ctx1 = (await getExportContext(first))!;
    const choices = accept(ctx1);
    choices.lines[0].item = { mode: "item", itemId: "i-2003" }; // user overrides the suggestion
    await exportInvoice(first, choices);

    const second = await reviewedInvoice({ invoiceNumber: "P-2" });
    const ctx2 = (await getExportContext(second))!;
    expect(ctx2.lines[0]).toMatchObject({ knownProduct: true, linkedItem: { id: "i-2003" }, suggested: { mode: "item", itemId: "i-2003" } });
    expect(ctx2.lines[2].linkedItem?.name).toBe("Delivery");

    // The other organization has its own catalogue: known product, but no link there.
    const inBeta = (await getExportContext(second, BETA))!;
    expect(inBeta.lines[0]).toMatchObject({ knownProduct: true, linkedItem: null });
  });

  it("recognises the supplier next time, remembers choices and reports changed details", async () => {
    const seed = await reviewedInvoice({ invoiceNumber: "S-1" });
    await exportInvoice(seed, accept((await getExportContext(seed))!));

    const id = await reviewedInvoice({
      invoiceNumber: "S-2",
      supplier: { ...sampleInvoice.supplier, taxId: "094012345", email: "new-billing@northwind.example" },
    });
    const ctx = (await getExportContext(id))!;
    expect(ctx.local).toMatchObject({ matchedBy: "taxId" }); // EL prefix or not, same ΑΦΜ
    expect(ctx.local?.changes).toEqual([
      { field: "email", current: "billing@northwind.example", incoming: "new-billing@northwind.example" },
    ]);
    expect(ctx.linked?.externalId).toBe("v-1001");
    expect(ctx.defaultAccountId).toBe("a-cogs");

    await exportInvoice(id, accept(ctx, { supplier: { externalId: "v-1001", updateFields: ["email"], updateExternal: true } }));
    const after = (await listSuppliers()).find((s) => s.supplier.name === sampleInvoice.supplier.name);
    expect(after?.supplier.email).toBe("new-billing@northwind.example");
    expect(mock().store.vendors.find((v) => v.externalId === "v-1001")?.email).toBe("new-billing@northwind.example");
  });

  it("blocks a duplicate supplier + invoice number unless forced", async () => {
    const id = await reviewedInvoice({ invoiceNumber: "INV-DUP" });
    await exportInvoice(id, accept((await getExportContext(id))!));

    const copy = await reviewedInvoice({ invoiceNumber: "INV-DUP" });
    const ctx = (await getExportContext(copy))!;
    expect(ctx.duplicates).toEqual([{ id, invoiceNumber: "INV-DUP" }]);
    await expect(exportInvoice(copy, accept(ctx))).rejects.toThrow("already exported");
    await expect(exportInvoice(copy, accept(ctx, { force: true }))).resolves.toMatchObject({ externalId: expect.any(String) });
  });

  it("creates a new vendor when none matches, and records failures", async () => {
    const id = await reviewedInvoice({
      invoiceNumber: "INV-NEW",
      supplier: { ...sampleInvoice.supplier, name: "Νέος Προμηθευτής Ε.Π.Ε.", taxId: "EL999999999" },
    });
    const ctx = (await getExportContext(id))!;
    expect(ctx.candidates).toEqual([]);

    const bad = accept(ctx);
    bad.lines[2].item = { mode: "new", name: "Stapler heavy duty", sku: null }; // name already taken in Zoho
    await expect(exportInvoice(id, bad)).rejects.toThrow("already exists");

    await exportInvoice(id, accept(ctx));
    expect(mock().store.vendors.at(-1)).toMatchObject({ name: "Νέος Προμηθευτής Ε.Π.Ε.", currency: "EUR" });
    expect((await getExportContext(id))!.history.map((h) => h.status)).toEqual(["success", "failed"]);
  });
});

import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { MockConnector } from "@/lib/connectors/mock";
import { exportInvoice, getExportContext, type ExportChoices } from "@/lib/invoices/export";
import { sampleInvoice } from "@/lib/invoice/sample";
import { getInvoice, ingestFile, saveReview } from "@/lib/invoices/service";
import { listSuppliers } from "@/lib/suppliers/service";

// In-memory libSQL + GEMINI_MOCK + DESTINATION_MOCK (see vitest.config.mts).
beforeAll(async () => {
  await migrate(db(), { migrationsFolder: "./drizzle" });
});
beforeEach(() => MockConnector.reset());

let n = 0;
async function reviewedInvoice(patch: Partial<typeof sampleInvoice> = {}) {
  const { id } = await ingestFile({ data: Buffer.from(`%PDF-1.4\n% export ${n++}\n%%EOF`), filename: "x.pdf" });
  await saveReview(id, { ...sampleInvoice, ...patch });
  return id;
}

function choicesFrom(ctx: NonNullable<Awaited<ReturnType<typeof getExportContext>>>, patch: Partial<ExportChoices> = {}): ExportChoices {
  return {
    supplier: { externalId: ctx.linked?.externalId ?? ctx.candidates.find((c) => c.exact)?.externalId ?? null, updateFields: [], updateExternal: false },
    taxes: Object.fromEntries(ctx.rates.map((r) => [r.key, r.suggestedTaxId])),
    lineAccountIds: ctx.invoice.lineItems.map(() => "a-office"),
    force: false,
    ...patch,
  };
}

describe("export flow", () => {
  it("is unavailable until the review is saved", async () => {
    const { id } = await ingestFile({ data: Buffer.from("%PDF-1.4\n% unreviewed\n%%EOF"), filename: "u.pdf" });
    expect(await getExportContext(id)).toBeNull();
    await expect(exportInvoice(id, { supplier: { externalId: null, updateFields: [], updateExternal: false }, taxes: {}, lineAccountIds: [] }))
      .rejects.toThrow("Save the review");
  });

  it("matches the vendor by normalized name, maps taxes by rate and exports", async () => {
    const id = await reviewedInvoice();
    const ctx = (await getExportContext(id))!;

    expect(ctx.local).toBeNull(); // first time we see this supplier
    expect(ctx.candidates[0]).toMatchObject({ externalId: "v-1001", exact: true }); // "S.A." vs "SA"
    expect(ctx.rates).toEqual([{ key: "24", label: "24%", suggestedTaxId: "t-24" }]);

    const result = await exportInvoice(id, choicesFrom(ctx));
    expect(result.externalId).toMatch(/^b-/);
    expect(await getInvoice(id)).toMatchObject({ status: "exported" });

    const bill = new MockConnector().store.bills[0];
    expect(bill).toMatchObject({ vendorId: "v-1001", number: sampleInvoice.invoiceNumber });
    expect(bill.mapping.taxes).toEqual({ "24": "t-24" });

    const suppliers = await listSuppliers();
    expect(suppliers.find((s) => s.supplier.name === sampleInvoice.supplier.name)).toMatchObject({ externalId: "v-1001" });
  });

  it("recognises the supplier next time, remembers choices and reports changed details", async () => {
    const id = await reviewedInvoice({
      invoiceNumber: "INV-NEXT",
      supplier: { ...sampleInvoice.supplier, email: "new-billing@northwind.example" },
    });
    const ctx = (await getExportContext(id))!;
    expect(ctx.local).toMatchObject({ matchedBy: "taxId" });
    expect(ctx.local?.changes).toEqual([
      { field: "email", current: "billing@northwind.example", incoming: "new-billing@northwind.example" },
    ]);
    expect(ctx.linked?.externalId).toBe("v-1001");
    expect(ctx.defaultAccountId).toBe("a-office");

    await exportInvoice(id, choicesFrom(ctx, { supplier: { externalId: "v-1001", updateFields: ["email"], updateExternal: true } }));
    const after = (await listSuppliers()).find((s) => s.supplier.name === sampleInvoice.supplier.name);
    expect(after?.supplier.email).toBe("new-billing@northwind.example");
    expect(new MockConnector().store.vendors.find((v) => v.externalId === "v-1001")?.email).toBe("new-billing@northwind.example");
  });

  it("blocks a duplicate supplier + invoice number unless forced", async () => {
    const id = await reviewedInvoice({ invoiceNumber: "INV-DUP" });
    await exportInvoice(id, choicesFrom((await getExportContext(id))!));

    const copy = await reviewedInvoice({ invoiceNumber: "INV-DUP" });
    const ctx = (await getExportContext(copy))!;
    expect(ctx.duplicates).toEqual([{ id, invoiceNumber: "INV-DUP" }]);
    await expect(exportInvoice(copy, choicesFrom(ctx))).rejects.toThrow("already exported");
    await expect(exportInvoice(copy, choicesFrom(ctx, { force: true }))).resolves.toMatchObject({ externalId: expect.any(String) });
  });

  it("creates a new vendor when none matches, and records failures", async () => {
    const id = await reviewedInvoice({
      invoiceNumber: "INV-NEW",
      supplier: { ...sampleInvoice.supplier, name: "Brand New Vendor Ltd", taxId: "GB999" },
    });
    const ctx = (await getExportContext(id))!;
    expect(ctx.candidates).toEqual([]);

    await expect(exportInvoice(id, choicesFrom(ctx, { lineAccountIds: ["a-office"] }))).rejects.toThrow("account for every line");

    await exportInvoice(id, choicesFrom(ctx));
    const vendor = new MockConnector().store.vendors.at(-1);
    expect(vendor).toMatchObject({ name: "Brand New Vendor Ltd", currency: "EUR" });
    expect((await getExportContext(id))!.history.map((h) => h.status)).toEqual(["success"]);
  });
});

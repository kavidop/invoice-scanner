import "server-only";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import {
  configuredExpenseAccount,
  destinationForBuyer,
  getConnector,
  listDestinations,
  rateKey,
  type Destination,
  type ExternalAccount,
  type ExternalItem,
  type ExternalSupplier,
  type ExternalTax,
} from "@/lib/connectors";
import type { Invoice } from "@/lib/invoice/schema";
import { SUPPORTED_FILE_TYPES } from "@/lib/ingest/mime";
import { fileStorage } from "@/lib/storage";
import { AUTO_MATCH_SCORE, matchItems, type ItemCandidate } from "@/lib/products/match";
import { findProduct, getProductLinks, recordProducts } from "@/lib/products/service";
import { normalizeName } from "@/lib/suppliers/normalize";
import {
  findLocalSupplier,
  getSupplierLink,
  saveSupplier,
  saveSupplierLink,
  SUPPLIER_FIELDS,
  supplierChanges,
  type SupplierChange,
} from "@/lib/suppliers/service";
import { getInvoice } from "./service";

const { invoices, exports, taxMappings } = schema;

export type ExportRow = typeof exports.$inferSelect;

export type RateOption = { key: string; label: string; suggestedTaxId: string | null };

/** What to do with an invoice line in the destination. */
export type LineItemChoice =
  | { mode: "item"; itemId: string }
  | { mode: "new"; name: string; sku: string | null }
  | { mode: "none" };

export type LineContext = {
  /** The supplier's product was seen on an earlier invoice. */
  knownProduct: boolean;
  /** Item this product was mapped to before, in this organization. */
  linkedItem: ExternalItem | null;
  candidates: ItemCandidate[];
  suggested: LineItemChoice;
  /** Prefill for "create a new item". */
  newItem: { name: string; sku: string | null };
};

export type ExportContext = {
  destination: Destination;
  destinations: Destination[];
  /** The destination was picked because its ΑΦΜ is the invoice's buyer. */
  matchedBuyer: boolean;
  invoice: Invoice;
  /** Our own supplier record, if this supplier was seen before. */
  local: { id: string; name: string; matchedBy: "taxId" | "name"; changes: SupplierChange[] } | null;
  /** Vendor already linked to the local supplier. */
  linked: ExternalSupplier | null;
  /** Vendors found by searching the destination (when not linked). */
  candidates: (ExternalSupplier & { exact: boolean })[];
  taxes: ExternalTax[];
  accounts: ExternalAccount[];
  rates: RateOption[];
  defaultAccountId: string | null;
  items: ExternalItem[];
  lines: LineContext[];
  /** Other invoices from this supplier with the same number that were already exported. */
  duplicates: { id: string; invoiceNumber: string | null }[];
  history: ExportRow[];
};

export class ExportError extends Error {
  constructor(
    message: string,
    readonly duplicateUrl?: string,
  ) {
    super(message);
  }
}

/** Distinct tax rates used on the invoice; "none" for lines without tax. */
function invoiceRates(invoice: Invoice) {
  const rates = new Map<string, number | null>();
  for (const line of invoice.lineItems) {
    const rate = line.taxes[0]?.rate ?? null;
    rates.set(rateKey(rate), rate);
  }
  return rates;
}

async function rememberedTaxes(destination: string) {
  const rows = await db().select().from(taxMappings).where(eq(taxMappings.destination, destination));
  return new Map(rows.map((r) => [r.rateKey, r.externalTaxId]));
}

/** Everything the export panel needs. Calls the destination, so it can be slow or throw. */
export async function getExportContext(invoiceId: string, destinationKey?: string): Promise<ExportContext | null> {
  const row = await getInvoice(invoiceId);
  if (!row?.reviewed) return null;
  const invoice = row.reviewed;

  const byBuyer = destinationForBuyer(invoice.buyer?.taxId);
  const destinations = listDestinations();
  const destination =
    destinations.find((d) => d.key === (destinationKey ?? row.destination)) ?? byBuyer;
  const connector = getConnector(destination.key);

  const match = await findLocalSupplier(invoice.supplier);
  const link = match ? await getSupplierLink(match.supplier.id, connector.id) : undefined;

  const [taxes, accounts, remembered, searchResults, items] = await Promise.all([
    connector.listTaxes(),
    connector.listExpenseAccounts(),
    rememberedTaxes(connector.id),
    connector.searchSuppliers(invoice.supplier),
    connector.listItems(),
  ]);

  const target = normalizeName(invoice.supplier.name);
  const email = invoice.supplier.email?.toLowerCase();
  const candidates = searchResults.map((c) => ({
    ...c,
    exact: normalizeName(c.name) === target || (!!email && c.email?.toLowerCase() === email),
  }));
  const linked = link
    ? (searchResults.find((c) => c.externalId === link.externalId) ?? { externalId: link.externalId, name: match!.supplier.name })
    : null;

  const rates = [...invoiceRates(invoice)].map(([key, rate]): RateOption => {
    const rememberedId = remembered.get(key);
    const byRate = rate === null ? null : (taxes.find((t) => Math.abs(t.rate - rate) < 0.001)?.id ?? null);
    const suggested = rememberedId !== undefined && (rememberedId === null || taxes.some((t) => t.id === rememberedId))
      ? rememberedId
      : byRate;
    return { key, label: rate === null ? "No tax" : `${rate}%`, suggestedTaxId: suggested };
  });

  const accountIds = new Set(accounts.map((a) => a.id));
  const defaultAccountId =
    [link?.defaultAccountId, configuredExpenseAccount(connector.id)].find((id) => id && accountIds.has(id)) ?? null;

  const lines = await lineContexts(invoice, match?.supplier.id ?? null, connector.id, items);

  const duplicates = match
    ? await db()
        .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
        .from(invoices)
        .where(
          and(
            eq(invoices.supplierId, match.supplier.id),
            eq(invoices.invoiceNumber, invoice.invoiceNumber),
            eq(invoices.status, "exported"),
            ne(invoices.id, invoiceId),
          ),
        )
    : [];

  return {
    destination,
    destinations,
    matchedBuyer: destination.key === byBuyer.key && !!byBuyer.taxId && !!invoice.buyer?.taxId,
    invoice,
    local: match
      ? {
          id: match.supplier.id,
          name: match.supplier.name,
          matchedBy: match.matchedBy,
          changes: supplierChanges(match.supplier, invoice.supplier),
        }
      : null,
    linked,
    candidates,
    taxes,
    accounts,
    rates,
    defaultAccountId,
    items,
    lines,
    duplicates,
    history: await exportHistory(invoiceId),
  };
}

async function lineContexts(
  invoice: Invoice,
  supplierId: string | null,
  destination: string,
  items: ExternalItem[],
): Promise<LineContext[]> {
  const known = supplierId ? await Promise.all(invoice.lineItems.map((line) => findProduct(supplierId, line))) : [];
  const links = await getProductLinks(
    known.flatMap((p) => (p ? [p.id] : [])),
    destination,
  );

  return invoice.lineItems.map((line, i) => {
    const product = known[i];
    const link = product ? links.get(product.id) : undefined;
    // A linked item that was deleted in Zoho no longer counts.
    const linkedItem = link ? (items.find((it) => it.id === link.externalItemId) ?? null) : null;
    const candidates = matchItems(line, items).filter((c) => c.id !== linkedItem?.id);
    const best = candidates[0];

    const suggested: LineItemChoice = linkedItem
      ? { mode: "item", itemId: linkedItem.id }
      : best && (best.reason === "code" || best.score >= AUTO_MATCH_SCORE)
        ? { mode: "item", itemId: best.id }
        : { mode: "new", name: line.description.slice(0, 100), sku: line.sku };

    return {
      knownProduct: !!product,
      linkedItem,
      candidates,
      suggested,
      newItem: { name: line.description.slice(0, 100), sku: line.sku },
    };
  });
}

export async function exportHistory(invoiceId: string) {
  // created_at has second resolution; rowid keeps insertion order within a second.
  return db()
    .select()
    .from(exports)
    .where(eq(exports.invoiceId, invoiceId))
    .orderBy(desc(exports.createdAt), desc(sql`rowid`));
}

export const ExportChoicesSchema = z.object({
  supplier: z.object({
    /** Existing vendor in the destination, or null to create one. */
    externalId: z.string().min(1).nullable(),
    /** Fields to copy from the invoice onto the stored supplier. */
    updateFields: z.array(z.enum(SUPPLIER_FIELDS)),
    /** Also push the supplier details to the existing vendor. */
    updateExternal: z.boolean(),
  }),
  /** Destination organization key, e.g. "zoho-books:20012345". */
  destination: z.string().min(1),
  taxes: z.record(z.string(), z.string().nullable()),
  lines: z.array(
    z.object({
      item: z.discriminatedUnion("mode", [
        z.object({ mode: z.literal("item"), itemId: z.string().min(1) }),
        z.object({
          mode: z.literal("new"),
          name: z.string().trim().min(1, "A new item needs a name"),
          sku: z.string().trim().nullable(),
        }),
        z.object({ mode: z.literal("none") }),
      ]),
      /** Account for text lines, and the purchase account of newly created items. */
      accountId: z.string().min(1, "Every line needs an account"),
    }),
  ),
  force: z.boolean().default(false),
});
export type ExportChoices = z.infer<typeof ExportChoicesSchema>;

export async function exportInvoice(invoiceId: string, input: unknown) {
  const choices = ExportChoicesSchema.parse(input);
  const row = await getInvoice(invoiceId);
  if (!row) throw new ExportError("Invoice not found");
  const invoice = row.reviewed;
  if (!invoice) throw new ExportError("Save the review before exporting");
  if (row.status === "exported" && !choices.force) throw new ExportError("This invoice was already exported");
  if (choices.lines.length !== invoice.lineItems.length) {
    throw new ExportError("Choose what to do with every line");
  }
  for (const key of invoiceRates(invoice).keys()) {
    if (!(key in choices.taxes)) throw new ExportError(`Choose a tax for rate ${key}`);
  }

  if (!listDestinations().some((d) => d.key === choices.destination)) {
    throw new ExportError(`Unknown organization: ${choices.destination}`);
  }
  const connector = getConnector(choices.destination);

  // 1. Local supplier: create or update with the fields the user picked.
  const match = await findLocalSupplier(invoice.supplier);
  const supplier = await saveSupplier(
    invoice.supplier,
    match ? { id: match.supplier.id, fields: choices.supplier.updateFields } : undefined,
  );
  await db()
    .update(invoices)
    .set({ supplierId: supplier.id, destination: connector.id })
    .where(eq(invoices.id, invoiceId));

  if (!choices.force) {
    const [dup] = await db()
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.supplierId, supplier.id),
          eq(invoices.invoiceNumber, invoice.invoiceNumber),
          eq(invoices.status, "exported"),
          ne(invoices.id, invoiceId),
        ),
      )
      .limit(1);
    if (dup) throw new ExportError(`Invoice ${invoice.invoiceNumber} from this supplier was already exported`);
  }

  const [attempt] = await db()
    .insert(exports)
    .values({ invoiceId, destination: connector.id, status: "pending", request: choices })
    .returning();

  try {
    // 2. Vendor in the destination.
    let vendorId = choices.supplier.externalId;
    if (vendorId && choices.supplier.updateExternal) {
      await connector.upsertSupplier(invoice.supplier, { externalId: vendorId });
    } else if (!vendorId) {
      vendorId = await connector.upsertSupplier(invoice.supplier, { currency: invoice.currency });
    }

    if (!choices.force) {
      const existing = await connector.findBill(vendorId, invoice.invoiceNumber);
      if (existing) {
        throw new ExportError(
          `${connector.label} already has bill ${invoice.invoiceNumber} for this vendor`,
          existing.externalUrl,
        );
      }
    }

    // 3. Items: existing ones as chosen, new ones created now (they stay even
    //    if the bill fails, and are linked so a retry reuses them).
    const catalogue = await connector.listItems();
    const lineItems: (ExternalItem | null)[] = [];
    for (const [i, { item, accountId }] of choices.lines.entries()) {
      const line = invoice.lineItems[i];
      if (item.mode === "none") {
        lineItems.push(null);
      } else if (item.mode === "item") {
        const found = catalogue.find((c) => c.id === item.itemId);
        if (!found) throw new ExportError(`Line ${i + 1}: the chosen item no longer exists in ${connector.label}`);
        lineItems.push(found);
      } else {
        const created = await connector.createItem({
          name: item.name,
          sku: item.sku || null,
          unit: line.unit,
          purchaseRate: line.unitPrice,
          description: line.description,
          purchaseAccountId: accountId,
          vendorId,
        });
        await recordProducts({
          supplierId: supplier.id,
          invoiceId,
          currency: invoice.currency,
          destination: connector.id,
          lines: [{ line, item: created }],
        });
        lineItems.push(created);
      }
    }

    // 4. The bill, with the original document attached when it's a file.
    const attachment =
      row.storageKey && (SUPPORTED_FILE_TYPES as readonly string[]).includes(row.mimeType ?? "")
        ? await fileStorage().get(row.storageKey)
        : null;
    const result = await connector.createBill(
      invoice,
      vendorId,
      {
        taxes: choices.taxes,
        lines: choices.lines.map((l, i) => ({ itemId: lineItems[i]?.id ?? null, accountId: l.accountId })),
      },
      attachment
        ? {
            data: attachment,
            mimeType: row.mimeType!,
            filename: `${invoice.invoiceNumber.replace(/[^\w.-]+/g, "_")}.${row.storageKey!.split(".").pop()}`,
          }
        : undefined,
    );

    // 5. Record the outcome and remember the choices for next time.
    await db()
      .update(exports)
      .set({ status: "success", externalId: result.externalId, externalUrl: result.externalUrl, response: result })
      .where(eq(exports.id, attempt.id));
    await db().update(invoices).set({ status: "exported" }).where(eq(invoices.id, invoiceId));
    await saveSupplierLink(supplier.id, connector.id, {
      externalId: vendorId,
      defaultAccountId: mostCommon(choices.lines.map((l) => l.accountId)),
    });
    await recordProducts({
      supplierId: supplier.id,
      invoiceId,
      currency: invoice.currency,
      destination: connector.id,
      // Newly created items were recorded when created.
      lines: invoice.lineItems.flatMap((line, i) =>
        choices.lines[i].item.mode === "new" ? [] : [{ line, item: lineItems[i] }],
      ),
    });
    for (const [key, externalTaxId] of Object.entries(choices.taxes)) {
      await db()
        .insert(taxMappings)
        .values({ destination: connector.id, rateKey: key, externalTaxId })
        .onConflictDoUpdate({ target: [taxMappings.destination, taxMappings.rateKey], set: { externalTaxId } });
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db()
      .update(exports)
      .set({ status: "failed", error: message, response: errorBody(err) })
      .where(eq(exports.id, attempt.id));
    throw err instanceof ExportError ? err : new ExportError(message);
  }
}

function mostCommon(values: string[]) {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function errorBody(err: unknown) {
  return err && typeof err === "object" && "body" in err ? (err as { body: unknown }).body : null;
}

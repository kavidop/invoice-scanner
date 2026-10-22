import "server-only";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import {
  getConnector,
  rateKey,
  type ExternalAccount,
  type ExternalSupplier,
  type ExternalTax,
} from "@/lib/connectors";
import type { Invoice } from "@/lib/invoice/schema";
import { SUPPORTED_FILE_TYPES } from "@/lib/ingest/mime";
import { fileStorage } from "@/lib/storage";
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
import { env } from "@/lib/env";
import { getInvoice } from "./service";

const { invoices, exports, taxMappings } = schema;

export type ExportRow = typeof exports.$inferSelect;

export type RateOption = { key: string; label: string; suggestedTaxId: string | null };

export type ExportContext = {
  destination: { id: string; label: string };
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
export async function getExportContext(invoiceId: string): Promise<ExportContext | null> {
  const row = await getInvoice(invoiceId);
  if (!row?.reviewed) return null;
  const invoice = row.reviewed;
  const connector = getConnector();

  const match = await findLocalSupplier(invoice.supplier);
  const link = match ? await getSupplierLink(match.supplier.id, connector.id) : undefined;

  const [taxes, accounts, remembered, searchResults] = await Promise.all([
    connector.listTaxes(),
    connector.listExpenseAccounts(),
    rememberedTaxes(connector.id),
    connector.searchSuppliers(invoice.supplier),
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
    [link?.defaultAccountId, env().ZOHO_EXPENSE_ACCOUNT_ID].find((id) => id && accountIds.has(id)) ?? null;

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
    destination: { id: connector.id, label: connector.label },
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
    duplicates,
    history: await exportHistory(invoiceId),
  };
}

export async function exportHistory(invoiceId: string) {
  return db().select().from(exports).where(eq(exports.invoiceId, invoiceId)).orderBy(desc(exports.createdAt));
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
  taxes: z.record(z.string(), z.string().nullable()),
  lineAccountIds: z.array(z.string().min(1, "Every line needs an account")),
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
  if (choices.lineAccountIds.length !== invoice.lineItems.length) {
    throw new ExportError("Choose an account for every line");
  }
  for (const key of invoiceRates(invoice).keys()) {
    if (!(key in choices.taxes)) throw new ExportError(`Choose a tax for rate ${key}`);
  }

  const connector = getConnector();

  // 1. Local supplier: create or update with the fields the user picked.
  const match = await findLocalSupplier(invoice.supplier);
  const supplier = await saveSupplier(
    invoice.supplier,
    match ? { id: match.supplier.id, fields: choices.supplier.updateFields } : undefined,
  );
  await db().update(invoices).set({ supplierId: supplier.id }).where(eq(invoices.id, invoiceId));

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

    // 3. The bill, with the original document attached when it's a file.
    const attachment =
      row.storageKey && (SUPPORTED_FILE_TYPES as readonly string[]).includes(row.mimeType ?? "")
        ? await fileStorage().get(row.storageKey)
        : null;
    const result = await connector.createBill(
      invoice,
      vendorId,
      { taxes: choices.taxes, lineAccountIds: choices.lineAccountIds },
      attachment
        ? {
            data: attachment,
            mimeType: row.mimeType!,
            filename: `${invoice.invoiceNumber.replace(/[^\w.-]+/g, "_")}.${row.storageKey!.split(".").pop()}`,
          }
        : undefined,
    );

    // 4. Record the outcome and remember the choices for next time.
    await db()
      .update(exports)
      .set({ status: "success", externalId: result.externalId, externalUrl: result.externalUrl, response: result })
      .where(eq(exports.id, attempt.id));
    await db().update(invoices).set({ status: "exported" }).where(eq(invoices.id, invoiceId));
    await saveSupplierLink(supplier.id, connector.id, {
      externalId: vendorId,
      defaultAccountId: mostCommon(choices.lineAccountIds),
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

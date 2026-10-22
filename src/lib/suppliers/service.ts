import "server-only";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Supplier } from "@/lib/invoice/schema";
import { normalizeName, normalizeTaxId } from "./normalize";

const { suppliers, supplierLinks, invoices, products } = schema;

export type SupplierRow = typeof suppliers.$inferSelect;
export type SupplierLinkRow = typeof supplierLinks.$inferSelect;

/** Supplier fields the user can choose to update from a new invoice. */
export const SUPPLIER_FIELDS = ["name", "taxId", "email", "phone", "website", "iban", "address"] as const;
export type SupplierField = (typeof SUPPLIER_FIELDS)[number];

export type SupplierChange = { field: SupplierField; current: string | null; incoming: string | null };

export type LocalMatch = { supplier: SupplierRow; matchedBy: "taxId" | "name" };

export function formatAddress(address: Supplier["address"]): string | null {
  if (!address) return null;
  const text = [address.line1, address.line2, [address.postalCode, address.city].filter(Boolean).join(" "), address.state, address.country]
    .filter(Boolean)
    .join(", ");
  return text || null;
}

function fieldText(s: Pick<Supplier, SupplierField>, field: SupplierField): string | null {
  if (field === "address") return formatAddress(s.address);
  if (field === "taxId") return s.taxId ? normalizeTaxId(s.taxId) : null;
  return s[field] ?? null;
}

/** Tax ID is authoritative; otherwise fall back to the normalized name. */
export async function findLocalSupplier(incoming: Supplier): Promise<LocalMatch | null> {
  if (incoming.taxId) {
    const [byTax] = await db()
      .select()
      .from(suppliers)
      .where(eq(suppliers.taxId, normalizeTaxId(incoming.taxId)))
      .limit(1);
    if (byTax) return { supplier: byTax, matchedBy: "taxId" };
  }
  const [byName] = await db()
    .select()
    .from(suppliers)
    .where(eq(suppliers.normalizedName, normalizeName(incoming.name)))
    .limit(1);
  // A name match with a *different* tax ID is a different company.
  if (byName && !(byName.taxId && incoming.taxId && byName.taxId !== normalizeTaxId(incoming.taxId))) {
    return { supplier: byName, matchedBy: "name" };
  }
  return null;
}

/** Fields where the invoice has a value that differs from what we have stored. */
export function supplierChanges(current: SupplierRow, incoming: Supplier): SupplierChange[] {
  return SUPPLIER_FIELDS.flatMap((field) => {
    const before = fieldText(current, field);
    const after = fieldText(incoming, field);
    if (after === null || after === before) return [];
    if (field === "name" && normalizeName(after) === normalizeName(before ?? "")) return [];
    return [{ field, current: before, incoming: after }];
  });
}

/** Insert a new supplier, or apply the chosen fields from the invoice to an existing one. */
export async function saveSupplier(
  incoming: Supplier,
  existing?: { id: string; fields: SupplierField[] },
): Promise<SupplierRow> {
  const values = {
    name: incoming.name,
    normalizedName: normalizeName(incoming.name),
    taxId: incoming.taxId ? normalizeTaxId(incoming.taxId) : null,
    email: incoming.email,
    phone: incoming.phone,
    website: incoming.website,
    iban: incoming.iban,
    address: incoming.address,
  };

  if (!existing) {
    const [row] = await db().insert(suppliers).values(values).returning();
    return row;
  }

  const patch: Partial<typeof values> = {};
  for (const field of existing.fields) {
    if (field === "name") Object.assign(patch, { name: values.name, normalizedName: values.normalizedName });
    else Object.assign(patch, { [field]: values[field] });
  }
  if (Object.keys(patch).length > 0) {
    await db().update(suppliers).set(patch).where(eq(suppliers.id, existing.id));
  }
  const [row] = await db().select().from(suppliers).where(eq(suppliers.id, existing.id));
  if (!row) throw new Error(`Supplier ${existing.id} not found`);
  return row;
}

export async function getSupplierLink(supplierId: string, destination: string) {
  const [link] = await db()
    .select()
    .from(supplierLinks)
    .where(and(eq(supplierLinks.supplierId, supplierId), eq(supplierLinks.destination, destination)))
    .limit(1);
  return link;
}

export async function saveSupplierLink(
  supplierId: string,
  destination: string,
  values: { externalId: string; defaultAccountId?: string | null },
) {
  await db()
    .insert(supplierLinks)
    .values({ supplierId, destination, ...values })
    .onConflictDoUpdate({ target: [supplierLinks.supplierId, supplierLinks.destination], set: values });
}

export async function listSuppliers() {
  const invoiceCounts = db()
    .select({ supplierId: invoices.supplierId, n: count().as("n") })
    .from(invoices)
    .groupBy(invoices.supplierId)
    .as("invoice_counts");

  return db()
    .select({
      supplier: suppliers,
      invoiceCount: invoiceCounts.n,
      linkCount: sql<number>`(select count(*) from ${supplierLinks} where ${supplierLinks.supplierId} = ${suppliers.id})`,
      productCount: sql<number>`(select count(*) from ${products} where ${products.supplierId} = ${suppliers.id})`,
    })
    .from(suppliers)
    .leftJoin(invoiceCounts, eq(invoiceCounts.supplierId, suppliers.id))
    .orderBy(desc(suppliers.updatedAt));
}

export async function getSupplier(id: string) {
  const [row] = await db().select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
  if (!row) return undefined;
  const links = await db().select().from(supplierLinks).where(eq(supplierLinks.supplierId, id));
  return { supplier: row, links };
}

import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ExternalItem } from "@/lib/connectors/types";
import type { LineItem } from "@/lib/invoice/schema";
import { normalizeText } from "@/lib/suppliers/normalize";

const { products, productLinks } = schema;

export type ProductRow = typeof products.$inferSelect;
export type ProductLinkRow = typeof productLinks.$inferSelect;

/** The stored product for an invoice line: by supplier code, else by description. */
export async function findProduct(supplierId: string, line: Pick<LineItem, "sku" | "description">) {
  const where = line.sku
    ? and(eq(products.supplierId, supplierId), eq(products.supplierCode, line.sku.trim()))
    : and(
        eq(products.supplierId, supplierId),
        isNull(products.supplierCode),
        eq(products.normalizedDescription, normalizeText(line.description)),
      );
  const [row] = await db().select().from(products).where(where).limit(1);
  return row;
}

export async function getProductLinks(productIds: string[], destination: string) {
  if (productIds.length === 0) return new Map<string, ProductLinkRow>();
  const rows = await db()
    .select()
    .from(productLinks)
    .where(and(inArray(productLinks.productId, productIds), eq(productLinks.destination, destination)));
  return new Map(rows.map((r) => [r.productId, r]));
}

/**
 * Record what an exported invoice told us about the supplier's products, and
 * which destination item each line went to.
 */
export async function recordProducts(input: {
  supplierId: string;
  invoiceId: string;
  currency: string;
  destination: string;
  lines: { line: LineItem; item: ExternalItem | null }[];
}) {
  for (const { line, item } of input.lines) {
    const values = {
      description: line.description,
      normalizedDescription: normalizeText(line.description),
      unit: line.unit,
      lastUnitPrice: line.unitPrice,
      currency: input.currency,
      lastInvoiceId: input.invoiceId,
    };
    const existing = await findProduct(input.supplierId, line);
    let productId: string;
    if (existing) {
      productId = existing.id;
      await db()
        .update(products)
        // Count each invoice once, even when it is retried or re-exported.
        .set({
          ...values,
          timesSeen: sql`${products.timesSeen} + CASE WHEN ${products.lastInvoiceId} IS ${input.invoiceId} THEN 0 ELSE 1 END`,
        })
        .where(eq(products.id, existing.id));
    } else {
      const [row] = await db()
        .insert(products)
        .values({ ...values, supplierId: input.supplierId, supplierCode: line.sku?.trim() || null, timesSeen: 1 })
        .returning({ id: products.id });
      productId = row.id;
    }

    if (item) {
      const link = { externalItemId: item.id, externalItemName: item.name, externalSku: item.sku };
      await db()
        .insert(productLinks)
        .values({ productId, destination: input.destination, ...link })
        .onConflictDoUpdate({ target: [productLinks.productId, productLinks.destination], set: link });
    }
  }
}

export async function listSupplierProducts(supplierId: string) {
  const rows = await db().select().from(products).where(eq(products.supplierId, supplierId)).orderBy(products.description);
  const links = rows.length
    ? await db()
        .select()
        .from(productLinks)
        .where(inArray(productLinks.productId, rows.map((r) => r.id)))
    : [];
  return rows.map((product) => ({ product, links: links.filter((l) => l.productId === product.id) }));
}

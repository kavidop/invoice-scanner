import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { Invoice } from "@/lib/invoice/schema";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`)
    .$onUpdate(() => new Date()),
};

/** Local supplier registry; the source of truth for matching before we touch a destination. */
export const suppliers = sqliteTable(
  "suppliers",
  {
    id: id(),
    name: text("name").notNull(),
    /** Lower-cased, punctuation/legal-suffix-stripped name used for fuzzy matching. */
    normalizedName: text("normalized_name").notNull(),
    /** Stored normalized (see normalizeTaxId) so lookups are exact. */
    taxId: text("tax_id"),
    email: text("email"),
    phone: text("phone"),
    website: text("website"),
    iban: text("iban"),
    address: text("address", { mode: "json" }).$type<Invoice["supplier"]["address"]>(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("suppliers_tax_id_idx").on(t.taxId),
    index("suppliers_normalized_name_idx").on(t.normalizedName),
  ],
);

/** Link between a local supplier and its record in a destination (e.g. Zoho contact_id). */
export const supplierLinks = sqliteTable(
  "supplier_links",
  {
    id: id(),
    supplierId: text("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    destination: text("destination").notNull(), // e.g. "zoho-books"
    externalId: text("external_id").notNull(),
    /** Expense account last used for this supplier's bills. */
    defaultAccountId: text("default_account_id"),
    ...timestamps,
  },
  (t) => [uniqueIndex("supplier_links_dest_idx").on(t.supplierId, t.destination)],
);

/**
 * A supplier's product as it appears on their invoices, identified by the
 * supplier's own code when printed, otherwise by its normalized description.
 */
export const products = sqliteTable(
  "products",
  {
    id: id(),
    supplierId: text("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    /** The supplier's product code (SKU) as printed; null when the invoice has none. */
    supplierCode: text("supplier_code"),
    description: text("description").notNull(),
    normalizedDescription: text("normalized_description").notNull(),
    unit: text("unit"),
    lastUnitPrice: real("last_unit_price"),
    currency: text("currency"),
    timesSeen: integer("times_seen").notNull().default(0),
    lastInvoiceId: text("last_invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("products_supplier_code_idx").on(t.supplierId, t.supplierCode),
    index("products_supplier_description_idx").on(t.supplierId, t.normalizedDescription),
  ],
);

/** A supplier product ↔ the item it maps to in a destination organization. */
export const productLinks = sqliteTable(
  "product_links",
  {
    id: id(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    destination: text("destination").notNull(), // e.g. "zoho-books:20012345"
    externalItemId: text("external_item_id").notNull(),
    externalItemName: text("external_item_name").notNull(),
    externalSku: text("external_sku"),
    ...timestamps,
  },
  (t) => [uniqueIndex("product_links_dest_idx").on(t.productId, t.destination)],
);

/** Remembered tax rate → destination tax choices, so each rate is mapped once. */
export const taxMappings = sqliteTable(
  "tax_mappings",
  {
    id: id(),
    destination: text("destination").notNull(),
    rateKey: text("rate_key").notNull(),
    /** Null means "no tax" was chosen for this rate. */
    externalTaxId: text("external_tax_id"),
    ...timestamps,
  },
  (t) => [uniqueIndex("tax_mappings_dest_rate_idx").on(t.destination, t.rateKey)],
);

export const invoiceStatus = ["uploaded", "parsed", "reviewed", "exported", "failed"] as const;
export type InvoiceStatus = (typeof invoiceStatus)[number];

export const invoices = sqliteTable(
  "invoices",
  {
    id: id(),
    status: text("status", { enum: invoiceStatus }).notNull().default("uploaded"),
    /** Destination organization chosen at export (e.g. "zoho-books:20012345"). */
    destination: text("destination"),
    sourceKind: text("source_kind", { enum: ["file", "url"] }).notNull(),
    /** Original filename or URL. */
    sourceRef: text("source_ref").notNull(),
    /** SHA-256 of the source bytes, used to detect duplicate uploads. */
    sourceHash: text("source_hash"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    /** Key of the original document in file storage (see src/lib/storage). */
    storageKey: text("storage_key"),
    supplierId: text("supplier_id").references(() => suppliers.id),
    invoiceNumber: text("invoice_number"),
    issueDate: text("issue_date"),
    currency: text("currency"),
    total: real("total"),
    /** Raw model output, kept for audit / re-processing. */
    extracted: text("extracted", { mode: "json" }).$type<Invoice>(),
    /** What the user confirmed in the preview; this is what gets exported. */
    reviewed: text("reviewed", { mode: "json" }).$type<Invoice>(),
    model: text("model"),
    error: text("error"),
    ...timestamps,
  },
  (t) => [
    index("invoices_status_idx").on(t.status),
    uniqueIndex("invoices_source_hash_idx").on(t.sourceHash),
    index("invoices_supplier_number_idx").on(t.supplierId, t.invoiceNumber),
  ],
);

/** One row per push attempt to a destination. */
export const exports = sqliteTable(
  "exports",
  {
    id: id(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    destination: text("destination").notNull(),
    status: text("status", { enum: ["pending", "success", "failed"] }).notNull(),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    request: text("request", { mode: "json" }),
    response: text("response", { mode: "json" }),
    error: text("error"),
    ...timestamps,
  },
  (t) => [index("exports_invoice_idx").on(t.invoiceId)],
);

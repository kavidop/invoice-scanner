import "server-only";
import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { extractInvoice, type InvoiceSource } from "@/lib/gemini/extract";
import { reduceHtml } from "@/lib/ingest/html";
import { fetchInvoiceUrl, IngestError } from "@/lib/ingest/fetch-url";
import { EXTENSION, MAX_FILE_BYTES, sniffFileType } from "@/lib/ingest/mime";
import { InvoiceSchema, type Invoice } from "@/lib/invoice/schema";
import { fileStorage } from "@/lib/storage";

const { invoices } = schema;

export type InvoiceRow = typeof invoices.$inferSelect;
export type IngestResult = { id: string; duplicate: boolean; status: InvoiceRow["status"] };

type StoredDocument = {
  sourceKind: "file" | "url";
  sourceRef: string;
  data: Buffer;
  mimeType: string;
  extension: string;
};

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

export async function ingestFile(file: { data: Buffer; filename: string }): Promise<IngestResult> {
  if (file.data.byteLength === 0) throw new IngestError("The file is empty");
  if (file.data.byteLength > MAX_FILE_BYTES) throw new IngestError("File is too large (max 14 MB)");
  const mimeType = sniffFileType(file.data);
  if (!mimeType) throw new IngestError("Unsupported file. Upload a PDF, PNG, JPEG, WEBP or HEIC.");

  return ingest({
    sourceKind: "file",
    sourceRef: file.filename,
    data: file.data,
    mimeType,
    extension: EXTENSION[mimeType],
  });
}

export async function ingestUrl(url: string): Promise<IngestResult> {
  const doc = await fetchInvoiceUrl(url);
  return ingest({
    sourceKind: "url",
    sourceRef: url.trim(),
    data: doc.data,
    mimeType: doc.mimeType,
    extension: doc.kind === "file" ? EXTENSION[doc.mimeType] : doc.format,
  });
}

async function ingest(doc: StoredDocument): Promise<IngestResult> {
  const hash = sha256(doc.data);
  const [existing] = await db().select().from(invoices).where(eq(invoices.sourceHash, hash)).limit(1);
  if (existing) {
    // A previous attempt failed: retry instead of making the user delete it first.
    const status = existing.status === "failed" ? await runExtraction(existing.id) : existing.status;
    return { id: existing.id, duplicate: true, status };
  }

  const id = crypto.randomUUID();
  const storageKey = `${id}/original.${doc.extension}`;
  await fileStorage().put(storageKey, doc.data);
  await db().insert(invoices).values({
    id,
    status: "uploaded",
    sourceKind: doc.sourceKind,
    sourceRef: doc.sourceRef,
    sourceHash: hash,
    mimeType: doc.mimeType,
    sizeBytes: doc.data.byteLength,
    storageKey,
  });

  return { id, duplicate: false, status: await runExtraction(id) };
}

function toExtractionSource(row: InvoiceRow, data: Buffer): InvoiceSource {
  if (row.mimeType === "text/html") {
    return { kind: "text", format: "html", url: row.sourceRef, text: reduceHtml(data.toString("utf8")) };
  }
  if (row.mimeType === "application/xml") {
    return { kind: "text", format: "xml", url: row.sourceRef, text: data.toString("utf8") };
  }
  return { kind: "file", data, mimeType: row.mimeType ?? "application/pdf" };
}

/** (Re-)run Gemini on the stored original. Never throws: failures are recorded on the row. */
export async function runExtraction(id: string): Promise<InvoiceRow["status"]> {
  const row = await getInvoice(id);
  if (!row) throw new Error(`Invoice ${id} not found`);

  try {
    const data = row.storageKey ? await fileStorage().get(row.storageKey) : null;
    if (!data) throw new Error("Original document is missing from storage");

    const { invoice, model } = await extractInvoice(toExtractionSource(row, data));
    await db()
      .update(invoices)
      .set({
        status: "parsed",
        extracted: invoice,
        reviewed: null,
        model,
        error: null,
        ...summary(invoice),
      })
      .where(eq(invoices.id, id));
    return "parsed";
  } catch (err) {
    console.error(`Extraction failed for invoice ${id}`, err);
    await db()
      .update(invoices)
      .set({ status: "failed", error: err instanceof Error ? err.message : String(err) })
      .where(eq(invoices.id, id));
    return "failed";
  }
}

/** Store the user-confirmed version; this is what gets exported later. */
export async function saveReview(id: string, input: unknown): Promise<Invoice> {
  const invoice = InvoiceSchema.parse(input);
  const result = await db()
    .update(invoices)
    // An exported invoice stays exported; re-exporting is an explicit choice.
    .set({
      status: sql`CASE WHEN ${invoices.status} = 'exported' THEN 'exported' ELSE 'reviewed' END`,
      reviewed: invoice,
      ...summary(invoice),
    })
    .where(eq(invoices.id, id));
  if (result.rowsAffected === 0) throw new Error(`Invoice ${id} not found`);
  return invoice;
}

export async function getInvoice(id: string): Promise<InvoiceRow | undefined> {
  const [row] = await db().select().from(invoices).where(eq(invoices.id, id)).limit(1);
  return row;
}

export async function listInvoices(limit = 20): Promise<InvoiceRow[]> {
  return db().select().from(invoices).orderBy(desc(invoices.createdAt)).limit(limit);
}

export async function getInvoiceDocument(id: string) {
  const row = await getInvoice(id);
  if (!row?.storageKey) return null;
  const data = await fileStorage().get(row.storageKey);
  return data ? { data, mimeType: row.mimeType ?? "application/octet-stream", row } : null;
}

/** Denormalized columns for listing and duplicate checks. */
function summary(invoice: Invoice) {
  return {
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate,
    currency: invoice.currency,
    total: invoice.total,
  };
}

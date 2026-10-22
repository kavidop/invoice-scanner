import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { IngestError } from "@/lib/ingest/fetch-url";
import { sampleInvoice } from "@/lib/invoice/sample";
import { getInvoice, getInvoiceDocument, ingestFile, listInvoices, saveReview } from "@/lib/invoices/service";

// Runs against an in-memory libSQL DB with GEMINI_MOCK=true (see vitest.config.mts).
beforeAll(async () => {
  await migrate(db(), { migrationsFolder: "./drizzle" });
});

const pdf = (marker: string) => Buffer.from(`%PDF-1.4\n% ${marker}\n%%EOF`);

describe("invoice service", () => {
  it("stores the original, extracts it and records the summary", async () => {
    const result = await ingestFile({ data: pdf("a"), filename: "acme.pdf" });
    expect(result).toMatchObject({ duplicate: false, status: "parsed" });

    const row = await getInvoice(result.id);
    expect(row).toMatchObject({
      sourceKind: "file",
      sourceRef: "acme.pdf",
      mimeType: "application/pdf",
      invoiceNumber: sampleInvoice.invoiceNumber,
      total: sampleInvoice.total,
      model: "mock",
    });
    expect(row?.extracted).toEqual(sampleInvoice);

    const doc = await getInvoiceDocument(result.id);
    expect(doc?.data.toString()).toContain("% a");
  });

  it("returns the existing invoice for a duplicate upload", async () => {
    const first = await ingestFile({ data: pdf("b"), filename: "b.pdf" });
    const again = await ingestFile({ data: pdf("b"), filename: "b-copy.pdf" });
    expect(again).toEqual({ id: first.id, duplicate: true, status: "parsed" });
  });

  it("rejects unsupported files", async () => {
    await expect(ingestFile({ data: Buffer.from("hello"), filename: "x.txt" })).rejects.toBeInstanceOf(IngestError);
  });

  it("saves a reviewed version and validates it", async () => {
    const { id } = await ingestFile({ data: pdf("c"), filename: "c.pdf" });
    const edited = { ...sampleInvoice, invoiceNumber: "INV-EDITED", total: 1 };
    await saveReview(id, edited);

    const row = await getInvoice(id);
    expect(row).toMatchObject({ status: "reviewed", invoiceNumber: "INV-EDITED", total: 1 });
    expect(row?.extracted?.invoiceNumber).toBe(sampleInvoice.invoiceNumber);

    await expect(saveReview(id, { ...edited, lineItems: "nope" })).rejects.toThrow();
  });

  it("lists invoices", async () => {
    expect((await listInvoices()).length).toBeGreaterThanOrEqual(3);
  });
});

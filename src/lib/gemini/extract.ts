import "server-only";
import { GoogleGenAI, createPartFromBase64, type Part } from "@google/genai";
import { env } from "@/lib/env";
import { sampleInvoice } from "@/lib/invoice/sample";
import { InvoiceSchema, invoiceJsonSchema, type Invoice } from "@/lib/invoice/schema";

const SYSTEM_INSTRUCTION = `You extract structured data from supplier invoices (purchase bills).
- The "supplier" is the party that ISSUED the invoice, not the customer it is billed to.
- Copy identifiers (invoice number, tax IDs, IBAN, SKUs) exactly as printed.
- Amounts are plain numbers in the invoice currency, no thousands separators or symbols.
- Dates are ISO 8601 (YYYY-MM-DD). Resolve DD/MM vs MM/DD from the supplier's country when ambiguous.
- Use null for anything not present on the document. Never invent values.
- Set "confidence" lower when the scan is blurry, totals don't add up, or fields were guessed.`;

export type InvoiceSource =
  | { kind: "file"; data: Buffer; mimeType: string }
  | { kind: "text"; text: string; format: "html" | "xml"; url: string };

let client: GoogleGenAI | undefined;
function gemini() {
  const apiKey = env().GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in .env.local");
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

function toParts(source: InvoiceSource): Part[] {
  switch (source.kind) {
    case "file":
      // PDFs and images (PNG/JPEG/WEBP/HEIC) are sent inline; fine up to ~20 MB.
      return [createPartFromBase64(source.data.toString("base64"), source.mimeType)];
    case "text":
      return [
        { text: `Electronic invoice (${source.format.toUpperCase()}) fetched from ${source.url}:\n\n${source.text}` },
      ];
  }
}

export type Extraction = { invoice: Invoice; model: string };

export async function extractInvoice(source: InvoiceSource): Promise<Extraction> {
  if (env().GEMINI_MOCK) return { invoice: structuredClone(sampleInvoice), model: "mock" };

  const response = await gemini().models.generateContent({
    model: env().GEMINI_MODEL,
    contents: [{ role: "user", parts: [...toParts(source), { text: "Extract this invoice." }] }],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseJsonSchema: invoiceJsonSchema,
      temperature: 0,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned an empty response");
  return { invoice: InvoiceSchema.parse(JSON.parse(text)), model: response.modelVersion ?? env().GEMINI_MODEL };
}

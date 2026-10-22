import "server-only";
import { GoogleGenAI, createPartFromBase64, type Part } from "@google/genai";
import { env } from "@/lib/env";
import { sampleInvoice } from "@/lib/invoice/sample";
import { InvoiceSchema, invoiceJsonSchema, type Invoice } from "@/lib/invoice/schema";

const SYSTEM_INSTRUCTION = `You extract structured data from supplier invoices (purchase bills), mostly Greek.
- The "supplier" is the party that ISSUED the invoice (Εκδότης), not the customer it is billed to.
  The "buyer" is the customer (Πελάτης / Στοιχεία Αγοραστή).
- Copy identifiers (invoice number with its series, ΑΦΜ / VAT numbers, IBAN, product codes) exactly as printed.
- Keep names and descriptions in the language and script printed on the document; do not translate.
- Amounts are plain numbers in the invoice currency. Greek documents use "," for decimals and "." for
  thousands: 1.234,50 means 1234.5.
- Dates are ISO 8601 (YYYY-MM-DD). Greek documents print DD/MM/YYYY.
- "mark" is the myDATA ΜΑΡΚ printed near the QR code, if any.
- Line totals are net (Καθαρή αξία), before ΦΠΑ. Put ΦΠΑ in the line's taxes with its rate (24, 13, 6, 17, 9, 4 or 0).
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

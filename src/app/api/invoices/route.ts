import { z } from "zod";
import { IngestError } from "@/lib/ingest/fetch-url";
import { ingestFile, ingestUrl, listInvoices } from "@/lib/invoices/service";

const UrlBody = z.object({ url: z.string().min(1) });

/**
 * Upload a document (multipart field `file`) or submit `{ "url": "https://..." }`.
 * Extraction runs before responding, so this can take a while.
 */
export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    let result;
    if (contentType.startsWith("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return error(400, 'Missing "file" field');
      result = await ingestFile({ data: Buffer.from(await file.arrayBuffer()), filename: file.name });
    } else {
      const parsed = UrlBody.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return error(400, 'Send a file or a JSON body like { "url": "https://..." }');
      result = await ingestUrl(parsed.data.url);
    }
    return Response.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (err) {
    if (err instanceof IngestError) return error(422, err.message);
    console.error("Invoice ingest failed", err);
    return error(500, "Something went wrong while processing the invoice");
  }
}

export async function GET() {
  const rows = await listInvoices(50);
  // Full extraction JSON is only needed on the detail page.
  return Response.json(rows.map((row) => ({ ...row, extracted: undefined, reviewed: undefined })));
}

function error(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

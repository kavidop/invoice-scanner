import { getInvoiceDocument } from "@/lib/invoices/service";

/** Serves the original document for the preview pane. */
export async function GET(_request: Request, ctx: RouteContext<"/api/invoices/[id]/source">) {
  const { id } = await ctx.params;
  const doc = await getInvoiceDocument(id);
  if (!doc) return new Response("Not found", { status: 404 });

  const headers: Record<string, string> = {
    "Content-Type": doc.mimeType,
    "Content-Length": String(doc.data.byteLength),
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.row.sourceRef.split("/").pop() || "invoice")}`,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
  if (doc.mimeType === "text/html" || doc.mimeType === "application/xml") {
    // Fetched pages are third-party content: render them inert. (Not for PDFs:
    // Chrome's PDF viewer refuses to load under a sandbox CSP.)
    headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src * data:; style-src 'unsafe-inline' *";
  }

  return new Response(new Uint8Array(doc.data), { headers });
}

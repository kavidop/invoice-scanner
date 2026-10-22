"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exportInvoice, ExportError } from "@/lib/invoices/export";
import { runExtraction, saveReview } from "@/lib/invoices/service";

// Re-render the invoice page in the action's response. (`refresh()` returned the
// new payload but the client didn't apply it on this route; revalidatePath does.)
const refreshInvoice = (id: string) => revalidatePath(`/invoices/${id}`);

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveReviewAction(id: string, invoice: unknown): Promise<ActionResult> {
  try {
    await saveReview(z.uuid().parse(id), invoice);
    refreshInvoice(id);
    return { ok: true };
  } catch (err) {
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      return { ok: false, error: `${first.path.join(".") || "invoice"}: ${first.message}` };
    }
    console.error("Saving review failed", err);
    return { ok: false, error: err instanceof Error ? err.message : "Could not save" };
  }
}

export async function reExtractAction(id: string): Promise<ActionResult> {
  const status = await runExtraction(z.uuid().parse(id));
  refreshInvoice(id);
  return status === "failed" ? { ok: false, error: "Extraction failed, see the error above" } : { ok: true };
}

export type ExportActionResult =
  | { ok: true; externalUrl?: string }
  | { ok: false; error: string; duplicateUrl?: string };

export async function exportAction(id: string, choices: unknown): Promise<ExportActionResult> {
  try {
    const result = await exportInvoice(z.uuid().parse(id), choices);
    refreshInvoice(id);
    return { ok: true, externalUrl: result.externalUrl };
  } catch (err) {
    refreshInvoice(id); // the attempt is recorded in the history either way
    if (err instanceof ExportError) return { ok: false, error: err.message, duplicateUrl: err.duplicateUrl };
    if (err instanceof z.ZodError) return { ok: false, error: err.issues[0].message };
    console.error("Export failed", err);
    return { ok: false, error: err instanceof Error ? err.message : "Export failed" };
  }
}

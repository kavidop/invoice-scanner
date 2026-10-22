"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { runExtraction, saveReview } from "@/lib/invoices/service";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveReviewAction(id: string, invoice: unknown): Promise<ActionResult> {
  try {
    await saveReview(z.uuid().parse(id), invoice);
    refresh();
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
  refresh();
  return status === "failed" ? { ok: false, error: "Extraction failed, see the error above" } : { ok: true };
}

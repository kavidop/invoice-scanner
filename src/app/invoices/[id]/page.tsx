import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { StatusBadge } from "@/components/status-badge";
import { getInvoice } from "@/lib/invoices/service";
import { DocumentViewer } from "./document-viewer";
import { InvoiceEditor } from "./invoice-editor";
import { ReExtractButton } from "./re-extract-button";

export default function InvoicePage({ params, searchParams }: PageProps<"/invoices/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading invoice…</p>}>
        <InvoiceDetail params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function InvoiceDetail({ params, searchParams }: Pick<PageProps<"/invoices/[id]">, "params" | "searchParams">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const row = await getInvoice(id);
  if (!row) notFound();
  const { duplicate } = await searchParams;
  const data = row.reviewed ?? row.extracted;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          ← All invoices
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight">
          {data ? `${data.supplier.name} · ${data.invoiceNumber}` : row.sourceRef}
        </h1>
        <StatusBadge status={row.status} />
      </div>

      {duplicate && (
        <p className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950/50 dark:text-sky-200">
          This document was already uploaded, so you&apos;re looking at the existing copy.
        </p>
      )}

      {row.status === "failed" && (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
          <p className="flex-1">Extraction failed: {row.error}</p>
          <ReExtractButton id={row.id} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <DocumentViewer id={row.id} mimeType={row.mimeType} sourceRef={row.sourceRef} sourceKind={row.sourceKind} />
        {data ? (
          <InvoiceEditor
            key={row.updatedAt.getTime()}
            id={row.id}
            initial={data}
            extracted={row.extracted}
            reviewed={row.reviewed !== null}
            model={row.model}
          />
        ) : (
          row.status !== "failed" && (
            <div className="flex flex-col items-start gap-3 text-sm text-zinc-600">
              <p>This invoice hasn&apos;t been extracted yet.</p>
              <ReExtractButton id={row.id} />
            </div>
          )
        )}
      </div>
    </>
  );
}

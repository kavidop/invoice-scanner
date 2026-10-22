import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatMoney, StatusBadge } from "@/components/status-badge";
import { listInvoices } from "@/lib/invoices/service";
import { UploadForm } from "./upload-form";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6">
      <section className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Scan an invoice</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Gemini extracts the supplier, line items and taxes. You review the result before anything is sent to
            Zoho Books.
          </p>
        </div>
        <UploadForm />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Recent invoices</h2>
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <RecentInvoices />
        </Suspense>
      </section>
    </main>
  );
}

async function RecentInvoices() {
  await connection(); // a local libSQL file resolves fast enough to be baked in at build otherwise
  const rows = await listInvoices(20);
  if (rows.length === 0) return <p className="text-sm text-zinc-500">Nothing scanned yet.</p>;

  return (
    <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {rows.map((row) => {
        const supplier = (row.reviewed ?? row.extracted)?.supplier.name;
        return (
          <li key={row.id}>
            <Link
              href={`/invoices/${row.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{supplier ?? row.sourceRef}</p>
                <p className="truncate text-xs text-zinc-500">
                  {[row.invoiceNumber, row.issueDate].filter(Boolean).join(" · ") || row.sourceRef}
                </p>
              </div>
              <span className="hidden text-sm tabular-nums sm:block">{formatMoney(row.total, row.currency)}</span>
              <StatusBadge status={row.status} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

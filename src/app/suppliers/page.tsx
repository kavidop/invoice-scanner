import { connection } from "next/server";
import { Suspense } from "react";
import { formatAddress, listSuppliers } from "@/lib/suppliers/service";

export default function SuppliersPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Suppliers</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Added automatically when you export an invoice. Matched by tax ID first, then by name.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <SupplierList />
      </Suspense>
    </main>
  );
}

async function SupplierList() {
  await connection();
  const rows = await listSuppliers();
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500">No suppliers yet. They appear here after your first export.</p>;
  }

  return (
    <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {rows.map(({ supplier, externalId, invoiceCount }) => (
        <li key={supplier.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{supplier.name}</p>
            <p className="truncate text-xs text-zinc-500">
              {[supplier.taxId, supplier.email, formatAddress(supplier.address)].filter(Boolean).join(" · ") || "No details"}
            </p>
          </div>
          <div className="flex shrink-0 gap-3 text-xs text-zinc-500">
            <span>
              {invoiceCount ?? 0} invoice{invoiceCount === 1 ? "" : "s"}
            </span>
            <span className={externalId ? "text-emerald-700 dark:text-emerald-400" : ""}>
              {externalId ? `Zoho vendor ${externalId}` : "Not linked to Zoho"}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

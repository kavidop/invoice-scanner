import type { InvoiceStatus } from "@/db/schema";

const STYLES: Record<InvoiceStatus, string> = {
  uploaded: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  parsed: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  reviewed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  exported: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

const LABELS: Record<InvoiceStatus, string> = {
  uploaded: "Processing",
  parsed: "Needs review",
  reviewed: "Reviewed",
  exported: "Exported",
  failed: "Failed",
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}

export function formatMoney(amount: number | null, currency: string | null) {
  if (amount === null) return "—";
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: currency ?? "EUR" }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

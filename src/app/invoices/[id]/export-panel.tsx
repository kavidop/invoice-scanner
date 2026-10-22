"use client";

import { useState, useTransition } from "react";
import { inputClass } from "@/components/fields";
import type { ExportContext } from "@/lib/invoices/export";
import type { SupplierField } from "@/lib/suppliers/service";
import { exportAction, type ExportActionResult } from "./actions";
import { useReviewState } from "./review-state";

const NO_TAX = "__none";
const NEW_VENDOR = "__new";

const FIELD_LABELS: Record<SupplierField, string> = {
  name: "Name",
  taxId: "Tax ID",
  email: "Email",
  phone: "Phone",
  website: "Website",
  iban: "IBAN",
  address: "Address",
};

const card = "min-w-0 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800";
const heading = "text-sm font-semibold";

export function ExportPanel({ id, context }: { id: string; context: ExportContext }) {
  const { dirty } = useReviewState();
  const { invoice, local, linked, candidates, taxes, accounts, rates, destination } = context;

  const exactCandidate = candidates.find((c) => c.exact);
  const [vendor, setVendor] = useState(linked?.externalId ?? exactCandidate?.externalId ?? NEW_VENDOR);
  const [updateFields, setUpdateFields] = useState<SupplierField[]>(local?.changes.map((c) => c.field) ?? []);
  const [updateExternal, setUpdateExternal] = useState(false);
  const [taxChoice, setTaxChoice] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      rates.map((r) => [r.key, r.suggestedTaxId ?? (r.key === "none" ? NO_TAX : "")]),
    ),
  );
  const [defaultAccount, setDefaultAccount] = useState(context.defaultAccountId ?? "");
  const [lineAccounts, setLineAccounts] = useState<(string | null)[]>(() => invoice.lineItems.map(() => null));
  const [perLine, setPerLine] = useState(false);
  const [force, setForce] = useState(false);
  const [result, setResult] = useState<ExportActionResult | null>(null);
  const [exporting, startExport] = useTransition();

  const resultUrl = result ? (result.ok ? result.externalUrl : result.duplicateUrl) : undefined;
  const lastSuccess = context.history.find((h) => h.status === "success");
  const accountIds = invoice.lineItems.map((_, i) => lineAccounts[i] ?? defaultAccount);
  const needsForce = !!lastSuccess || context.duplicates.length > 0 || !!(result && !result.ok && result.duplicateUrl);

  const missing = [
    ...rates.filter((r) => !taxChoice[r.key]).map((r) => `a tax for ${r.label}`),
    ...(accountIds.some((a) => !a) ? ["an expense account"] : []),
  ];
  const blocked = dirty ? "Save your changes first — export uses the saved version." : missing.length ? `Choose ${missing.join(" and ")}.` : null;

  function submit() {
    startExport(async () => {
      setResult(
        await exportAction(id, {
          supplier: { externalId: vendor === NEW_VENDOR ? null : vendor, updateFields, updateExternal },
          taxes: Object.fromEntries(Object.entries(taxChoice).map(([k, v]) => [k, v === NO_TAX ? null : v])),
          lineAccountIds: accountIds,
          force,
        }),
      );
    });
  }

  const vendorOptions = [
    ...(linked ? [{ ...linked, note: "linked earlier" }] : []),
    ...candidates
      .filter((c) => c.externalId !== linked?.externalId)
      .map((c) => ({ ...c, note: c.exact ? "same name" : "similar name" })),
  ];

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold tracking-tight">Export to {destination.label}</h2>

      {lastSuccess && (
        <p className="rounded-md bg-violet-50 px-3 py-2 text-sm text-violet-900 dark:bg-violet-950/50 dark:text-violet-200">
          Exported on <LocalTime date={lastSuccess.createdAt} />.{" "}
          {lastSuccess.externalUrl && (
            <a href={lastSuccess.externalUrl} target="_blank" rel="noreferrer" className="font-medium underline">
              Open bill in {destination.label} ↗
            </a>
          )}
        </p>
      )}

      {/* Supplier */}
      <div className={card}>
        <h3 className={heading}>Supplier</h3>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {local
            ? `Known supplier “${local.name}” (matched by ${local.matchedBy === "taxId" ? "tax ID" : "name"}).`
            : `New supplier — “${invoice.supplier.name}” will be added to your supplier list.`}
        </p>

        {local && local.changes.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              The invoice has different details. Update the stored supplier?
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {local.changes.map((change) => (
                <li key={change.field}>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={updateFields.includes(change.field)}
                      onChange={(e) =>
                        setUpdateFields((fields) =>
                          e.target.checked ? [...fields, change.field] : fields.filter((f) => f !== change.field),
                        )
                      }
                    />
                    <span className="min-w-0">
                      <span className="font-medium">{FIELD_LABELS[change.field]}:</span>{" "}
                      <span className="text-zinc-500 line-through">{change.current ?? "empty"}</span>{" "}
                      → <span className="break-words">{change.incoming}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <fieldset className="mt-3 min-w-0">
          <legend className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Vendor in {destination.label}</legend>
          <div className="mt-1 flex flex-col gap-1.5">
            {vendorOptions.map((v) => (
              <label key={v.externalId} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="vendor"
                  className="mt-1"
                  checked={vendor === v.externalId}
                  onChange={() => setVendor(v.externalId)}
                />
                <span className="min-w-0">
                  <span className="break-words">{v.name}</span>{" "}
                  <span className="text-xs text-zinc-500">{[v.note, v.email, v.currency].filter(Boolean).join(" · ")}</span>
                </span>
              </label>
            ))}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="vendor"
                className="mt-1"
                checked={vendor === NEW_VENDOR}
                onChange={() => setVendor(NEW_VENDOR)}
              />
              <span className="min-w-0 break-words">
                Create a new vendor “{invoice.supplier.name}” ({invoice.currency})
              </span>
            </label>
          </div>
        </fieldset>
        {vendor !== NEW_VENDOR && (
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={updateExternal} onChange={(e) => setUpdateExternal(e.target.checked)} />
            Also update this vendor&apos;s details in {destination.label} from the invoice
          </label>
        )}
      </div>

      {/* Taxes */}
      <div className={card}>
        <h3 className={heading}>Taxes</h3>
        <p className="mt-1 text-xs text-zinc-500">Each rate on the invoice maps to a tax in {destination.label}. Choices are remembered.</p>
        <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
          {rates.map((rate) => (
            <label key={rate.key} className="contents text-sm">
              <span className="font-medium tabular-nums">{rate.label}</span>
              <select
                className={`${inputClass} ${taxChoice[rate.key] ? "" : "border-amber-500"}`}
                value={taxChoice[rate.key]}
                onChange={(e) => setTaxChoice((c) => ({ ...c, [rate.key]: e.target.value }))}
              >
                <option value="" disabled>
                  Choose a tax…
                </option>
                <option value={NO_TAX}>No tax</option>
                {taxes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.rate}%)
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      {/* Accounts */}
      <div className={card}>
        <h3 className={heading}>Expense account</h3>
        <select
          aria-label="Expense account for all lines"
          className={`${inputClass} mt-2 ${defaultAccount ? "" : "border-amber-500"}`}
          value={defaultAccount}
          onChange={(e) => setDefaultAccount(e.target.value)}
        >
          <option value="" disabled>
            Choose an account…
          </option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {invoice.lineItems.length > 1 && (
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={perLine}
              onChange={(e) => {
                setPerLine(e.target.checked);
                if (!e.target.checked) setLineAccounts(invoice.lineItems.map(() => null));
              }}
            />
            Choose per line
          </label>
        )}
        {perLine && (
          <ol className="mt-2 flex flex-col gap-2">
            {invoice.lineItems.map((line, i) => (
              <li key={i} className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center sm:gap-3">
                <span className="truncate">
                  {i + 1}. {line.description}
                </span>
                <select
                  aria-label={`Account for line ${i + 1}`}
                  className={inputClass}
                  value={lineAccounts[i] ?? defaultAccount}
                  onChange={(e) => setLineAccounts((all) => all.map((a, j) => (j === i ? e.target.value : a)))}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ol>
        )}
      </div>

      {context.duplicates.length > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Invoice {invoice.invoiceNumber} from this supplier was already exported from{" "}
          {context.duplicates.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ", "}
              <a className="underline" href={`/invoices/${d.id}`}>
                another upload
              </a>
            </span>
          ))}
          .
        </p>
      )}

      {result && (
        <p
          role="status"
          className={`rounded-md px-3 py-2 text-sm ${
            result.ok
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300"
          }`}
        >
          {result.ok ? "Bill created in " + destination.label + ". " : result.error + " "}
          {resultUrl && (
            <a
              href={resultUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline"
            >
              Open in {destination.label} ↗
            </a>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {needsForce && (
          <label className="mr-auto flex items-center gap-2 text-sm">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            Export anyway (creates another bill)
          </label>
        )}
        {blocked && <span className="text-sm text-zinc-500">{blocked}</span>}
        <button
          type="button"
          onClick={submit}
          disabled={exporting || !!blocked || (needsForce && !force)}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {exporting ? "Exporting…" : `Create bill in ${destination.label}`}
        </button>
      </div>

      {context.history.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-500">Export history ({context.history.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {context.history.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-2 text-xs">
                <span className={h.status === "success" ? "text-emerald-600" : h.status === "failed" ? "text-red-600" : "text-zinc-500"}>
                  {h.status}
                </span>
                <LocalTime date={h.createdAt} className="text-zinc-500" />
                {h.externalUrl && (
                  <a className="underline" href={h.externalUrl} target="_blank" rel="noreferrer">
                    {h.externalId}
                  </a>
                )}
                {h.error && <span className="text-red-700 dark:text-red-400">{h.error}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** Rendered in the viewer's locale and time zone; the server's guess may differ. */
function LocalTime({ date, className }: { date: Date; className?: string }) {
  return (
    <time dateTime={date.toISOString()} className={className} suppressHydrationWarning>
      {date.toLocaleString()}
    </time>
  );
}

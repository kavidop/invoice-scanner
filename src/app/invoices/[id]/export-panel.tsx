"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { inputClass } from "@/components/fields";
import type { ExportContext, LineItemChoice } from "@/lib/invoices/export";
import type { SupplierField } from "@/lib/suppliers/service";
import { exportAction, type ExportActionResult } from "./actions";
import { useReviewState } from "./review-state";

const NO_TAX = "__none";
const NEW_VENDOR = "__new";
const ZOHO = "Zoho Books";

/** <select> value for a line's item choice. */
const choiceValue = (c: LineItemChoice) => (c.mode === "item" ? `item:${c.itemId}` : c.mode);

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
  const { invoice, local, linked, candidates, taxes, accounts, rates, destination, items, lines } = context;
  const router = useRouter();
  const pathname = usePathname();

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
  const [lineChoices, setLineChoices] = useState<LineItemChoice[]>(() => lines.map((l) => l.suggested));
  const setLineChoice = (index: number, choice: LineItemChoice) =>
    setLineChoices((all) => all.map((c, i) => (i === index ? choice : c)));
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
    ...(lineChoices.some((c) => c.mode === "new" && !c.name.trim()) ? ["a name for each new item"] : []),
  ];
  const blocked = dirty ? "Save your changes first — export uses the saved version." : missing.length ? `Choose ${missing.join(" and ")}.` : null;

  function submit() {
    startExport(async () => {
      setResult(
        await exportAction(id, {
          supplier: { externalId: vendor === NEW_VENDOR ? null : vendor, updateFields, updateExternal },
          taxes: Object.fromEntries(Object.entries(taxChoice).map(([k, v]) => [k, v === NO_TAX ? null : v])),
          destination: destination.key,
          lines: lineChoices.map((item, i) => ({ item, accountId: accountIds[i] })),
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Export to {ZOHO}</h2>
        {context.destinations.length > 1 ? (
          <select
            aria-label="Organization"
            className={`${inputClass} w-auto`}
            value={destination.key}
            onChange={(e) => router.push(`${pathname}?org=${encodeURIComponent(e.target.value)}`, { scroll: false })}
          >
            {context.destinations.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-zinc-500">{destination.label}</span>
        )}
        <span className="basis-full text-xs text-zinc-500">
          {context.matchedBuyer
            ? `Chosen because the invoice is billed to ΑΦΜ ${invoice.buyer?.taxId}.`
            : invoice.buyer?.taxId
              ? `The buyer ΑΦΜ ${invoice.buyer.taxId} doesn't match any organization — check this is the right one.`
              : "No buyer ΑΦΜ on the invoice — check this is the right organization."}
        </span>
      </div>

      {lastSuccess && (
        <p className="rounded-md bg-violet-50 px-3 py-2 text-sm text-violet-900 dark:bg-violet-950/50 dark:text-violet-200">
          Exported on <LocalTime date={lastSuccess.createdAt} />.{" "}
          {lastSuccess.externalUrl && (
            <a href={lastSuccess.externalUrl} target="_blank" rel="noreferrer" className="font-medium underline">
              Open bill in {ZOHO} ↗
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
            Also update this vendor&apos;s details in {ZOHO} from the invoice
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

      {/* Products */}
      <div className={card}>
        <h3 className={heading}>Products</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Each line is matched to an item in {destination.label}. The link to the supplier&apos;s code is remembered,
          so next time the same product is picked automatically.
        </p>

        <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Account (for lines without an item, and the purchase account of new items)
          <select
            className={`${inputClass} ${defaultAccount ? "" : "border-amber-500"}`}
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
        </label>
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
            Different account per line
          </label>
        )}

        <ol className="mt-3 flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
          {invoice.lineItems.map((line, i) => {
            const ctx = lines[i];
            const choice = lineChoices[i];
            const shown = new Set([ctx.linkedItem?.id, ...ctx.candidates.map((c) => c.id)]);
            return (
              <li key={i} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="text-xs text-zinc-400">{i + 1}.</span>
                  <span className="min-w-0 flex-1 break-words font-medium">{line.description}</span>
                  <span className="text-xs text-zinc-500">
                    {[line.sku && `code ${line.sku}`, `${line.quantity} × ${line.unitPrice}`].filter(Boolean).join(" · ")}
                  </span>
                  {ctx.knownProduct && (
                    <span className="rounded-full bg-zinc-100 px-1.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      seen before
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <select
                    aria-label={`Item for line ${i + 1}`}
                    className={inputClass}
                    value={choiceValue(choice)}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "new") setLineChoice(i, { mode: "new", ...ctx.newItem });
                      else if (v === "none") setLineChoice(i, { mode: "none" });
                      else setLineChoice(i, { mode: "item", itemId: v.slice("item:".length) });
                    }}
                  >
                    {ctx.linkedItem && (
                      <option value={`item:${ctx.linkedItem.id}`}>
                        {itemLabel(ctx.linkedItem)} — linked to this product
                      </option>
                    )}
                    {ctx.candidates.map((c) => (
                      <option key={c.id} value={`item:${c.id}`}>
                        {itemLabel(c)} — {c.reason === "code" ? "same code" : `${Math.round(c.score * 100)}% name match`}
                      </option>
                    ))}
                    <option value="new">+ Create a new item</option>
                    <option value="none">No item (text line on the account)</option>
                    {items.some((it) => !shown.has(it.id)) && (
                      <optgroup label="All items">
                        {items
                          .filter((it) => !shown.has(it.id))
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((it) => (
                            <option key={it.id} value={`item:${it.id}`}>
                              {itemLabel(it)}
                            </option>
                          ))}
                      </optgroup>
                    )}
                  </select>
                  {perLine && (
                    <select
                      aria-label={`Account for line ${i + 1}`}
                      className={`${inputClass} sm:w-48`}
                      value={lineAccounts[i] ?? defaultAccount}
                      onChange={(e) => setLineAccounts((all) => all.map((a, j) => (j === i ? e.target.value : a)))}
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {choice.mode === "new" && (
                  <div className="grid grid-cols-1 gap-2 rounded-md bg-zinc-50 p-2 sm:grid-cols-[minmax(0,1fr)_10rem] dark:bg-zinc-900">
                    <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      New item name
                      <input
                        className={`${inputClass} ${choice.name.trim() ? "" : "border-amber-500"}`}
                        value={choice.name}
                        onChange={(e) => setLineChoice(i, { ...choice, name: e.target.value })}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Item code (SKU)
                      <input
                        className={inputClass}
                        value={choice.sku ?? ""}
                        placeholder="optional"
                        onChange={(e) => setLineChoice(i, { ...choice, sku: e.target.value || null })}
                      />
                    </label>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
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
          {result.ok ? `Bill created in ${destination.label}. ` : result.error + " "}
          {resultUrl && (
            <a
              href={resultUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline"
            >
              Open in {ZOHO} ↗
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
          {exporting ? "Exporting…" : `Create bill in ${ZOHO}`}
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

function itemLabel(item: { name: string; sku: string | null }) {
  return item.sku ? `${item.name} [${item.sku}]` : item.name;
}

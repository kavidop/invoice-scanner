"use client";

import { useMemo, useState, useTransition } from "react";
import { NumberField, TextField } from "@/components/fields";
import { formatMoney } from "@/components/status-badge";
import {
  checkTotals,
  recalcLine,
  recalcTotals,
  type Invoice,
  type LineItem,
  type Supplier,
} from "@/lib/invoice/schema";
import { saveReviewAction } from "./actions";
import { ReExtractButton } from "./re-extract-button";

const emptyLine: LineItem = {
  description: "",
  sku: null,
  quantity: 1,
  unit: null,
  unitPrice: 0,
  discount: null,
  taxes: [],
  lineTotal: 0,
};

const emptyAddress: NonNullable<Supplier["address"]> = {
  line1: null,
  line2: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
};

const card = "min-w-0 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800";
const smallButton =
  "rounded px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-950/50";

export function InvoiceEditor({
  id,
  initial,
  extracted,
  reviewed,
  model,
}: {
  id: string;
  initial: Invoice;
  extracted: Invoice | null;
  reviewed: boolean;
  model: string | null;
}) {
  const [invoice, setInvoice] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, startSaving] = useTransition();

  const issues = useMemo(() => checkTotals(invoice), [invoice]);
  const flagged = useMemo(() => new Set(issues.map((i) => i.path)), [issues]);
  const dirty = JSON.stringify(invoice) !== JSON.stringify(saved);

  const set = <K extends keyof Invoice>(key: K, value: Invoice[K]) => setInvoice((inv) => ({ ...inv, [key]: value }));
  const setSupplier = <K extends keyof Supplier>(key: K, value: Supplier[K]) =>
    setInvoice((inv) => ({ ...inv, supplier: { ...inv.supplier, [key]: value } }));
  const setAddress = (key: keyof typeof emptyAddress, value: string | null) =>
    setInvoice((inv) => ({
      ...inv,
      supplier: { ...inv.supplier, address: { ...(inv.supplier.address ?? emptyAddress), [key]: value } },
    }));
  const setLine = (index: number, update: (line: LineItem) => LineItem) =>
    setInvoice((inv) => ({ ...inv, lineItems: inv.lineItems.map((l, i) => (i === index ? update(l) : l)) }));

  function save() {
    startSaving(async () => {
      const result = await saveReviewAction(id, invoice);
      if (result.ok) {
        setSaved(invoice);
        setMessage({ ok: true, text: "Saved. This version will be used for export." });
      } else {
        setMessage({ ok: false, text: result.error });
      }
    });
  }

  const address = invoice.supplier.address ?? emptyAddress;

  return (
    <section className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Confidence value={invoice.confidence} />
        {model && <span className="text-xs text-zinc-500">via {model}</span>}
        <div className="flex-1" />
        {extracted && (reviewed || dirty) && (
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
            onClick={() => window.confirm("Discard your edits and go back to what Gemini extracted?") && setInvoice(extracted)}
          >
            Reset to extracted
          </button>
        )}
        <ReExtractButton id={id} label="Re-extract" confirm="Run Gemini again? Your edits will be replaced." />
        <button
          type="button"
          onClick={save}
          disabled={saving || (!dirty && reviewed)}
          className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : reviewed && !dirty ? "Saved" : "Save review"}
        </button>
      </div>

      {message && (
        <p
          role="status"
          className={`rounded-md px-3 py-2 text-sm ${
            message.ok
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300"
          }`}
        >
          {message.text}
        </p>
      )}

      {issues.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-medium">Check these before saving:</p>
          <ul className="mt-1 list-disc pl-5">
            {issues.map((issue) => (
              <li key={issue.path}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Invoice */}
      <fieldset className={card}>
        <legend className="px-1 text-sm font-semibold">Invoice</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TextField label="Number" value={invoice.invoiceNumber} required onChange={(v) => set("invoiceNumber", v ?? "")} />
          <TextField label="Issue date" type="date" value={invoice.issueDate} required onChange={(v) => set("issueDate", v ?? "")} />
          <TextField label="Due date" type="date" value={invoice.dueDate} onChange={(v) => set("dueDate", v)} />
          <TextField
            label="Currency"
            value={invoice.currency}
            required
            onChange={(v) => set("currency", (v ?? "").toUpperCase().slice(0, 3))}
          />
        </div>
      </fieldset>

      {/* Supplier */}
      <fieldset className={card}>
        <legend className="px-1 text-sm font-semibold">Supplier</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            label="Name"
            className="sm:col-span-2"
            value={invoice.supplier.name}
            required
            onChange={(v) => setSupplier("name", v ?? "")}
          />
          <TextField label="Tax ID (VAT / GST)" value={invoice.supplier.taxId} onChange={(v) => setSupplier("taxId", v)} />
          <TextField label="IBAN" value={invoice.supplier.iban} onChange={(v) => setSupplier("iban", v)} />
          <TextField label="Email" type="email" value={invoice.supplier.email} onChange={(v) => setSupplier("email", v)} />
          <TextField label="Phone" value={invoice.supplier.phone} onChange={(v) => setSupplier("phone", v)} />
          <TextField label="Website" value={invoice.supplier.website} onChange={(v) => setSupplier("website", v)} />
          <TextField label="Address" value={address.line1} onChange={(v) => setAddress("line1", v)} />
          <TextField label="Address line 2" value={address.line2} onChange={(v) => setAddress("line2", v)} />
          <div className="grid grid-cols-3 gap-3">
            <TextField label="Postal code" value={address.postalCode} onChange={(v) => setAddress("postalCode", v)} />
            <TextField label="City" className="col-span-2" value={address.city} onChange={(v) => setAddress("city", v)} />
          </div>
          <TextField label="State / region" value={address.state} onChange={(v) => setAddress("state", v)} />
          <TextField
            label="Country (ISO code)"
            value={address.country}
            onChange={(v) => setAddress("country", v ? v.toUpperCase().slice(0, 2) : null)}
          />
        </div>
      </fieldset>

      {/* Lines */}
      <fieldset className={card}>
        <legend className="px-1 text-sm font-semibold">Line items ({invoice.lineItems.length})</legend>
        <ol className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
          {invoice.lineItems.map((line, i) => {
            const totalFlagged = flagged.has(`lineItems.${i}.lineTotal`);
            return (
              <li key={i} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex items-end gap-2">
                  <span className="pb-2 text-xs tabular-nums text-zinc-400">{i + 1}.</span>
                  <TextField
                    label="Description"
                    className="flex-1"
                    value={line.description}
                    required
                    onChange={(v) => setLine(i, (l) => ({ ...l, description: v ?? "" }))}
                  />
                  <TextField
                    label="SKU"
                    className="w-28 sm:w-36"
                    value={line.sku}
                    onChange={(v) => setLine(i, (l) => ({ ...l, sku: v }))}
                  />
                  <button
                    type="button"
                    aria-label={`Remove line ${i + 1}`}
                    title="Remove line"
                    className="pb-2 text-zinc-400 hover:text-red-600"
                    onClick={() => set("lineItems", invoice.lineItems.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2 pl-5 sm:grid-cols-5">
                  <NumberField label="Qty" value={line.quantity} onChange={(v) => setLine(i, (l) => ({ ...l, quantity: v }))} />
                  <TextField label="Unit" value={line.unit} onChange={(v) => setLine(i, (l) => ({ ...l, unit: v }))} />
                  <NumberField label="Unit price" value={line.unitPrice} onChange={(v) => setLine(i, (l) => ({ ...l, unitPrice: v }))} />
                  <NumberField
                    nullable
                    label="Discount"
                    value={line.discount}
                    onChange={(v) => setLine(i, (l) => ({ ...l, discount: v }))}
                  />
                  <div className="flex flex-col gap-1">
                    <NumberField
                      label="Line total (excl. tax)"
                      invalid={totalFlagged}
                      value={line.lineTotal}
                      onChange={(v) => setLine(i, (l) => ({ ...l, lineTotal: v }))}
                    />
                    {totalFlagged && (
                      <button type="button" className={`${smallButton} self-end`} onClick={() => setLine(i, recalcLine)}>
                        Recalculate
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-5">
                  {line.taxes.map((tax, t) => {
                    const setTax = (patch: Partial<typeof tax>) =>
                      setLine(i, (l) => ({ ...l, taxes: l.taxes.map((x, j) => (j === t ? { ...x, ...patch } : x)) }));
                    return (
                      <div
                        key={t}
                        className="flex items-center gap-1 rounded-md bg-zinc-50 p-1 text-xs text-zinc-500 dark:bg-zinc-900"
                      >
                        <TextField className="w-24" placeholder="Tax name" value={tax.name} required onChange={(v) => setTax({ name: v ?? "" })} />
                        <NumberField className="w-16" nullable placeholder="Rate" value={tax.rate} onChange={(v) => setTax({ rate: v })} />
                        %
                        <NumberField className="w-20" nullable placeholder="Amount" value={tax.amount} onChange={(v) => setTax({ amount: v })} />
                        <button
                          type="button"
                          aria-label="Remove tax"
                          className="px-1 text-zinc-400 hover:text-red-600"
                          onClick={() => setLine(i, (l) => ({ ...l, taxes: l.taxes.filter((_, j) => j !== t) }))}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className={smallButton}
                    onClick={() =>
                      setLine(i, (l) => ({
                        ...l,
                        taxes: [...l.taxes, { ...(l.taxes.at(-1) ?? { name: "VAT", rate: null }), amount: null }],
                      }))
                    }
                  >
                    + tax
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          className={`${smallButton} mt-3`}
          onClick={() =>
            set("lineItems", [
              ...invoice.lineItems,
              { ...emptyLine, taxes: (invoice.lineItems.at(-1)?.taxes ?? []).map((t) => ({ ...t, amount: null })) },
            ])
          }
        >
          + Add line
        </button>
      </fieldset>

      {/* Totals */}
      <fieldset className={card}>
        <legend className="px-1 text-sm font-semibold">Totals</legend>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="grid flex-1 grid-cols-3 gap-3">
            <NumberField label="Subtotal" invalid={flagged.has("subtotal")} value={invoice.subtotal} onChange={(v) => set("subtotal", v)} />
            <NumberField label="Tax" invalid={flagged.has("taxTotal")} value={invoice.taxTotal} onChange={(v) => set("taxTotal", v)} />
            <NumberField label="Total" invalid={flagged.has("total")} value={invoice.total} onChange={(v) => set("total", v)} />
          </div>
          <button
            type="button"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            onClick={() => setInvoice(recalcTotals)}
          >
            Recalculate from lines
          </button>
        </div>
        <p className="mt-2 text-right text-sm text-zinc-500">
          Total due: <span className="font-semibold text-zinc-900 dark:text-zinc-100">{formatMoney(invoice.total, invoice.currency)}</span>
        </p>
      </fieldset>

      <fieldset className={card}>
        <legend className="px-1 text-sm font-semibold">Notes</legend>
        <textarea
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          rows={3}
          aria-label="Notes"
          value={invoice.notes ?? ""}
          onChange={(e) => set("notes", e.target.value || null)}
        />
      </fieldset>
    </section>
  );
}

function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.9
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      : value >= 0.7
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
        : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`} title="Gemini's own estimate of extraction quality">
      {pct}% confidence
    </span>
  );
}

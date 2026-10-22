"use client";

import { useState } from "react";

export const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

const invalidClass = "border-amber-500 bg-amber-50 dark:border-amber-500 dark:bg-amber-950/40";

type BaseProps = {
  label?: string;
  invalid?: boolean;
  className?: string;
  placeholder?: string;
  type?: "text" | "date" | "email";
};

function Wrapper({ label, className, children }: { label?: string; className?: string; children: React.ReactNode }) {
  if (!label) return <div className={className}>{children}</div>;
  return (
    <label className={`flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400 ${className ?? ""}`}>
      {label}
      {children}
    </label>
  );
}

/** Text input for a nullable string: empty input means null. */
export function TextField({
  value,
  onChange,
  required,
  ...props
}: BaseProps & { value: string | null; onChange: (v: string | null) => void; required?: boolean }) {
  return (
    <Wrapper label={props.label} className={props.className}>
      <input
        type={props.type ?? "text"}
        className={`${inputClass} ${props.invalid ? invalidClass : ""}`}
        value={value ?? ""}
        placeholder={props.placeholder}
        aria-label={props.label ? undefined : props.placeholder}
        onChange={(e) => onChange(e.target.value === "" && !required ? null : e.target.value)}
      />
    </Wrapper>
  );
}

/**
 * Number input that keeps the raw text while typing ("1." or "-"), and
 * reports a number (or null when allowed and empty) once it parses.
 */
export function NumberField({
  value,
  onChange,
  nullable,
  ...props
}: BaseProps &
  ({ nullable: true; value: number | null; onChange: (v: number | null) => void } | {
    nullable?: false;
    value: number;
    onChange: (v: number) => void;
  })) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? "" : String(value));

  return (
    <Wrapper label={props.label} className={props.className}>
      <input
        inputMode="decimal"
        className={`${inputClass} text-right tabular-nums ${props.invalid ? invalidClass : ""}`}
        value={shown}
        placeholder={props.placeholder}
        aria-label={props.label ? undefined : props.placeholder}
        onChange={(e) => {
          const raw = e.target.value.replace(",", ".");
          setDraft(raw);
          if (raw.trim() === "") {
            if (nullable) onChange(null);
            return;
          }
          const n = Number(raw);
          if (Number.isFinite(n)) (onChange as (v: number) => void)(n);
        }}
        onBlur={() => setDraft(null)}
      />
    </Wrapper>
  );
}

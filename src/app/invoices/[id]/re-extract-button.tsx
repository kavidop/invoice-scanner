"use client";

import { useState, useTransition } from "react";
import { reExtractAction } from "./actions";

export function ReExtractButton({
  id,
  label = "Run extraction again",
  confirm,
}: {
  id: string;
  label?: string;
  confirm?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          startTransition(async () => {
            const result = await reExtractAction(id);
            setError(result.ok ? null : result.error);
          });
        }}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {pending ? "Extracting…" : label}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

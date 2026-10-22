"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { inputClass } from "@/components/fields";

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif";

type IngestResponse = { id: string; duplicate: boolean } | { error: string };

export function UploadForm() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(label: string, init: RequestInit) {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch("/api/invoices", { method: "POST", ...init });
      const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as IngestResponse;
      if ("error" in body) throw new Error(body.error);
      router.push(`/invoices/${body.id}${body.duplicate ? "?duplicate=1" : ""}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  function uploadFile(file: File | undefined) {
    if (!file || busy) return;
    const form = new FormData();
    form.append("file", file);
    void submit(file.name, { body: form });
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="button"
        tabIndex={0}
        aria-disabled={!!busy}
        onClick={() => !busy && fileInput.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          uploadFile(e.dataTransfer.files[0]);
        }}
        className={`flex min-h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragging
            ? "border-sky-500 bg-sky-50 dark:bg-sky-950/30"
            : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
        } ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        <svg aria-hidden viewBox="0 0 24 24" className="size-8 text-zinc-400" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>
        <p className="font-medium">Drop an invoice here, or click to choose a file</p>
        <p className="text-sm text-zinc-500">PDF, PNG, JPEG, WEBP or HEIC · up to 14 MB</p>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            uploadFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim() && !busy) void submit(url.trim(), {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: url.trim() }),
          });
        }}
      >
        <input
          type="url"
          required
          placeholder="…or paste a link to an e-invoice (https://…)"
          aria-label="Invoice URL"
          className={`${inputClass} flex-1 py-2`}
          value={url}
          disabled={!!busy}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          type="submit"
          disabled={!!busy || !url.trim()}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Fetch invoice
        </button>
      </form>

      {busy && (
        <p role="status" className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <span className="size-4 animate-spin rounded-full border-2 border-zinc-300 border-t-sky-500" />
          Reading <span className="max-w-64 truncate font-medium">{busy}</span> with Gemini — this usually takes 10–30 seconds…
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

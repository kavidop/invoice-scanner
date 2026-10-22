export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Invoice Scanner</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Upload a scanned invoice or paste the URL of an e-invoice. Gemini extracts the supplier,
        line items and taxes; you review the result and push it to Zoho Books.
      </p>
      <p className="text-sm text-zinc-500">
        Upload flow coming in Phase 1 — see <code>docs/PLAN.md</code>. Environment status:{" "}
        <a className="underline" href="/api/health">
          /api/health
        </a>
      </p>
    </main>
  );
}

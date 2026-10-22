export function DocumentViewer({
  id,
  mimeType,
  sourceRef,
  sourceKind,
}: {
  id: string;
  mimeType: string | null;
  sourceRef: string;
  sourceKind: "file" | "url";
}) {
  const src = `/api/invoices/${id}/source`;
  const frame = "h-[60vh] w-full rounded-lg border border-zinc-200 bg-white lg:h-[calc(100vh-10rem)] dark:border-zinc-800";

  return (
    <section className="flex flex-col gap-2 lg:sticky lg:top-4 lg:self-start">
      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
        {sourceKind === "url" ? (
          <a href={sourceRef} target="_blank" rel="noreferrer noopener" className="truncate hover:underline">
            {sourceRef}
          </a>
        ) : (
          <span className="truncate">{sourceRef}</span>
        )}
        <a href={src} target="_blank" rel="noreferrer" className="shrink-0 hover:underline">
          Open original ↗
        </a>
      </div>
      {mimeType?.startsWith("image/") && !mimeType.includes("hei") ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, dynamic document
        <img src={src} alt="Invoice document" className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800" />
      ) : mimeType === "application/pdf" ? (
        <iframe src={src} title="Invoice document" className={frame} />
      ) : mimeType === "text/html" || mimeType === "application/xml" ? (
        <iframe src={src} title="Invoice document" sandbox="" className={frame} />
      ) : (
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-700">
          This file type can&apos;t be previewed in the browser.{" "}
          <a href={src} className="underline">
            Download it
          </a>
          .
        </p>
      )}
    </section>
  );
}

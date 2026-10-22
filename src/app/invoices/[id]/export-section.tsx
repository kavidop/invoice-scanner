import { ConnectorNotConfiguredError } from "@/lib/connectors";
import { getExportContext, type ExportContext } from "@/lib/invoices/export";
import { ExportPanel } from "./export-panel";

export const exportCard = "min-w-0 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800";

/** Server part of the export step: talks to the destination, then hands off to the panel. */
export async function ExportSection({ id }: { id: string }) {
  let context: ExportContext | null;
  try {
    context = await getExportContext(id);
  } catch (err) {
    const notConfigured = err instanceof ConnectorNotConfiguredError;
    return (
      <section className={exportCard}>
        <h2 className="font-semibold">Export to Zoho Books</h2>
        <p className={`mt-2 text-sm ${notConfigured ? "text-zinc-600 dark:text-zinc-400" : "text-red-700 dark:text-red-400"}`}>
          {notConfigured
            ? (err as Error).message
            : `Couldn't reach Zoho Books: ${err instanceof Error ? err.message : String(err)}`}
        </p>
        {notConfigured && (
          <p className="mt-1 text-xs text-zinc-500">
            To try the flow without an account, set <code>DESTINATION_MOCK=true</code>.
          </p>
        )}
      </section>
    );
  }

  if (!context) {
    return (
      <section className={exportCard}>
        <h2 className="font-semibold">Export to Zoho Books</h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Save your review to continue to export.</p>
      </section>
    );
  }

  return <ExportPanel id={id} context={context} />;
}

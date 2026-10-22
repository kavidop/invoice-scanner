import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { formatMoney } from "@/components/status-badge";
import { listDestinations } from "@/lib/connectors";
import { listSupplierProducts } from "@/lib/products/service";
import { formatAddress, getSupplier } from "@/lib/suppliers/service";

export default function SupplierPage({ params }: PageProps<"/suppliers/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <SupplierDetail params={params} />
      </Suspense>
    </main>
  );
}

async function SupplierDetail({ params }: Pick<PageProps<"/suppliers/[id]">, "params">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const found = await getSupplier(id);
  if (!found) notFound();
  const { supplier, links } = found;
  const products = await listSupplierProducts(id);
  const orgName = (key: string) => listDestinations().find((d) => d.key === key)?.label ?? key;

  return (
    <>
      <div>
        <Link href="/suppliers" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          ← Suppliers
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{supplier.name}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {[supplier.taxId && `ΑΦΜ ${supplier.taxId}`, supplier.email, supplier.phone, formatAddress(supplier.address)]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {links.length > 0 && (
          <p className="mt-1 text-xs text-zinc-500">
            {links.map((l) => `${orgName(l.destination)}: vendor ${l.externalId}`).join(" · ")}
          </p>
        )}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Products ({products.length})</h2>
        {products.length === 0 ? (
          <p className="text-sm text-zinc-500">Products are recorded when this supplier&apos;s invoices are exported.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900">
                <tr>
                  <th className="px-3 py-2 font-medium">Supplier code</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 text-right font-medium">Last price</th>
                  <th className="px-3 py-2 text-right font-medium">Invoices</th>
                  <th className="px-3 py-2 font-medium">Zoho item</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {products.map(({ product, links }) => (
                  <tr key={product.id} className="align-top">
                    <td className="px-3 py-2 font-mono text-xs">{product.supplierCode ?? "—"}</td>
                    <td className="px-3 py-2">{product.description}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(product.lastUnitPrice, product.currency)}
                      {product.unit && <span className="text-xs text-zinc-500"> / {product.unit}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{product.timesSeen}</td>
                    <td className="px-3 py-2 text-xs">
                      {links.length === 0 ? (
                        <span className="text-zinc-500">Not linked</span>
                      ) : (
                        links.map((l) => (
                          <div key={l.id}>
                            {l.externalItemName}
                            {l.externalSku && <span className="text-zinc-500"> [{l.externalSku}]</span>}
                            {listDestinations().length > 1 && <span className="text-zinc-500"> · {orgName(l.destination)}</span>}
                          </div>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

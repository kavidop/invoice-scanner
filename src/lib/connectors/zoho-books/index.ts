import "server-only";
import type { Invoice, Supplier } from "@/lib/invoice/schema";
import { normalizeName } from "@/lib/suppliers/normalize";
import {
  rateKey,
  type Attachment,
  type BillMapping,
  type Connector,
  type ExportResult,
  type ExternalAccount,
  type ExternalItem,
  type ExternalSupplier,
  type ExternalTax,
  type NewItem,
} from "../types";
import { ZohoClient, type ZohoConfig } from "./client";

type ZohoContact = {
  contact_id: string;
  contact_name: string;
  company_name?: string;
  email?: string;
  currency_code?: string;
};

type ZohoTax = { tax_id: string; tax_name: string; tax_percentage: number; tax_type?: string };
type ZohoAccount = { account_id: string; account_name: string; account_type: string; is_active?: boolean };
type ZohoCurrency = { currency_id: string; currency_code: string };
type ZohoItem = {
  item_id: string;
  name: string;
  sku?: string;
  unit?: string;
  purchase_rate?: number;
  purchase_description?: string;
  status?: string;
};

const toItem = (i: ZohoItem): ExternalItem => ({
  id: i.item_id,
  name: i.name,
  sku: i.sku || null,
  unit: i.unit || null,
  purchaseRate: i.purchase_rate ?? null,
  purchaseDescription: i.purchase_description || null,
});

/** Account types that can carry a purchase bill line. */
const EXPENSE_ACCOUNT_TYPES = new Set(["expense", "cost_of_goods_sold", "other_expense", "fixed_asset"]);

export type ZohoBooksOptions = ZohoConfig & {
  /** Organization name, shown in the UI. */
  organizationName: string;
  /** Type of items created from invoice lines. */
  itemType?: "inventory" | "purchases" | "sales_and_purchases";
  /**
   * Contact field holding the supplier's tax number. Depends on the Zoho
   * edition: `vat_reg_no` (EU/UK), `gst_no` (India), `tax_reg_no` (AU/NZ/CA...).
   * Unset means the tax ID is not sent.
   */
  taxIdField?: string;
};

export class ZohoBooksConnector implements Connector {
  readonly id: string;
  readonly label: string;

  private readonly client: ZohoClient;
  private cache = new Map<string, { at: number; value: unknown }>();

  constructor(
    private readonly options: ZohoBooksOptions,
    client?: ZohoClient,
  ) {
    this.client = client ?? new ZohoClient(options);
    this.id = `zoho-books:${options.organizationId}`;
    this.label = options.organizationName;
  }

  async searchSuppliers(supplier: Supplier): Promise<ExternalSupplier[]> {
    const target = normalizeName(supplier.name);
    // Search on the most distinctive word, then rank locally: Zoho's "contains"
    // is literal, so "Acme S.A." would miss "ACME SA".
    const term = target.split(" ").sort((a, b) => b.length - a.length)[0] || supplier.name;
    const { contacts } = await this.client.request<{ contacts: ZohoContact[] }>("GET", "/contacts", {
      query: { contact_type: "vendor", contact_name_contains: term, per_page: "50" },
    });

    const score = (c: ZohoContact) => {
      const names = [c.contact_name, c.company_name ?? ""].map(normalizeName);
      if (names.includes(target)) return 3;
      if (supplier.email && c.email?.toLowerCase() === supplier.email.toLowerCase()) return 2;
      return names.some((n) => n && (n.includes(target) || target.includes(n))) ? 1 : 0;
    };

    return contacts
      .map((c) => ({ c, s: score(c) }))
      .filter(({ s }) => s > 0)
      .sort((a, b) => b.s - a.s)
      .map(({ c }) => ({
        externalId: c.contact_id,
        name: c.contact_name,
        email: c.email ?? null,
        currency: c.currency_code ?? null,
      }));
  }

  async upsertSupplier(supplier: Supplier, options: { externalId?: string; currency?: string }): Promise<string> {
    const a = supplier.address;
    const payload: Record<string, unknown> = {
      contact_name: supplier.name,
      company_name: supplier.name,
      contact_type: "vendor",
      website: supplier.website ?? undefined,
      billing_address: a
        ? {
            address: a.line1 ?? undefined,
            street2: a.line2 ?? undefined,
            city: a.city ?? undefined,
            state: a.state ?? undefined,
            zip: a.postalCode ?? undefined,
            country: a.country ?? undefined,
          }
        : undefined,
      contact_persons:
        supplier.email || supplier.phone
          ? [{ email: supplier.email ?? undefined, phone: supplier.phone ?? undefined, is_primary_contact: true }]
          : undefined,
    };
    if (this.options.taxIdField && supplier.taxId) payload[this.options.taxIdField] = supplier.taxId;
    if (supplier.iban) payload.notes = `IBAN: ${supplier.iban}`;

    if (options.externalId) {
      // Contact persons are managed separately once a contact exists; re-sending
      // them would create duplicates.
      delete payload.contact_persons;
      const { contact } = await this.client.request<{ contact: ZohoContact }>("PUT", `/contacts/${options.externalId}`, {
        json: payload,
      });
      return contact.contact_id;
    }

    // Currency can only be chosen when the vendor is created.
    if (options.currency) payload.currency_id = await this.currencyId(options.currency);
    const { contact } = await this.client.request<{ contact: ZohoContact }>("POST", "/contacts", { json: payload });
    return contact.contact_id;
  }

  /** Settings lists change rarely; keep them for a few minutes. */
  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value as T;
    const value = await load();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  listTaxes(): Promise<ExternalTax[]> {
    return this.cached("taxes", async () =>
      (await this.client.request<{ taxes: ZohoTax[] }>("GET", "/settings/taxes")).taxes.map((t) => ({
        id: t.tax_id,
        name: t.tax_name,
        rate: t.tax_percentage,
      })),
    );
  }

  listExpenseAccounts(): Promise<ExternalAccount[]> {
    return this.cached("accounts", async () => {
      const { chartofaccounts } = await this.client.request<{ chartofaccounts: ZohoAccount[] }>(
        "GET",
        "/chartofaccounts",
        { query: { filter_by: "AccountType.Active", per_page: "200" } },
      );
      return chartofaccounts
        .filter((a) => EXPENSE_ACCOUNT_TYPES.has(a.account_type) && a.is_active !== false)
        .map((a) => ({ id: a.account_id, name: a.account_name, type: a.account_type }));
    });
  }

  listItems(): Promise<ExternalItem[]> {
    return this.cached("items", async () => {
      const items: ExternalItem[] = [];
      // Catalogues are small for this use; cap the walk at 2,000 items.
      for (let page = 1; page <= 10; page++) {
        const res = await this.client.request<{ items: ZohoItem[]; page_context?: { has_more_page?: boolean } }>(
          "GET",
          "/items",
          { query: { filter_by: "Status.Active", per_page: "200", page: String(page) } },
        );
        items.push(...res.items.map(toItem));
        if (!res.page_context?.has_more_page) break;
      }
      return items;
    });
  }

  async createItem(item: NewItem): Promise<ExternalItem> {
    const type = this.options.itemType ?? "inventory";
    const payload: Record<string, unknown> = {
      name: item.name,
      sku: item.sku ?? undefined,
      unit: item.unit ?? undefined,
      item_type: type,
      product_type: "goods",
      purchase_rate: item.purchaseRate,
      purchase_description: item.description,
      purchase_account_id: item.purchaseAccountId,
      vendor_id: item.vendorId, // preferred vendor
      // Zoho requires a selling price; start from cost and let the team adjust it.
      rate: item.purchaseRate,
    };
    if (type === "inventory") payload.inventory_account_id = await this.inventoryAccountId();

    const { item: created } = await this.client.request<{ item: ZohoItem }>("POST", "/items", { json: payload });
    this.cache.delete("items");
    return toItem(created);
  }

  private async inventoryAccountId(): Promise<string> {
    const accounts = await this.cached("stock-accounts", async () => {
      const { chartofaccounts } = await this.client.request<{ chartofaccounts: ZohoAccount[] }>(
        "GET",
        "/chartofaccounts",
        { query: { filter_by: "AccountType.Active", per_page: "200" } },
      );
      return chartofaccounts.filter((a) => a.account_type === "stock");
    });
    if (!accounts[0]) throw new Error(`${this.label} has no inventory (stock) account; enable inventory tracking in Zoho Books`);
    return accounts[0].account_id;
  }

  async findBill(vendorId: string, billNumber: string): Promise<ExportResult | null> {
    const { bills } = await this.client.request<{ bills: { bill_id: string; bill_number: string }[] }>("GET", "/bills", {
      query: { vendor_id: vendorId, bill_number: billNumber },
    });
    const bill = bills.find((b) => b.bill_number === billNumber);
    return bill ? { externalId: bill.bill_id, externalUrl: this.billUrl(bill.bill_id) } : null;
  }

  async createBill(invoice: Invoice, vendorId: string, mapping: BillMapping, attachment?: Attachment): Promise<ExportResult> {
    const { bill } = await this.client.request<{ bill: { bill_id: string } }>("POST", "/bills", {
      json: buildBillPayload(invoice, vendorId, mapping),
    });

    if (attachment) {
      const form = new FormData();
      form.append(
        "attachment",
        new Blob([new Uint8Array(attachment.data)], { type: attachment.mimeType }),
        attachment.filename,
      );
      await this.client.request("POST", `/bills/${bill.bill_id}/attachment`, { form });
    }

    return { externalId: bill.bill_id, externalUrl: this.billUrl(bill.bill_id) };
  }

  private billUrl(billId: string) {
    return `${this.client.appBase}#/bills/${billId}`;
  }

  private async currencyId(code: string): Promise<string | undefined> {
    const currencies = await this.cached(
      "currencies",
      async () => (await this.client.request<{ currencies: ZohoCurrency[] }>("GET", "/settings/currencies")).currencies,
    );
    const id = currencies.find((c) => c.currency_code === code.toUpperCase())?.currency_id;
    if (!id) throw new Error(`Currency ${code} is not enabled in Zoho Books (Settings → Currencies)`);
    return id;
  }
}

export function buildBillPayload(invoice: Invoice, vendorId: string, mapping: BillMapping) {
  return {
    vendor_id: vendorId,
    bill_number: invoice.invoiceNumber,
    reference_number: invoice.mark ? `ΜΑΡΚ ${invoice.mark}` : undefined,
    date: invoice.issueDate,
    due_date: invoice.dueDate ?? undefined,
    is_inclusive_tax: false,
    notes: invoice.notes ?? undefined,
    line_items: invoice.lineItems.map((line, i) => {
      // Zoho takes one tax (or tax group) per line; a line with several taxes
      // needs a tax group in Zoho, mapped from its first rate.
      const taxId = mapping.taxes[rateKey(line.taxes[0]?.rate ?? null)];
      // Line-level discounts depend on an org setting in Zoho, so a discount is
      // folded into the unit rate instead; the line total stays exact.
      const discounted = line.discount && line.quantity ? (line.quantity * line.unitPrice - line.discount) / line.quantity : null;
      const description = [line.sku, line.description].filter(Boolean).join(" — ");
      const { itemId, accountId } = mapping.lines[i];
      return {
        // With an item, Zoho posts to the item's own purchase/inventory account.
        item_id: itemId ?? undefined,
        account_id: itemId ? undefined : accountId,
        description: line.discount
          ? `${description} (${line.quantity} × ${line.unitPrice} less discount ${line.discount})`
          : description,
        quantity: line.quantity,
        rate: discounted === null ? line.unitPrice : Math.round(discounted * 10_000) / 10_000,
        unit: line.unit ?? undefined,
        tax_id: taxId ?? undefined,
      };
    }),
  };
}

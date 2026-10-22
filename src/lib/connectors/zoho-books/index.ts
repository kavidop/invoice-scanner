import "server-only";
import type { Invoice, Supplier } from "@/lib/invoice/schema";
import { normalizeName } from "@/lib/suppliers/normalize";
import type { Attachment, Connector, ExportResult, ExternalSupplier } from "../types";
import { ZohoClient, type ZohoConfig } from "./client";

type ZohoContact = {
  contact_id: string;
  contact_name: string;
  company_name?: string;
  email?: string;
};

type ZohoTax = { tax_id: string; tax_name: string; tax_percentage: number };

export type ZohoBooksOptions = ZohoConfig & {
  /** Expense account used for bill lines (required by Zoho when no item_id is given). */
  defaultExpenseAccountId?: string;
};

export class ZohoBooksConnector implements Connector {
  readonly id = "zoho-books";
  readonly label = "Zoho Books";

  private readonly client: ZohoClient;
  private taxesCache?: ZohoTax[];

  constructor(private readonly options: ZohoBooksOptions) {
    this.client = new ZohoClient(options);
  }

  async findSupplier(supplier: Supplier): Promise<ExternalSupplier | null> {
    const { contacts } = await this.client.request<{ contacts: ZohoContact[] }>("GET", "/contacts", {
      query: { contact_type: "vendor", contact_name_contains: supplier.name },
    });
    const target = normalizeName(supplier.name);
    const match = contacts.find(
      (c) => normalizeName(c.contact_name) === target || normalizeName(c.company_name ?? "") === target,
    );
    return match
      ? { externalId: match.contact_id, name: match.contact_name, email: match.email ?? null }
      : null;
  }

  async upsertSupplier(supplier: Supplier, externalId?: string): Promise<string> {
    const a = supplier.address;
    const payload = {
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
      // TODO: tax ID field depends on the org's edition (vat_reg_no, gst_no, tax_reg_no...).
      contact_persons:
        supplier.email || supplier.phone
          ? [{ email: supplier.email ?? undefined, phone: supplier.phone ?? undefined, is_primary_contact: true }]
          : undefined,
    };

    const { contact } = externalId
      ? await this.client.request<{ contact: ZohoContact }>("PUT", `/contacts/${externalId}`, { json: payload })
      : await this.client.request<{ contact: ZohoContact }>("POST", "/contacts", { json: payload });
    return contact.contact_id;
  }

  async createBill(invoice: Invoice, vendorId: string, attachment?: Attachment): Promise<ExportResult> {
    const taxes = await this.taxes();
    const taxIdFor = (rate: number | null) =>
      rate === null ? undefined : taxes.find((t) => Math.abs(t.tax_percentage - rate) < 0.001)?.tax_id;

    const { bill } = await this.client.request<{ bill: { bill_id: string } }>("POST", "/bills", {
      json: {
        vendor_id: vendorId,
        bill_number: invoice.invoiceNumber,
        date: invoice.issueDate,
        due_date: invoice.dueDate ?? undefined,
        is_inclusive_tax: false,
        notes: invoice.notes ?? undefined,
        line_items: invoice.lineItems.map((line) => ({
          account_id: this.options.defaultExpenseAccountId,
          name: line.sku ?? undefined,
          description: line.description,
          quantity: line.quantity,
          rate: line.unitPrice,
          unit: line.unit ?? undefined,
          discount: line.discount ?? undefined,
          // Zoho supports one tax (or tax group) per line; compound taxes need a tax group.
          tax_id: taxIdFor(line.taxes[0]?.rate ?? null),
        })),
      },
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

    return { externalId: bill.bill_id, externalUrl: `${this.client.appBase}#/bills/${bill.bill_id}` };
  }

  private async taxes(): Promise<ZohoTax[]> {
    this.taxesCache ??= (await this.client.request<{ taxes: ZohoTax[] }>("GET", "/settings/taxes")).taxes;
    return this.taxesCache;
  }
}

import type { Invoice, Supplier } from "@/lib/invoice/schema";

export type ExternalSupplier = {
  externalId: string;
  name: string;
  email?: string | null;
  currency?: string | null;
};

export type ExternalTax = { id: string; name: string; rate: number };
export type ExternalAccount = { id: string; name: string; type: string };

export type ExportResult = {
  externalId: string;
  externalUrl?: string;
};

export type Attachment = { filename: string; mimeType: string; data: Buffer };

/** Choices the user makes in the export panel. */
export type BillMapping = {
  /** Tax rate (as a string key, e.g. "24") → destination tax id, or null for no tax. */
  taxes: Record<string, string | null>;
  /** Destination expense account per line, same order as `invoice.lineItems`. */
  lineAccountIds: string[];
};

/** Key used to map a tax rate; avoids float keys like "23.999999". */
export const rateKey = (rate: number | null) => (rate === null ? "none" : String(Math.round(rate * 1000) / 1000));

/**
 * A destination accounting system. Zoho Books is the default; others
 * (QuickBooks, Xero, a generic webhook...) implement the same contract.
 */
export interface Connector {
  readonly id: string;
  readonly label: string;

  /** Vendors whose name resembles the supplier's, best match first. */
  searchSuppliers(supplier: Supplier): Promise<ExternalSupplier[]>;

  /** Create the supplier, or update it when `externalId` is given. Returns the external id. */
  upsertSupplier(supplier: Supplier, options: { externalId?: string; currency?: string }): Promise<string>;

  listTaxes(): Promise<ExternalTax[]>;
  listExpenseAccounts(): Promise<ExternalAccount[]>;

  /** An existing bill with this number for this vendor, if any (duplicate guard). */
  findBill(supplierExternalId: string, billNumber: string): Promise<ExportResult | null>;

  createBill(
    invoice: Invoice,
    supplierExternalId: string,
    mapping: BillMapping,
    attachment?: Attachment,
  ): Promise<ExportResult>;
}

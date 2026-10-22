import type { Invoice, Supplier } from "@/lib/invoice/schema";

export type ExternalSupplier = {
  externalId: string;
  name: string;
  taxId?: string | null;
  email?: string | null;
};

export type ExportResult = {
  externalId: string;
  externalUrl?: string;
};

export type Attachment = { filename: string; mimeType: string; data: Buffer };

/**
 * A destination accounting system. Zoho Books is the default; others
 * (QuickBooks, Xero, a generic webhook...) implement the same contract.
 */
export interface Connector {
  readonly id: string;
  readonly label: string;

  /** Look up a supplier/vendor in the destination; null if no confident match. */
  findSupplier(supplier: Supplier): Promise<ExternalSupplier | null>;

  /** Create the supplier, or update it when `externalId` is given. Returns the external id. */
  upsertSupplier(supplier: Supplier, externalId?: string): Promise<string>;

  /** Create the purchase bill for an already-resolved supplier. */
  createBill(
    invoice: Invoice,
    supplierExternalId: string,
    attachment?: Attachment,
  ): Promise<ExportResult>;
}

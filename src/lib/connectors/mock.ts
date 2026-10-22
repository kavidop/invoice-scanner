import "server-only";
import type { Invoice, Supplier } from "@/lib/invoice/schema";
import { normalizeName } from "@/lib/suppliers/normalize";
import type { BillMapping, Connector, ExportResult, ExternalAccount, ExternalSupplier, ExternalTax } from "./types";

type Store = {
  vendors: (ExternalSupplier & { supplier: Supplier })[];
  bills: { id: string; vendorId: string; number: string; invoice: Invoice; mapping: BillMapping }[];
};

// Survives hot reloads so the dev UI behaves like a real backend.
const globalStore = globalThis as unknown as { mockDestination?: Store };

/**
 * In-memory stand-in for Zoho Books (DESTINATION_MOCK=true), for working on
 * the export flow without credentials. Pre-seeded with a few vendors.
 */
export class MockConnector implements Connector {
  readonly id = "zoho-books";
  readonly label = "Zoho Books (mock)";

  get store(): Store {
    globalStore.mockDestination ??= {
      vendors: [
        { externalId: "v-1001", name: "Northwind Office Supplies SA", email: "billing@northwind.example", currency: "EUR", supplier: { name: "Northwind Office Supplies SA", taxId: null, email: "billing@northwind.example", phone: null, website: null, iban: null, address: null } },
        { externalId: "v-1002", name: "Contoso Logistics", email: null, currency: "EUR", supplier: { name: "Contoso Logistics", taxId: null, email: null, phone: null, website: null, iban: null, address: null } },
      ],
      bills: [],
    };
    return globalStore.mockDestination;
  }

  static reset() {
    globalStore.mockDestination = undefined;
  }

  async searchSuppliers(supplier: Supplier) {
    const target = normalizeName(supplier.name);
    return this.store.vendors.filter((v) => {
      const n = normalizeName(v.name);
      return n === target || n.includes(target) || target.includes(n);
    });
  }

  async upsertSupplier(supplier: Supplier, options: { externalId?: string; currency?: string }) {
    const existing = this.store.vendors.find((v) => v.externalId === options.externalId);
    if (options.externalId && !existing) throw new Error(`Vendor ${options.externalId} not found`);
    if (existing) {
      Object.assign(existing, { name: supplier.name, email: supplier.email, supplier });
      return existing.externalId;
    }
    const externalId = `v-${1001 + this.store.vendors.length}`;
    this.store.vendors.push({ externalId, name: supplier.name, email: supplier.email, currency: options.currency, supplier });
    return externalId;
  }

  async listTaxes(): Promise<ExternalTax[]> {
    return [
      { id: "t-24", name: "VAT 24%", rate: 24 },
      { id: "t-13", name: "VAT 13%", rate: 13 },
      { id: "t-6", name: "VAT 6%", rate: 6 },
      { id: "t-0", name: "Zero rated", rate: 0 },
    ];
  }

  async listExpenseAccounts(): Promise<ExternalAccount[]> {
    return [
      { id: "a-office", name: "Office Supplies", type: "expense" },
      { id: "a-shipping", name: "Postage & Shipping", type: "expense" },
      { id: "a-cogs", name: "Cost of Goods Sold", type: "cost_of_goods_sold" },
    ];
  }

  async findBill(vendorId: string, billNumber: string): Promise<ExportResult | null> {
    const bill = this.store.bills.find((b) => b.vendorId === vendorId && b.number === billNumber);
    return bill ? { externalId: bill.id, externalUrl: `https://books.example/bills/${bill.id}` } : null;
  }

  async createBill(invoice: Invoice, vendorId: string, mapping: BillMapping): Promise<ExportResult> {
    const missing = mapping.lineAccountIds.findIndex((id) => !id);
    if (missing >= 0) throw new Error(`Line ${missing + 1}: an account is required`);
    const id = `b-${5001 + this.store.bills.length}`;
    this.store.bills.push({ id, vendorId, number: invoice.invoiceNumber, invoice, mapping });
    return { externalId: id, externalUrl: `https://books.example/bills/${id}` };
  }
}

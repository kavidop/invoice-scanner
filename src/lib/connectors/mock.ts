import "server-only";
import type { Invoice, Supplier } from "@/lib/invoice/schema";
import { normalizeName } from "@/lib/suppliers/normalize";
import type {
  BillMapping,
  Connector,
  ExportResult,
  ExternalAccount,
  ExternalItem,
  ExternalSupplier,
  ExternalTax,
  NewItem,
} from "./types";

export const MOCK_ORGANIZATIONS = [
  { id: "mock-alpha", name: "Alpha Trading Α.Ε. (mock)", taxId: "EL800000001", expenseAccountId: undefined },
  { id: "mock-beta", name: "Beta Services Ι.Κ.Ε. (mock)", taxId: "EL800000002", expenseAccountId: undefined },
];

type Store = {
  vendors: (ExternalSupplier & { supplier: Supplier })[];
  items: (ExternalItem & { vendorId?: string; purchaseAccountId?: string })[];
  bills: { id: string; vendorId: string; number: string; invoice: Invoice; mapping: BillMapping }[];
};

const blankSupplier = (name: string, email: string | null = null): Supplier => ({
  name, taxId: null, email, phone: null, website: null, iban: null, address: null,
});

function seed(): Store {
  return {
    vendors: [
      { externalId: "v-1001", name: "Northwind Office Supplies SA", email: "billing@northwind.example", currency: "EUR", supplier: blankSupplier("Northwind Office Supplies SA", "billing@northwind.example") },
      { externalId: "v-1002", name: "Contoso Logistics", email: null, currency: "EUR", supplier: blankSupplier("Contoso Logistics") },
    ],
    items: [
      { id: "i-2001", name: "Χαρτί A4 80gr (κιβώτιο 5 δεσμίδων)", sku: "PAPER-A4", unit: "box", purchaseRate: 24, purchaseDescription: "A4 copy paper 80 g/m2, box of 5 reams" },
      { id: "i-2002", name: "Toner HP 26A black", sku: "HP-CF226A", unit: "pcs", purchaseRate: 88, purchaseDescription: null },
      { id: "i-2003", name: "Stapler heavy duty", sku: "STP-HD", unit: "pcs", purchaseRate: 12, purchaseDescription: null },
    ],
    bills: [],
  };
}

// Survives hot reloads so the dev UI behaves like a real backend.
const globalStore = globalThis as unknown as { mockDestinations?: Map<string, Store> };

/**
 * In-memory stand-in for a Zoho Books organization (DESTINATION_MOCK=true),
 * for working on the export flow without credentials.
 */
export class MockConnector implements Connector {
  readonly id: string;
  readonly label: string;

  constructor(org: { id: string; name: string }) {
    this.id = `zoho-books:${org.id}`;
    this.label = org.name;
  }

  get store(): Store {
    globalStore.mockDestinations ??= new Map();
    if (!globalStore.mockDestinations.has(this.id)) globalStore.mockDestinations.set(this.id, seed());
    return globalStore.mockDestinations.get(this.id)!;
  }

  static reset() {
    globalStore.mockDestinations = undefined;
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
      { id: "t-24", name: "ΦΠΑ 24%", rate: 24 },
      { id: "t-13", name: "ΦΠΑ 13%", rate: 13 },
      { id: "t-6", name: "ΦΠΑ 6%", rate: 6 },
      { id: "t-0", name: "ΦΠΑ 0%", rate: 0 },
    ];
  }

  async listExpenseAccounts(): Promise<ExternalAccount[]> {
    return [
      { id: "a-cogs", name: "Cost of Goods Sold", type: "cost_of_goods_sold" },
      { id: "a-office", name: "Office Supplies", type: "expense" },
      { id: "a-shipping", name: "Postage & Shipping", type: "expense" },
    ];
  }

  async listItems(): Promise<ExternalItem[]> {
    return this.store.items.map((i) => ({
      id: i.id,
      name: i.name,
      sku: i.sku,
      unit: i.unit,
      purchaseRate: i.purchaseRate,
      purchaseDescription: i.purchaseDescription,
    }));
  }

  async createItem(item: NewItem): Promise<ExternalItem> {
    if (this.store.items.some((i) => i.name.toLowerCase() === item.name.toLowerCase())) {
      throw new Error(`An item named "${item.name}" already exists`);
    }
    const created = {
      id: `i-${2001 + this.store.items.length}`,
      name: item.name,
      sku: item.sku,
      unit: item.unit,
      purchaseRate: item.purchaseRate,
      purchaseDescription: item.description,
    };
    this.store.items.push({ ...created, vendorId: item.vendorId, purchaseAccountId: item.purchaseAccountId });
    return created;
  }

  async findBill(vendorId: string, billNumber: string): Promise<ExportResult | null> {
    const bill = this.store.bills.find((b) => b.vendorId === vendorId && b.number === billNumber);
    return bill ? { externalId: bill.id, externalUrl: `https://books.example/bills/${bill.id}` } : null;
  }

  async createBill(invoice: Invoice, vendorId: string, mapping: BillMapping): Promise<ExportResult> {
    const missing = mapping.lines.findIndex((l) => !l.itemId && !l.accountId);
    if (missing >= 0) throw new Error(`Line ${missing + 1}: an account is required`);
    const id = `b-${5001 + this.store.bills.length}`;
    this.store.bills.push({ id, vendorId, number: invoice.invoiceNumber, invoice, mapping });
    return { externalId: id, externalUrl: `https://books.example/bills/${id}` };
  }
}

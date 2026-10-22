import type { Invoice } from "./schema";

/** Realistic extraction used by GEMINI_MOCK and tests. Has one misread line total so the preview checks have something to flag. */
export const sampleInvoice: Invoice = {
  invoiceNumber: "INV-2026-0142",
  issueDate: "2026-10-15",
  dueDate: "2026-11-14",
  currency: "EUR",
  supplier: {
    name: "Northwind Office Supplies S.A.",
    taxId: "EL094012345",
    email: "billing@northwind.example",
    phone: "+30 210 555 0100",
    website: "northwind.example",
    iban: "GR16 0110 1250 0000 0001 2300 695",
    address: {
      line1: "Leof. Kifisias 120",
      line2: null,
      city: "Athens",
      state: null,
      postalCode: "11526",
      country: "GR",
    },
  },
  buyer: { name: "Alpha Trading Α.Ε.", taxId: "EL800000001" },
  mark: "400001234567890",
  lineItems: [
    {
      description: "A4 copy paper, 80 g/m², box of 5 reams",
      sku: "PAP-A4-80",
      quantity: 10,
      unit: "box",
      unitPrice: 24.5,
      discount: null,
      taxes: [{ name: "VAT 24%", rate: 24, amount: 58.8 }],
      lineTotal: 245,
    },
    {
      description: "Toner cartridge HP 26A",
      sku: "TON-HP26A",
      quantity: 3,
      unit: "pcs",
      unitPrice: 89.9,
      discount: 13.49,
      taxes: [{ name: "VAT 24%", rate: 24, amount: 61.49 }],
      lineTotal: 265.21, // misread digits: should be 256.21
    },
    {
      description: "Delivery",
      sku: null,
      quantity: 1,
      unit: null,
      unitPrice: 15,
      discount: null,
      taxes: [{ name: "VAT 24%", rate: 24, amount: 3.6 }],
      lineTotal: 15,
    },
  ],
  subtotal: 516.21,
  taxTotal: 123.89,
  total: 640.1,
  notes: "Payment by bank transfer within 30 days.",
  confidence: 0.82,
};

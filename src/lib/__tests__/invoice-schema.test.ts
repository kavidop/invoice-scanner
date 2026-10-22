import { describe, expect, it } from "vitest";
import { checkTotals, InvoiceSchema, invoiceJsonSchema, type Invoice } from "@/lib/invoice/schema";

const invoice: Invoice = {
  invoiceNumber: "INV-001",
  issueDate: "2026-10-01",
  dueDate: null,
  currency: "EUR",
  supplier: {
    name: "Acme SA",
    taxId: "EL123456789",
    email: null,
    phone: null,
    website: null,
    iban: null,
    address: null,
  },
  buyer: null,
  mark: null,
  lineItems: [
    {
      description: "Widget",
      sku: "W-1",
      quantity: 2,
      unit: "pcs",
      unitPrice: 10,
      discount: null,
      taxes: [{ name: "VAT 24%", rate: 24, amount: 4.8 }],
      lineTotal: 20,
    },
  ],
  subtotal: 20,
  taxTotal: 4.8,
  total: 24.8,
  notes: null,
  confidence: 0.95,
};

describe("InvoiceSchema", () => {
  it("accepts a well-formed invoice", () => {
    expect(InvoiceSchema.parse(invoice)).toEqual(invoice);
  });

  it("exports a JSON schema for Gemini", () => {
    expect(invoiceJsonSchema).toMatchObject({ type: "object" });
    expect(Object.keys(invoiceJsonSchema.properties ?? {})).toContain("lineItems");
  });
});

describe("checkTotals", () => {
  it("passes when arithmetic adds up", () => {
    expect(checkTotals(invoice)).toEqual([]);
  });

  it("flags a mismatched grand total", () => {
    expect(checkTotals({ ...invoice, total: 30 })).toEqual([
      expect.objectContaining({ path: "total" }),
    ]);
  });
});

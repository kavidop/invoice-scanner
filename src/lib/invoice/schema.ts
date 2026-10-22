import { z } from "zod";

/**
 * Canonical shape of a parsed invoice. Gemini is asked to return exactly this
 * (via its JSON schema), the preview UI edits it, and every destination
 * connector maps from it. Keep it destination-agnostic.
 */

export const TaxSchema = z.object({
  name: z.string().describe('Tax label as printed, e.g. "VAT 24%", "GST", "Sales Tax".'),
  rate: z.number().nullable().describe("Percentage rate, e.g. 24 for 24%. Null if not printed."),
  amount: z.number().nullable().describe("Tax amount in invoice currency. Null if not printed."),
});

export const AddressSchema = z.object({
  line1: z.string().nullable(),
  line2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().nullable().describe("ISO 3166-1 alpha-2 code when it can be inferred."),
});

export const SupplierSchema = z.object({
  name: z.string().describe("Legal or trading name of the company that issued the invoice."),
  taxId: z
    .string()
    .nullable()
    .describe("VAT / GST / TIN / EIN number of the supplier, exactly as printed."),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  iban: z.string().nullable(),
  address: AddressSchema.nullable(),
});

export const LineItemSchema = z.object({
  description: z.string(),
  sku: z.string().nullable().describe("Supplier product code / SKU if printed."),
  quantity: z.number(),
  unit: z.string().nullable().describe('Unit of measure, e.g. "pcs", "kg", "hours".'),
  unitPrice: z.number().describe("Price per unit, excluding tax."),
  discount: z.number().nullable().describe("Discount amount for this line, if any."),
  taxes: z.array(TaxSchema).describe("Taxes applied to this line."),
  lineTotal: z.number().describe("Line total excluding tax, after discount."),
});

export const InvoiceSchema = z.object({
  invoiceNumber: z.string(),
  issueDate: z.string().describe("ISO 8601 date (YYYY-MM-DD)."),
  dueDate: z.string().nullable().describe("ISO 8601 date (YYYY-MM-DD)."),
  currency: z.string().describe("ISO 4217 code, e.g. EUR, USD."),
  supplier: SupplierSchema,
  lineItems: z.array(LineItemSchema),
  subtotal: z.number().describe("Total excluding tax."),
  taxTotal: z.number(),
  total: z.number().describe("Grand total including tax."),
  notes: z.string().nullable(),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Model's own confidence (0-1) that the extraction is complete and correct."),
});

export type Tax = z.infer<typeof TaxSchema>;
export type Supplier = z.infer<typeof SupplierSchema>;
export type LineItem = z.infer<typeof LineItemSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;

/** JSON Schema handed to Gemini's `responseJsonSchema`. */
export const invoiceJsonSchema = z.toJSONSchema(InvoiceSchema, { target: "draft-7" });

export type ValidationIssue = { path: string; message: string };

/**
 * Arithmetic sanity checks shown in the preview so the user can spot
 * extraction mistakes before pushing to the destination.
 */
export function checkTotals(invoice: Invoice, tolerance = 0.02): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const close = (a: number, b: number) => Math.abs(a - b) <= tolerance;

  invoice.lineItems.forEach((line, i) => {
    const expected = line.quantity * line.unitPrice - (line.discount ?? 0);
    if (!close(expected, line.lineTotal)) {
      issues.push({
        path: `lineItems.${i}.lineTotal`,
        message: `quantity × unit price − discount = ${expected.toFixed(2)}, but line total is ${line.lineTotal}`,
      });
    }
  });

  const linesSum = invoice.lineItems.reduce((sum, l) => sum + l.lineTotal, 0);
  if (!close(linesSum, invoice.subtotal)) {
    issues.push({
      path: "subtotal",
      message: `Sum of lines is ${linesSum.toFixed(2)}, but subtotal is ${invoice.subtotal}`,
    });
  }

  if (!close(invoice.subtotal + invoice.taxTotal, invoice.total)) {
    issues.push({
      path: "total",
      message: `subtotal + tax = ${(invoice.subtotal + invoice.taxTotal).toFixed(2)}, but total is ${invoice.total}`,
    });
  }

  return issues;
}

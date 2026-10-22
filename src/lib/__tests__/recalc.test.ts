import { describe, expect, it } from "vitest";
import { sampleInvoice } from "@/lib/invoice/sample";
import { checkTotals, recalcLine, recalcTotals } from "@/lib/invoice/schema";

describe("sample invoice", () => {
  it("flags the misread line and the subtotal it breaks", () => {
    expect(checkTotals(sampleInvoice).map((i) => i.path)).toEqual(["lineItems.1.lineTotal", "subtotal"]);
  });

  it("is clean after recalculating the bad line and the totals", () => {
    const fixed = recalcTotals({
      ...sampleInvoice,
      lineItems: sampleInvoice.lineItems.map((l, i) => (i === 1 ? recalcLine(l) : l)),
    });
    expect(fixed.lineItems[1].lineTotal).toBe(256.21);
    expect(fixed.total).toBe(640.1);
    expect(checkTotals(fixed)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import type { ExternalItem } from "@/lib/connectors/types";
import { matchItems, similarity } from "@/lib/products/match";

const item = (id: string, name: string, sku: string | null = null, purchaseDescription: string | null = null): ExternalItem => ({
  id, name, sku, unit: null, purchaseRate: null, purchaseDescription,
});

describe("similarity", () => {
  it("ignores case, accents, word order and script", () => {
    expect(similarity("ΧΑΡΤΙ Α4 80gr", "χαρτί α4 80gr")).toBe(1);
    expect(similarity("Toner HP 26A", "HP toner 26A")).toBe(1);
    expect(similarity("Καφές Espresso 1kg", "Kafes espresso 1kg")).toBeGreaterThan(0.9);
    expect(similarity("Χαρτί A4", "Toner HP")).toBeLessThan(0.3);
  });
});

describe("matchItems", () => {
  const items = [
    item("1", "Toner HP 26A black", "HP-CF226A"),
    item("2", "Copy paper A4", "PAP-A4-80"),
    item("3", "Stapler"),
  ];

  it("prefers an exact code match, ignoring separators", () => {
    expect(matchItems({ sku: "pap a4 80", description: "Something else" }, items)[0]).toMatchObject({ id: "2", score: 1, reason: "code" });
  });

  it("ranks by name and drops weak matches", () => {
    const found = matchItems({ sku: null, description: "Toner cartridge HP 26A" }, items);
    expect(found.map((f) => f.id)).toEqual(["1"]);
    expect(found[0].score).toBeGreaterThanOrEqual(0.75);
  });
});

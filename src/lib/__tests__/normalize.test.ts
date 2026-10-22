import { describe, expect, it } from "vitest";
import { normalizeName, normalizeTaxId } from "@/lib/suppliers/normalize";

describe("normalizeName", () => {
  it.each([
    ["ACME Hellas S.A.", "acme hellas"],
    ["Acme Hellas SA", "acme hellas"],
    ["Müller & Söhne GmbH", "muller sohne"],
    ["Globex Corporation, Inc.", "globex"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });
});

describe("normalizeTaxId", () => {
  it("strips separators and upper-cases", () => {
    expect(normalizeTaxId("el 123.456-789")).toBe("EL123456789");
  });
});

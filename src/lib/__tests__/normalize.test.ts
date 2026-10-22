import { describe, expect, it } from "vitest";
import { normalizeName, normalizeTaxId } from "@/lib/suppliers/normalize";

describe("normalizeName", () => {
  it.each([
    ["ACME Hellas S.A.", "acme hellas"],
    ["Acme Hellas SA", "acme hellas"],
    ["Müller & Söhne GmbH", "muller sohne"],
    ["Globex Corporation, Inc.", "globex"],
    ["ΑΛΦΑ ΧΗΜΙΚΑ Α.Ε.", "alfa chimika"],
    ["Άλφα Χημικά ΑΕ", "alfa chimika"],
    ["ALFA CHIMIKA S.A.", "alfa chimika"],
    ["Παπαδόπουλος Ι.Κ.Ε.", "papadopoylos"],
    ["ΒΗΤΑ ΜΟΝ. Ε.Π.Ε.", "vita"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });
});

describe("normalizeTaxId", () => {
  it("strips separators and upper-cases", () => {
    expect(normalizeTaxId("de 123.456-789")).toBe("DE123456789");
  });

  it("treats a Greek ΑΦΜ with or without the EL prefix as the same", () => {
    expect(normalizeTaxId("EL094012345")).toBe("094012345");
    expect(normalizeTaxId("094 012 345")).toBe("094012345");
    expect(normalizeTaxId("GR094012345")).toBe("094012345");
  });
});

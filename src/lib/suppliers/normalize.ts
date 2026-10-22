/** Legal-form words dropped when matching (Latin, after Greek transliteration). */
const LEGAL_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "ltd", "limited", "plc", "corp", "corporation", "co", "company",
  "gmbh", "ag", "sa", "sas", "sarl", "srl", "spa", "bv", "nv", "oy", "ab", "as", "aps", "pty", "pvt", "kg", "ohg",
  // Greek: Α.Ε., Ε.Π.Ε., Ο.Ε., Ε.Ε., Ι.Κ.Ε., Μ.Ι.Κ.Ε., Μον. Ε.Π.Ε.
  "ae", "epe", "oe", "ee", "ike", "mike", "mon",
]);

// Simple one-letter Greek → Latin map; good enough to compare names written
// either way (e.g. "ΑΛΦΑ" in the invoice vs "ALFA" in Zoho).
const GREEK_TO_LATIN: Record<string, string> = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m",
  ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
};

/** Lower-case, accent-free, Latin-script text with punctuation collapsed to single spaces. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // strip accents and tonos
    .toLowerCase()
    .replace(/[α-ως]/g, (c) => GREEK_TO_LATIN[c] ?? c)
    .replace(/\./g, "") // dotted abbreviations: s.a. -> sa, α.ε. -> ae
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Canonical form of a company name for matching: "ACME Hellas S.A.",
 * "Acme Hellas SA" and "ΑΚΜΕ ΕΛΛΑΣ Α.Ε." all lose case, accents, script and legal form.
 */
export function normalizeName(name: string): string {
  return normalizeText(name)
    .split(" ")
    .filter((word) => word && !LEGAL_SUFFIXES.has(word))
    .join(" ");
}

/**
 * Tax IDs compared without separators and upper-cased. Greek ΑΦΜ appear both
 * bare (094012345) and as EU VAT numbers (EL094012345), so the prefix is dropped.
 */
export function normalizeTaxId(taxId: string): string {
  const compact = taxId.replace(/[\s.\-/]/g, "").toUpperCase();
  const greek = compact.match(/^(?:EL|GR)(\d{9})$/);
  return greek ? greek[1] : compact;
}

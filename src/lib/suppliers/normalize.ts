const LEGAL_SUFFIXES = [
  "inc", "incorporated", "llc", "ltd", "limited", "plc", "corp", "corporation", "co", "company",
  "gmbh", "ag", "sa", "sas", "sarl", "srl", "spa", "bv", "nv", "oy", "ab", "as", "aps",
  "ae", "ee", "ike", "oe", "pty", "pvt", "kg", "ohg",
];

const SUFFIX_RE = new RegExp(`\\b(${LEGAL_SUFFIXES.join("|")})\\b`, "g");

/**
 * Canonical form of a company name for matching:
 * "ACME Hellas S.A." and "Acme Hellas SA" both become "acme hellas".
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // strip diacritics
    .toLowerCase()
    .replace(/\./g, "") // dotted abbreviations: s.a. -> sa
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(SUFFIX_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tax IDs compared without spaces/dashes/dots and with any country prefix kept upper-case. */
export function normalizeTaxId(taxId: string): string {
  return taxId.replace(/[\s.\-/]/g, "").toUpperCase();
}

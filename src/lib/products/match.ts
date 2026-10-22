import type { ExternalItem } from "@/lib/connectors/types";
import { normalizeText } from "@/lib/suppliers/normalize";

export type ItemCandidate = ExternalItem & { score: number; reason: "code" | "name" };

/** Score at or above which a name match is preselected. */
export const AUTO_MATCH_SCORE = 0.75;

export const normalizeCode = (code: string) => code.replace(/[\s\-_.\/]/g, "").toUpperCase();

function bigrams(text: string): string[] {
  const s = text.replace(/ /g, "");
  return Array.from({ length: Math.max(s.length - 1, 0) }, (_, i) => s.slice(i, i + 2));
}

/** Dice coefficient over a multiset of strings. */
function dice(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const x of a) counts.set(x, (counts.get(x) ?? 0) + 1);
  let shared = 0;
  for (const x of b) {
    const n = counts.get(x) ?? 0;
    if (n > 0) {
      shared++;
      counts.set(x, n - 1);
    }
  }
  return (2 * shared) / (a.length + b.length);
}

/**
 * Text similarity in [0, 1] that tolerates word order, Greek vs Latin script
 * and small spelling differences: the better of word overlap and letter-pair overlap.
 */
export function similarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const words = (s: string) => s.split(" ").filter((w) => w.length > 1);
  return Math.max(dice(words(na), words(nb)), dice(bigrams(na), bigrams(nb)));
}

/** Best catalogue items for an invoice line: exact code first, then by name. */
export function matchItems(
  line: { sku: string | null; description: string },
  items: ExternalItem[],
  limit = 3,
): ItemCandidate[] {
  const code = line.sku ? normalizeCode(line.sku) : null;
  return items
    .map((item): ItemCandidate => {
      if (code && item.sku && normalizeCode(item.sku) === code) return { ...item, score: 1, reason: "code" };
      const score = Math.max(
        similarity(line.description, item.name),
        item.purchaseDescription ? similarity(line.description, item.purchaseDescription) : 0,
      );
      return { ...item, score: Math.round(score * 100) / 100, reason: "name" };
    })
    .filter((c) => c.score >= 0.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

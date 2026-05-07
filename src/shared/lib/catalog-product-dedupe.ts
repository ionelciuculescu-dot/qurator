import type { ParsedProduct } from "@/shared/models/product";

import { normalizeForProductSearch } from "@/shared/lib/product-query";

/** Câte tokeni din titlul normalizat definesc „familia” (același model, arome diferite). */
const FAMILY_KEY_MAX_TOKENS = 4;

function isLikelySizeOrPackToken(w: string): boolean {
  if (!w) return false;
  if (/^\d+$/.test(w)) return true;
  if (/^x?\d+$/i.test(w)) return true;
  if (/^\d+[,.]?\d*x\d+$/i.test(w)) return true;
  if (/\d/.test(w) && /(kg|g|ml|l|gb|tb|inch|mp|hz|ron)$/i.test(w)) return true;
  return false;
}

function stripTrailingSizeTokens(tokens: string[]): string[] {
  const out = [...tokens];
  while (out.length > 1 && isLikelySizeOrPackToken(out[out.length - 1]!)) {
    out.pop();
  }
  return out;
}

/**
 * Cheie stabilă pentru gruparea titlurilor foarte similare (ex. aceeași linie, aromă diferită).
 */
export function productFamilyDedupeKey(title: string): string {
  const n = normalizeForProductSearch(title);
  if (!n) return "";
  let tokens = n.split(/\s+/).filter(Boolean);
  tokens = stripTrailingSizeTokens(tokens);
  const key = tokens.slice(0, FAMILY_KEY_MAX_TOKENS).join(" ");
  if (key.length > 0) return key;
  return n.slice(0, 48);
}

/**
 * Păstrează primul produs per cheie de familie, în ordinea dată.
 * @param maxResults — dacă > 0, se oprește după atâtea intrări unice; dacă 0, deduplică întreaga listă.
 */
export function dedupeParsedProductsBySimilarTitle(
  products: ParsedProduct[],
  maxResults: number
): ParsedProduct[] {
  const seen = new Set<string>();
  const out: ParsedProduct[] = [];
  for (const p of products) {
    const k = productFamilyDedupeKey(p.title);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (maxResults > 0 && out.length >= maxResults) break;
  }
  return out;
}

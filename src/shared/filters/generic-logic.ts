import type { ParsedProduct } from "@/shared/models/product";

/**
 * Normalizare pentru potrivire text (căutare, filtre): lower + NFD fără semne diacritice.
 */
export function normalizeSearchText(input: string): string {
  return (input ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/**
 * Extrage un număr din string-uri de preț tip „12,34 RON”, „12.34”, etc.
 */
export function parsePriceStringToNumber(price: string): number | null {
  const t = (price ?? "").replace(/[^\d,.-]/g, "").replace(",", ".");
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

/** Filtru generic: momentan păstrează toate produsele (extensibil: preț minim, stoc, etc.). */
export function genericProductPassesFilter(_p: ParsedProduct): boolean {
  return true;
}

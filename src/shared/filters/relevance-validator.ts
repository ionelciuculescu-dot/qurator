import type { ParsedProduct } from "@/shared/models/product";

/** Prag implicit: sub această distanță cosinus (`<=>`), petshop acceptă produsul fără potrivire strictă pe cuvinte. */
export const PG_VECTOR_GOOD_MATCH_MAX_DISTANCE = 0.6;

function vectorGoodMatchMaxDistance(): number {
  const raw = process.env.PG_VECTOR_GOOD_MATCH_MAX_DISTANCE?.trim();
  const n = raw ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : PG_VECTOR_GOOD_MATCH_MAX_DISTANCE;
}

/** Nișă petshop + distanță vectorială sub prag (semnal de încredere din PG). Folosit la `buildChatProductContext`. */
export function isPetshopStrongVectorMatch(product: ParsedProduct): boolean {
  const d = product.vectorDistance;
  const pet = (product.nicheType ?? "").trim().toLowerCase() === "petshop";
  if (!pet || typeof d !== "number" || !Number.isFinite(d) || d < 0) return false;
  return d < vectorGoodMatchMaxDistance();
}

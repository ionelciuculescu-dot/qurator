/**
 * Detectează atuuri de livrare în text (descriere, shipping) pentru scoring / LLM.
 * Folosește formă ASCII după eliminarea diacriticelor pentru potrivire robustă.
 */
function foldForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

const FREE_SHIP_RE =
  /transport\s+gratuit|transport\s+gratis|fara\s+transport|livrare\s+gratuit|livrare\s+0|transport\s+0|free\s+shipping/i;
const FAST_SHIP_RE =
  /livrare\s+rapida|livrare\s+in\s+24|livrare\s+24|in\s+24\s+de\s+ore|24\s+de\s+ore|same\s*day|curier\s+rapid|livrare\s+express|livrare\s+urgenta/i;

/**
 * Rezumat scurt pentru `ParsedProduct.deliveryPerks` / câmp `livrare` la LLM.
 */
export function extractDeliveryPerks(...textParts: string[]): string | undefined {
  const hay = foldForMatch(textParts.filter((p) => (p ?? "").trim().length > 0).join("\n"));
  if (!hay) return undefined;
  const bits: string[] = [];
  if (FREE_SHIP_RE.test(hay)) bits.push("transport gratuit");
  if (FAST_SHIP_RE.test(hay)) bits.push("livrare rapidă");
  if (bits.length === 0) return undefined;
  return bits.join(", ");
}

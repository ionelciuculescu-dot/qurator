import {
  CHAT_PRODUCT_DESCRIPTION_MAX,
  STORE_FEED_AI_LIMIT,
} from "@/shared/constants/limits";
import { dedupeParsedProductsBySimilarTitle } from "@/shared/lib/catalog-product-dedupe";
import {
  compareProductsForChatContext,
  inferPetFoodTextureIntent,
  productMatchesKeywordQuery,
  titleConflictsWithDryIntent,
  titleConflictsWithWetIntent,
} from "@/shared/lib/product-query";
import { isPetshopStrongVectorMatch } from "@/shared/filters/relevance-validator";
import type { ParsedProduct } from "@/shared/models/product";

/** Dacă filtrele stricte golesc lista dar vectorul a adus candidați, păstrăm catalogul pentru carduri / LLM. */
const KEYWORD_FILTER_FALLBACK_MIN_CATALOG = 2;

function truncateEndEllipsis(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/** Pregătește obiectul pentru LLM: descriere plafonată (titlul rămâne integral). */
function withDescriptionTrimmedForLlm(product: ParsedProduct): ParsedProduct {
  const d = product.description ?? "";
  const trimmed = truncateEndEllipsis(d, CHAT_PRODUCT_DESCRIPTION_MAX);
  if (trimmed === d) return product;
  return { ...product, description: trimmed };
}

/**
 * Subset din catalog pentru API feed / filtre locale: keyword, intent uscat/umed, dedupe.
 * Nu citește fișiere — primește lista deja încărcată prin `CatalogReader`.
 *
 * Hrană uscată vs umedă: dacă interogarea indică un singur tip, exclude produsele cu titlu
 * contradictoriu (ex. conserve la cerere „uscată”), apoi sortează după potrivire în titlu.
 * Deduplicare pe titlu similar (arome) + descriere tăiată la `CHAT_PRODUCT_DESCRIPTION_MAX` înainte de LLM.
 */
export function buildChatProductContext(
  catalog: ParsedProduct[],
  query: string | undefined,
  limit: number = STORE_FEED_AI_LIMIT
): ParsedProduct[] {
  const q = query?.trim();
  let filtered =
    q && q.length > 0
      ? catalog.filter((p) => productMatchesKeywordQuery(p, q) || isPetshopStrongVectorMatch(p))
      : [...catalog];
  if (
    q &&
    q.length > 0 &&
    filtered.length === 0 &&
    catalog.length >= KEYWORD_FILTER_FALLBACK_MIN_CATALOG
  ) {
    filtered = [...catalog];
  }

  const intent = q && q.length > 0 ? inferPetFoodTextureIntent(q) : null;
  if (intent === "dry") {
    filtered = filtered.filter((p) => !titleConflictsWithDryIntent(p.title));
  } else if (intent === "wet") {
    filtered = filtered.filter((p) => !titleConflictsWithWetIntent(p.title));
  }

  if (filtered.length === 0 && catalog.length >= KEYWORD_FILTER_FALLBACK_MIN_CATALOG) {
    filtered = [...catalog];
  }

  if (q && q.length > 0) {
    filtered.sort((a, b) => compareProductsForChatContext(a, b, q, intent));
  }

  filtered = dedupeParsedProductsBySimilarTitle(filtered, 0);
  filtered = filtered.map(withDescriptionTrimmedForLlm);

  const n = Math.max(0, limit);
  return filtered.slice(0, n);
}

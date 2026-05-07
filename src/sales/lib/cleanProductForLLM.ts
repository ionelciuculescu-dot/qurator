import type { ParsedProduct } from "@/shared/models/product";

const MAX_DESCRIPTION = 100;
const MAX_CATEGORIE = 80;

export type CleanedProductForLLM = {
  titlu: string;
  pret: string;
  link: string;
  categorie: string;
  /** Atuuri livrare din catalog — folosește la recomandare doar dacă e prezent. */
  livrare?: string;
};

function truncateEnd(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Pregătește un `ParsedProduct` pentru context LLM: titlu, preț, link, categorie scurtă,
 * opțional \`livrare\` din \`deliveryPerks\`; descrierea e trunchiată intern (nu apare în obiectul final).
 */
export function cleanParsedProductForLLM(product: ParsedProduct): CleanedProductForLLM {
  const desc100 = truncateEnd(product.description ?? "", MAX_DESCRIPTION);
  const explicit =
    typeof product.category === "string" && product.category.trim().length > 0
      ? product.category.trim()
      : "";
  const categorie = explicit
    ? truncateEnd(explicit, MAX_CATEGORIE)
    : truncateEnd(desc100, MAX_CATEGORIE);

  const livrareRaw = (product.deliveryPerks ?? "").trim();
  const livrare = livrareRaw ? truncateEnd(livrareRaw, 120) : undefined;

  return {
    titlu: (product.title ?? "").trim(),
    pret: (product.price ?? "").trim(),
    link: (product.affiliateLink ?? "").trim(),
    categorie,
    ...(livrare ? { livrare } : {}),
  };
}

/** JSON minificat (fără spații / rânduri) pentru lista trimisă la DeepSeek / GPT. */
export function stringifyCleanedProductsForLLM(products: ParsedProduct[]): string {
  return JSON.stringify(products.map(cleanParsedProductForLLM));
}

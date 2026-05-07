import type { ParsedProduct } from "@/shared/models/product";

import { genericProductPassesFilter } from "./generic-logic";
import { petshopProductVisibleForUserMessage } from "./petshop-logic";

export type CatalogNicheId = string;

export type NicheFilterContext = {
  /** Mesaj utilizator (chat) — folosit la filtre specie pentru nișa petshop. */
  userMessage?: string;
};

function resolveNicheKey(product: ParsedProduct): CatalogNicheId {
  const raw = (product.nicheType ?? "").trim().toLowerCase();
  return raw || "generic";
}

/**
 * Aplică filtrele specifice nișei înainte de returnarea listei către chat / UI.
 * Factory: în funcție de `niche_type` al fiecărui produs, delegă la modulul potrivit.
 */
export function applyNicheFiltersToParsedProducts(
  products: ParsedProduct[],
  context: NicheFilterContext
): ParsedProduct[] {
  const msg = context.userMessage ?? "";
  return products.filter((p) => {
    const niche = resolveNicheKey(p);
    switch (niche) {
      case "petshop":
        return petshopProductVisibleForUserMessage(p, msg);
      default:
        return genericProductPassesFilter(p);
    }
  });
}

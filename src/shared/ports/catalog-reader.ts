import type { ParsedProduct } from "@/shared/models/product";

/** Opțiuni opționale la citirea catalogului (ex. filtre dependente de mesajul utilizatorului). */
export type CatalogListOptions = {
  refineForUserMessage?: string;
  /**
   * Restrânge la rânduri al căror `category` conține acest fragment (case-insensitive).
   * Folosit la follow-up „mai ai și altele” păstrând linia de produs (ex. hrană).
   */
  restrictToCategoryContains?: string;
  /**
   * Ancoră SQL + filtru JS petshop pe specie: `name` / `description` trebuie să conțină acul (ex. `caine`, `pisic`).
   * **Lipsă** → nu se aplică `filterPetshopProductsBySpeciesIntent` pe candidați petshop.
   */
  speciesSqlAnchor?: "caine" | "pisica";
};

/**
 * Port citire catalog pentru modulul `sales`.
 * Implementări: ex. `JsonCatalogReader` (ingestion), `SqliteCatalogReader` (sales/adapters) — legate la rute.
 */
export type CatalogReader = {
  listProducts(options?: CatalogListOptions): Promise<ParsedProduct[]>;
  /**
   * Opțional: subset de candidați pentru interogare (ex. SQLite cu OR pe tokeni),
   * înainte de `buildChatProductContext` / `productMatchesKeywordQuery`.
   */
  listProductsMatchingQuery?(query: string, options?: CatalogListOptions): Promise<ParsedProduct[]>;
};

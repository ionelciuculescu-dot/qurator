import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { applyCatalogDbPragmas, initCatalogDatabase } from "@/shared/db/catalog-schema-ddl";
import { catalogSqliteFilePath } from "@/shared/db/catalog-sqlite-path";
import { filterPetshopProductsBySpeciesIntent } from "@/shared/filters/petshop-logic";
import { LIST_PRODUCTS_MAX, LIST_PRODUCTS_PREFETCH_ROWS } from "@/shared/constants/limits";
import { dedupeParsedProductsBySimilarTitle } from "@/shared/lib/catalog-product-dedupe";
import { extractDeliveryPerks } from "@/shared/lib/delivery-hints";
import { speciesDbLikeNeedles } from "@/shared/lib/catalog-species-db-needles";
import { tokenizeCatalogQuery } from "@/shared/lib/product-query";
import type { ParsedProduct } from "@/shared/models/product";
import type { CatalogListOptions, CatalogReader } from "@/shared/ports/catalog-reader";
import { CATALOG_PRODUCT_COLUMNS, CATALOG_PRODUCTS_TABLE } from "@/shared/sql/catalog-queries";

export type CatalogProductRow = {
  id: number;
  provider_id: string;
  feed_id: number | null;
  name: string;
  brand: string;
  price: string;
  category: string;
  niche_type: string;
  image_url: string;
  affiliate_url: string;
  description: string;
  shipping_info: string;
};

type CatalogProductRowScored = CatalogProductRow & { relevance_score: number };

function stripRelevanceScore(row: CatalogProductRowScored): CatalogProductRow {
  const { relevance_score: _rs, ...rest } = row;
  return rest;
}

export function rowToParsedProduct(row: CatalogProductRow): ParsedProduct {
  const name = (row.name ?? "").trim();
  const brand = (row.brand ?? "").trim();
  const title =
    name && brand && !name.toLowerCase().includes(brand.toLowerCase())
      ? `${name} — ${brand}`
      : name || brand || `Produs #${row.id}`;

  const category = (row.category ?? "").trim();
  const niche = (row.niche_type ?? "").trim();
  const categoryOut =
    category && niche ? `${category} (${niche})` : category || niche || undefined;

  const desc = (row.description ?? "").trim();
  const ship = (row.shipping_info ?? "").trim();
  const deliveryPerks = extractDeliveryPerks(desc, ship);

  return {
    title,
    price: (row.price ?? "").trim(),
    affiliateLink: (row.affiliate_url ?? "").trim(),
    image: (row.image_url ?? "").trim(),
    description: desc,
    ...(categoryOut ? { category: categoryOut } : {}),
    ...(deliveryPerks ? { deliveryPerks } : {}),
    ...(niche ? { nicheType: niche } : {}),
  };
}

/**
 * După maparea din SQL: pentru `niche_type === petshop` poate aplica filtrarea câine/pisică
 * pe baza mesajului (`refineForUserMessage`) **doar** când `CatalogListOptions.speciesSqlAnchor` e setat.
 */
export function applySqliteNicheSpeciesFilters(
  products: ParsedProduct[],
  options?: CatalogListOptions
): ParsedProduct[] {
  if (!options?.speciesSqlAnchor) {
    return products;
  }
  const userMessage = options?.refineForUserMessage ?? "";
  const nicheKey = (p: ParsedProduct) => (p.nicheType ?? "").trim().toLowerCase();

  const petshop = products.filter((p) => nicheKey(p) === "petshop");
  const keptPetshop = filterPetshopProductsBySpeciesIntent(petshop, userMessage);
  const kept = new Set(keptPetshop);

  return products.filter((p) => (nicheKey(p) === "petshop" ? kept.has(p) : true));
}

/**
 * Citire catalog din SQLite local; implementează `CatalogReader`.
 * SQL-ul folosit vine din `@/shared/sql/catalog-queries` (portabil spre PostgreSQL).
 */
export class SqliteCatalogReader implements CatalogReader {
  private readonly db: Database.Database;

  constructor(dbFilePath?: string) {
    const filePath = dbFilePath ?? catalogSqliteFilePath();
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    applyCatalogDbPragmas(this.db);
    this.ensureProductsTable();
  }

  private ensureProductsTable(): void {
    initCatalogDatabase(this.db);
  }

  async listProducts(options?: CatalogListOptions): Promise<ParsedProduct[]> {
    const cols = CATALOG_PRODUCT_COLUMNS.join(", ");
    const restrict = options?.restrictToCategoryContains?.trim();
    const anchor = options?.speciesSqlAnchor;

    const wheres: string[] = [];
    const args: string[] = [];
    if (restrict) {
      wheres.push(`instr(lower(ifnull(category,'')), lower(?)) > 0`);
      args.push(restrict);
    }
    if (anchor === "caine" || anchor === "pisica") {
      const needles = speciesDbLikeNeedles(anchor);
      const ors = needles.map(
        () =>
          `(lower(ifnull(name,'')) LIKE '%' || ? || '%' OR lower(ifnull(description,'')) LIKE '%' || ? || '%')`
      );
      wheres.push(`(${ors.join(" OR ")})`);
      for (const nd of needles) args.push(nd, nd);
    }
    let sql = `SELECT ${cols} FROM ${CATALOG_PRODUCTS_TABLE}`;
    if (wheres.length > 0) sql += ` WHERE ${wheres.join(" AND ")}`;
    sql += ` ORDER BY id ASC LIMIT ${LIST_PRODUCTS_PREFETCH_ROWS}`;
    const stmt = this.db.prepare(sql);
    const rows = (args.length > 0 ? stmt.all(...args) : stmt.all()) as CatalogProductRow[];
    const parsed = rows.map(rowToParsedProduct);
    const deduped = dedupeParsedProductsBySimilarTitle(parsed, LIST_PRODUCTS_MAX);
    return applySqliteNicheSpeciesFilters(deduped, options);
  }

  /**
   * Candidați: fiecare token trebuie să apară (instr) în `name` sau `description`
   * (OR între tokeni pentru a nu exclude rânduri cu un singur cuvânt cheie).
   * Apoi `productMatchesKeywordQuery` rafinează în JS (majoritate / fuzzy).
   */
  async listProductsMatchingQuery(query: string, options?: CatalogListOptions): Promise<ParsedProduct[]> {
    const tokens = tokenizeCatalogQuery(query);
    if (tokens.length === 0) {
      return this.listProducts(options);
    }
    const maxTok = 14;
    const toks = tokens.slice(0, maxTok);
    const cols = CATALOG_PRODUCT_COLUMNS.join(", ");
    const hayExpr = `lower(replace(ifnull(name,'') || char(10) || ifnull(description,'') || char(10) || ifnull(shipping_info,''), '&', ' '))`;
    const parts = toks.map(() => `instr(${hayExpr}, lower(?)) > 0`);
    const restrict = options?.restrictToCategoryContains?.trim();
    const categoryClause = restrict
      ? ` AND instr(lower(ifnull(category,'')), lower(?)) > 0`
      : "";
    const anchor = options?.speciesSqlAnchor;
    const speciesNeedles =
      anchor === "caine" || anchor === "pisica" ? [...speciesDbLikeNeedles(anchor)] : [];
    const speciesClause =
      speciesNeedles.length > 0
        ? ` AND (${speciesNeedles
            .map(
              () =>
                `(lower(ifnull(name,'')) LIKE '%' || ? || '%' OR lower(ifnull(description,'')) LIKE '%' || ? || '%')`
            )
            .join(" OR ")})`
        : "";
    const whereSql = `(${parts.join(" OR ")})${categoryClause}${speciesClause}`;

    const shipHay = `lower(ifnull(name,'')||char(10)||ifnull(description,'')||char(10)||ifnull(shipping_info,''))`;
    const brandScore = `(CASE WHEN length(trim(ifnull(brand,''))) > 0 AND (
      instr(lower(ifnull(name,'')||char(10)||ifnull(description,'')||char(10)||ifnull(shipping_info,'')), lower(trim(ifnull(brand,'')))) > 0
      OR instr(lower(trim(ifnull(brand,''))), lower(?)) > 0
      OR instr(lower(?), lower(trim(ifnull(brand,'')))) > 0
    ) THEN 35 ELSE 0 END)`;
    const deliveryScore = `(CASE WHEN
      ${shipHay} LIKE '%transport gratuit%' OR ${shipHay} LIKE '%transport gratis%' OR ${shipHay} LIKE '%fara transport%' OR ${shipHay} LIKE '%fără transport%'
      OR ${shipHay} LIKE '%livrare gratuit%' OR ${shipHay} LIKE '%livrare gratuita%' OR ${shipHay} LIKE '%livrare 0%' OR ${shipHay} LIKE '%transport 0%'
      OR ${shipHay} LIKE '%livrare rapida%' OR ${shipHay} LIKE '%livrare rapid%' OR ${shipHay} LIKE '%livrare in 24%' OR ${shipHay} LIKE '%livrare 24%'
      OR ${shipHay} LIKE '%24 de ore%' OR ${shipHay} LIKE '%same day%' OR ${shipHay} LIKE '%curier rapid%' OR ${shipHay} LIKE '%livrare express%' OR ${shipHay} LIKE '%free shipping%'
    THEN 18 ELSE 0 END)`;
    const relevanceExpr = `(${brandScore} + ${deliveryScore})`;

    const normQuery = query.trim().toLowerCase();
    const sql = `
SELECT ${cols}, ${relevanceExpr} AS relevance_score
FROM ${CATALOG_PRODUCTS_TABLE}
WHERE ${whereSql}
ORDER BY relevance_score DESC, random()
LIMIT 8000
`.trim();
    const stmt = this.db.prepare(sql);
    const bindArgs: string[] = [normQuery, normQuery, ...toks];
    if (restrict) bindArgs.push(restrict);
    for (const nd of speciesNeedles) bindArgs.push(nd, nd);
    const rows = stmt.all(...bindArgs) as CatalogProductRowScored[];
    const mapped = rows.map((r) => rowToParsedProduct(stripRelevanceScore(r)));
    return applySqliteNicheSpeciesFilters(mapped, options);
  }

  /** Închide conexiunea (util în teste sau scripturi scurte). */
  close(): void {
    try {
      this.db.close();
    } catch {
      /* */
    }
  }
}

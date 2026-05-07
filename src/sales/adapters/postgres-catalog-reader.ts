import { Pool, type PoolConfig } from "pg";

import { LIST_PRODUCTS_MAX, LIST_PRODUCTS_PREFETCH_ROWS } from "@/shared/constants/limits";
import { dedupeParsedProductsBySimilarTitle } from "@/shared/lib/catalog-product-dedupe";
import { speciesDbLikeNeedles } from "@/shared/lib/catalog-species-db-needles";
import { tokenizeCatalogQuery } from "@/shared/lib/product-query";
import type { ParsedProduct } from "@/shared/models/product";
import type { CatalogListOptions, CatalogReader } from "@/shared/ports/catalog-reader";
import { CATALOG_PRODUCT_COLUMNS, CATALOG_PRODUCTS_TABLE } from "@/shared/sql/catalog-queries";

import {
  applySqliteNicheSpeciesFilters,
  rowToParsedProduct,
  type CatalogProductRow,
} from "./catalog-reader-sqlite";

const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIM = 1536;
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

/** Top-K după `<=>` (fără prag de distanță — doar ordonare). Mai mare = mai puțin restrictiv. */
function vectorMatchLimit(): number {
  const raw = process.env.PG_VECTOR_MATCH_LIMIT?.trim();
  const n = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(n)) return Math.min(100, Math.max(5, n));
  return 24;
}

/** Nișe permise la căutare vectorială (siguranță). Suprascrie cu `PG_VECTOR_ALLOWED_NICHES=petshop,tech`. */
const DEFAULT_ALLOWED_NICHES = ["petshop", "tech", "generic", "it", "auto"];

function buildPgPoolConfig(): PoolConfig {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    return { connectionString: url, max: 8 };
  }
  return {
    host: process.env.PGHOST ?? "localhost",
    port: parseInt(process.env.PGPORT ?? "5432", 10),
    user: process.env.PGUSER ?? "postgres",
    password: process.env.PGPASSWORD ?? "password123",
    database: process.env.PGDATABASE ?? "postgres",
    max: 8,
  };
}

function allowedNichesForVectorSearch(): string[] {
  const raw = process.env.PG_VECTOR_ALLOWED_NICHES?.trim();
  const list = !raw
    ? [...DEFAULT_ALLOWED_NICHES]
    : raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.map((s) => s.toLowerCase());
}

/** Intrare pentru `hybridAgentSearch` — aliniată la tool-ul `search_stock` (agentic). */
export type HybridAgentSearchInput = {
  semanticQuery: string;
  categoryContains?: string;
  priceMin?: number;
  priceMax?: number;
  limit?: number;
};

/**
 * Parsare conservatoare a câmpului text `price` în SQL (PG) — același spirit ca `scripts/agentic_chat/db_manager.py`.
 */
const PARSED_PRICE_SQL = `NULLIF(regexp_replace(regexp_replace(replace(replace(trim(COALESCE(price, '')), ',', '.'), ' ', ''), '[^0-9.]', '', 'g'), '^\\.+', '', 'g'), '')::double precision`;

function pgRowToCatalogProductRow(row: Record<string, unknown>): CatalogProductRow {
  const fid = row.feed_id;
  return {
    id: Number(row.id),
    provider_id: String(row.provider_id ?? ""),
    feed_id: fid === null || fid === undefined ? null : Number(fid),
    name: String(row.name ?? ""),
    brand: String(row.brand ?? ""),
    price: String(row.price ?? ""),
    category: String(row.category ?? ""),
    niche_type: String(row.niche_type ?? ""),
    image_url: String(row.image_url ?? ""),
    affiliate_url: String(row.affiliate_url ?? ""),
    description: String(row.description ?? ""),
    shipping_info: String(row.shipping_info ?? ""),
  };
}

/**
 * Citire catalog din PostgreSQL (ex. Docker `petshop-db`); implementează `CatalogReader`.
 * Conexiune: `DATABASE_URL` sau `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE`.
 * Căutare cu query: cosine distance (`<=>`) între `embedding` și vectorul întrebării (`generateEmbedding`),
 * fără prag maxim pe distanță — doar top-K (`PG_VECTOR_MATCH_LIMIT`, implicit 24).
 * Filtru `niche_type`: comparare case-insensitive cu lista din `PG_VECTOR_ALLOWED_NICHES`.
 */
export class PostgresCatalogReader implements CatalogReader {
  private readonly pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? new Pool(buildPgPoolConfig());
  }

  /** OpenAI: text → vector (text-embedding-3-small, 1536 dim). */
  private async generateEmbedding(text: string): Promise<number[]> {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) {
      throw new Error("OPENAI_API_KEY lipsă");
    }
    const input = text.trim().slice(0, 8000);
    const res = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: EMBED_MODEL, input }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`OpenAI embeddings HTTP ${res.status}: ${t.slice(0, 400)}`);
    }
    const data = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const emb = data.data?.[0]?.embedding;
    if (!Array.isArray(emb) || emb.length !== EMBED_DIM) {
      throw new Error("Răspuns OpenAI embeddings invalid");
    }
    return emb;
  }

  private vectorLiteral(vec: number[]): string {
    if (vec.length !== EMBED_DIM) {
      throw new Error(`Embedding dimensiune ${vec.length}, așteptat ${EMBED_DIM}`);
    }
    const parts = vec.map((x) => (Number.isFinite(x) ? x : 0));
    return `[${parts.join(",")}]`;
  }

  /** Elimină coloane extra din SELECT și mapează la `ParsedProduct` (contractul aplicației). */
  private mapQueryRowToParsedProduct(row: Record<string, unknown>): ParsedProduct {
    const { vector_distance: vd, relevance_score: _rs, ...rest } = row;
    const base = rowToParsedProduct(pgRowToCatalogProductRow(rest));
    const n = typeof vd === "number" ? vd : typeof vd === "string" ? Number.parseFloat(vd) : NaN;
    if (!Number.isFinite(n)) return base;
    return { ...base, vectorDistance: n };
  }

  async listProducts(options?: CatalogListOptions): Promise<ParsedProduct[]> {
    const cols = CATALOG_PRODUCT_COLUMNS.join(", ");
    const restrict = options?.restrictToCategoryContains?.trim();
    const anchor = options?.speciesSqlAnchor;

    const wheres: string[] = [];
    const params: unknown[] = [];
    if (restrict) {
      params.push(`%${restrict.toLowerCase()}%`);
      wheres.push(`LOWER(COALESCE(category, '')) LIKE $${params.length}`);
    }
    if (anchor === "caine" || anchor === "pisica") {
      const needles = speciesDbLikeNeedles(anchor);
      const ors: string[] = [];
      for (const needle of needles) {
        params.push(`%${needle}%`);
        const i = params.length;
        ors.push(
          `(LOWER(COALESCE(name, '')) LIKE $${i} OR LOWER(COALESCE(description, '')) LIKE $${i})`
        );
      }
      wheres.push(`(${ors.join(" OR ")})`);
    }
    let sql = `SELECT ${cols} FROM ${CATALOG_PRODUCTS_TABLE}`;
    if (wheres.length > 0) sql += ` WHERE ${wheres.join(" AND ")}`;
    sql += ` ORDER BY id ASC LIMIT ${LIST_PRODUCTS_PREFETCH_ROWS}`;

    const res = await this.pool.query(sql, params);
    const rows = res.rows.map((r) => pgRowToCatalogProductRow(r as Record<string, unknown>));
    const parsed = rows.map(rowToParsedProduct);
    const deduped = dedupeParsedProductsBySimilarTitle(parsed, LIST_PRODUCTS_MAX);
    return applySqliteNicheSpeciesFilters(deduped, options);
  }

  /**
   * Căutare principală: **ORDER BY embedding <=> $1::vector** (cosine distance), fără `WHERE name ILIKE`.
   * Top-K configurabil (`PG_VECTOR_MATCH_LIMIT`); fără `OPENAI_API_KEY` sau la eroare: fallback STRPOS (tokeni).
   */
  async listProductsMatchingQuery(query: string, options?: CatalogListOptions): Promise<ParsedProduct[]> {
    const q = query.trim();
    if (!q) {
      return this.listProducts(options);
    }

    const useVector = Boolean(process.env.OPENAI_API_KEY?.trim());
    if (!useVector) {
      return this.listProductsMatchingQueryStrposFallback(query, options);
    }

    let embedding: number[];
    try {
      embedding = await this.generateEmbedding(q);
    } catch {
      return this.listProductsMatchingQueryStrposFallback(query, options);
    }

    const vecLiteral = this.vectorLiteral(embedding);
    const niches = allowedNichesForVectorSearch();
    const cols = CATALOG_PRODUCT_COLUMNS.join(", ");

    const restrict = options?.restrictToCategoryContains?.trim();
    const anchor = options?.speciesSqlAnchor;

    const params: unknown[] = [vecLiteral, niches];
    const wheres: string[] = [
      "embedding IS NOT NULL",
      "LOWER(TRIM(COALESCE(niche_type, ''))) = ANY($2::text[])",
    ];
    let n = 2;

    if (restrict) {
      n += 1;
      params.push(`%${restrict.toLowerCase()}%`);
      wheres.push(`LOWER(COALESCE(category, '')) LIKE $${n}`);
    }
    if (anchor === "caine" || anchor === "pisica") {
      const needles = speciesDbLikeNeedles(anchor);
      const ors: string[] = [];
      for (const needle of needles) {
        n += 1;
        params.push(`%${needle}%`);
        ors.push(
          `(LOWER(COALESCE(name, '')) LIKE $${n} OR LOWER(COALESCE(description, '')) LIKE $${n})`
        );
      }
      wheres.push(`(${ors.join(" OR ")})`);
    }

    const k = vectorMatchLimit();
    const sql = `
SELECT ${cols}, (embedding <=> $1::vector) AS vector_distance
FROM ${CATALOG_PRODUCTS_TABLE}
WHERE ${wheres.join(" AND ")}
ORDER BY embedding <=> $1::vector ASC NULLS LAST
LIMIT ${k}
`.trim();

    const res = await this.pool.query(sql, params);
    const rawRowCount = res.rows.length;
    const sample = res.rows.slice(0, 3).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: r.id,
        niche_type: r.niche_type,
        vector_distance: r.vector_distance,
      };
    });
    console.log(
      "[PostgresCatalogReader] vector query",
      JSON.stringify({
        rowCount: rawRowCount,
        limit: k,
        allowedNichesLower: niches,
        categoryRestrict: restrict ?? null,
        speciesAnchor: anchor ?? null,
        speciesNeedleCount: anchor === "caine" || anchor === "pisica" ? speciesDbLikeNeedles(anchor).length : 0,
        queryPreview: q.slice(0, 120),
        sample,
      })
    );

    const mapped = res.rows.map((r) => this.mapQueryRowToParsedProduct(r as Record<string, unknown>));
    const deduped = dedupeParsedProductsBySimilarTitle(mapped, 0);
    const afterFilters = applySqliteNicheSpeciesFilters(deduped, options);
    if (afterFilters.length !== deduped.length) {
      console.log(
        "[PostgresCatalogReader] after dedupe + species intent filter",
        JSON.stringify({ vectorRowCount: rawRowCount, in: deduped.length, out: afterFilters.length })
      );
    }
    return afterFilters;
  }

  /** Căutare legacy (tokeni + scor), dacă lipsesc chei OpenAI sau API-ul eșuează. */
  private async listProductsMatchingQueryStrposFallback(
    query: string,
    options?: CatalogListOptions
  ): Promise<ParsedProduct[]> {
    const tokens = tokenizeCatalogQuery(query);
    if (tokens.length === 0) {
      return this.listProducts(options);
    }
    const maxTok = 14;
    const toks = tokens.slice(0, maxTok);
    const cols = CATALOG_PRODUCT_COLUMNS.join(", ");
    const hayExpr = `LOWER(REPLACE(COALESCE(name, '') || E'\\n' || COALESCE(description, '') || E'\\n' || COALESCE(shipping_info, ''), '&', ' '))`;
    const shipHay = `LOWER(COALESCE(name, '') || E'\\n' || COALESCE(description, '') || E'\\n' || COALESCE(shipping_info, ''))`;

    const restrict = options?.restrictToCategoryContains?.trim();
    const anchor = options?.speciesSqlAnchor;
    const normQuery = query.trim().toLowerCase();

    let n = 0;
    const next = (): string => {
      n += 1;
      return `$${n}`;
    };

    const pBrandA = next();
    const pBrandB = next();
    const brandScore = `(CASE WHEN LENGTH(TRIM(COALESCE(brand, ''))) > 0 AND (
      STRPOS(${hayExpr}, LOWER(TRIM(COALESCE(brand, '')))) > 0
      OR STRPOS(LOWER(TRIM(COALESCE(brand, ''))), LOWER(${pBrandA}::text)) > 0
      OR STRPOS(LOWER(${pBrandB}::text), LOWER(TRIM(COALESCE(brand, '')))) > 0
    ) THEN 35 ELSE 0 END)`;

    const deliveryScore = `(CASE WHEN
      ${shipHay} LIKE '%transport gratuit%' OR ${shipHay} LIKE '%transport gratis%' OR ${shipHay} LIKE '%fara transport%' OR ${shipHay} LIKE '%fără transport%'
      OR ${shipHay} LIKE '%livrare gratuit%' OR ${shipHay} LIKE '%livrare gratuita%' OR ${shipHay} LIKE '%livrare 0%' OR ${shipHay} LIKE '%transport 0%'
      OR ${shipHay} LIKE '%livrare rapida%' OR ${shipHay} LIKE '%livrare rapid%' OR ${shipHay} LIKE '%livrare in 24%' OR ${shipHay} LIKE '%livrare 24%'
      OR ${shipHay} LIKE '%24 de ore%' OR ${shipHay} LIKE '%same day%' OR ${shipHay} LIKE '%curier rapid%' OR ${shipHay} LIKE '%livrare express%' OR ${shipHay} LIKE '%free shipping%'
    THEN 18 ELSE 0 END)`;

    const relevanceExpr = `(${brandScore} + ${deliveryScore})`;

    const tokenPlaceholders = toks.map(() => {
      const p = next();
      return `STRPOS(${hayExpr}, LOWER(${p}::text)) > 0`;
    });
    const whereTokenSql = `(${tokenPlaceholders.join(" OR ")})`;

    let categorySql = "";
    if (restrict) {
      const pc = next();
      categorySql = ` AND STRPOS(LOWER(COALESCE(category, '')), LOWER(${pc}::text)) > 0`;
    }

    let speciesSql = "";
    const speciesNeedles =
      anchor === "caine" || anchor === "pisica" ? [...speciesDbLikeNeedles(anchor)] : [];
    if (speciesNeedles.length > 0) {
      const parts = speciesNeedles.map(() => {
        const ps = next();
        return `(
        STRPOS(LOWER(COALESCE(name, '')), LOWER(${ps}::text)) > 0
        OR STRPOS(LOWER(COALESCE(description, '')), LOWER(${ps}::text)) > 0
      )`;
      });
      speciesSql = ` AND (${parts.join(" OR ")})`;
    }

    const whereSql = `${whereTokenSql}${categorySql}${speciesSql}`;

    const bindArgs: unknown[] = [normQuery, normQuery, ...toks];
    if (restrict) bindArgs.push(restrict);
    for (const nd of speciesNeedles) bindArgs.push(nd);

    const sql = `
SELECT ${cols}, ${relevanceExpr} AS relevance_score
FROM ${CATALOG_PRODUCTS_TABLE}
WHERE ${whereSql}
ORDER BY relevance_score DESC, RANDOM()
LIMIT 8000
`.trim();

    const res = await this.pool.query(sql, bindArgs);
    const mapped = res.rows.map((r) => this.mapQueryRowToParsedProduct(r as Record<string, unknown>));
    const deduped = dedupeParsedProductsBySimilarTitle(mapped, 0);
    return applySqliteNicheSpeciesFilters(deduped, options);
  }

  /**
   * Căutare hibridă pentru agenți (tool calling): vector + filtre SQL opționale categorie / preț.
   * Necesită `OPENAI_API_KEY`; fără ea revine la `listProductsMatchingQueryStrposFallback` (fără filtre preț în SQL).
   */
  async hybridAgentSearch(input: HybridAgentSearchInput): Promise<ParsedProduct[]> {
    const q = input.semanticQuery.trim();
    if (!q) {
      return [];
    }

    const categoryTrim = input.categoryContains?.trim();
    const limRaw = input.limit;
    const k =
      typeof limRaw === "number" && Number.isFinite(limRaw)
        ? Math.min(100, Math.max(1, Math.floor(limRaw)))
        : vectorMatchLimit();

    const opts: CatalogListOptions = {
      ...(categoryTrim ? { restrictToCategoryContains: categoryTrim } : {}),
    };

    const useVector = Boolean(process.env.OPENAI_API_KEY?.trim());
    if (!useVector) {
      const base = await this.listProductsMatchingQueryStrposFallback(q, opts);
      return this.applyPriceBoundsToParsedProducts(base, input.priceMin, input.priceMax);
    }

    let embedding: number[];
    try {
      embedding = await this.generateEmbedding(q);
    } catch {
      const base = await this.listProductsMatchingQueryStrposFallback(q, opts);
      return this.applyPriceBoundsToParsedProducts(base, input.priceMin, input.priceMax);
    }

    const vecLiteral = this.vectorLiteral(embedding);
    const niches = allowedNichesForVectorSearch();
    const cols = CATALOG_PRODUCT_COLUMNS.join(", ");

    const params: unknown[] = [vecLiteral, niches];
    const wheres: string[] = [
      "embedding IS NOT NULL",
      "LOWER(TRIM(COALESCE(niche_type, ''))) = ANY($2::text[])",
    ];
    let n = 2;

    if (categoryTrim) {
      n += 1;
      params.push(`%${categoryTrim.toLowerCase()}%`);
      wheres.push(`LOWER(COALESCE(category, '')) LIKE $${n}`);
    }
    if (input.priceMin !== undefined && Number.isFinite(input.priceMin)) {
      n += 1;
      params.push(input.priceMin);
      wheres.push(`(${PARSED_PRICE_SQL}) >= $${n}::double precision`);
    }
    if (input.priceMax !== undefined && Number.isFinite(input.priceMax)) {
      n += 1;
      params.push(input.priceMax);
      wheres.push(`(${PARSED_PRICE_SQL}) <= $${n}::double precision`);
    }

    const sql = `
SELECT ${cols}, (embedding <=> $1::vector) AS vector_distance
FROM ${CATALOG_PRODUCTS_TABLE}
WHERE ${wheres.join(" AND ")}
ORDER BY embedding <=> $1::vector ASC NULLS LAST
LIMIT ${k}
`.trim();

    const res = await this.pool.query(sql, params);
    const mapped = res.rows.map((r) => this.mapQueryRowToParsedProduct(r as Record<string, unknown>));
    const deduped = dedupeParsedProductsBySimilarTitle(mapped, 0);
    return applySqliteNicheSpeciesFilters(deduped, opts);
  }

  private applyPriceBoundsToParsedProducts(
    products: ParsedProduct[],
    priceMin?: number,
    priceMax?: number
  ): ParsedProduct[] {
    if (
      (priceMin === undefined || !Number.isFinite(priceMin)) &&
      (priceMax === undefined || !Number.isFinite(priceMax))
    ) {
      return products;
    }
    return products.filter((p) => {
      const v = this.parseProductPriceRough(p.price ?? "");
      if (v === null) return false;
      if (priceMin !== undefined && Number.isFinite(priceMin) && v < priceMin) return false;
      if (priceMax !== undefined && Number.isFinite(priceMax) && v > priceMax) return false;
      return true;
    });
  }

  private parseProductPriceRough(priceText: string): number | null {
    const m = priceText.replace(/\s/g, " ").match(/(\d+(?:[.,]\d+)?)/);
    if (!m) return null;
    const n = Number.parseFloat(m[1].replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

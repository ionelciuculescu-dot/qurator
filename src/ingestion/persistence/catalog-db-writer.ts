import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { applyCatalogDbPragmas, initCatalogDatabase } from "@/shared/db/catalog-schema-ddl";
import { catalogSqliteFilePath } from "@/shared/db/catalog-sqlite-path";
import type { EssentialProduct } from "@/shared/models/product";
import { CATALOG_PRODUCTS_TABLE } from "@/shared/sql/catalog-queries";

import {
  type CatalogNicheOverride,
  inferBrandFromTitle,
  inferCategoryHint,
  inferNicheTypeForCatalog,
} from "@/ingestion/catalog/niche-filters";

export type { CatalogNicheOverride };

/** ID stabil din URL afiliat (pentru `ON CONFLICT(id)` fără duplicate pe același link). */
export function stableProductIdFromAffiliateUrl(affiliateUrl: string): number {
  let h = 2166136261 >>> 0;
  const s = affiliateUrl.trim();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 0x7fffffff) + 1;
}

function essentialToRow(
  p: EssentialProduct,
  feedUrl: string | undefined,
  providerId: string,
  feedId: number | null,
  catalogNiche?: CatalogNicheOverride
): {
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
} {
  const niche =
    catalogNiche ?? inferNicheTypeForCatalog(p, feedUrl);
  const brand = inferBrandFromTitle(p.title);
  const category = inferCategoryHint(p.title, niche, feedUrl);
  return {
    id: stableProductIdFromAffiliateUrl(p.affiliateLink),
    provider_id: providerId,
    feed_id: feedId,
    name: p.title.trim(),
    brand,
    price: (p.price ?? "").trim(),
    category,
    niche_type: niche,
    image_url: (p.image ?? "").trim(),
    affiliate_url: p.affiliateLink.trim(),
    description: (p.description ?? "").trim(),
    shipping_info: (p.shippingNote ?? "").trim(),
  };
}

/** Rând complet pentru seed / import manual (id explicit). */
export type CatalogManualRow = {
  id: number;
  /** Implicit `seed` dacă lipsește. */
  provider_id?: string;
  /** Opțional — legătură la `feed_configs.id`. */
  feed_id?: number | null;
  name: string;
  brand: string;
  price: string;
  category: string;
  niche_type: string;
  image_url: string;
  affiliate_url: string;
  description: string;
  /** Opțional — implicit gol. */
  shipping_info?: string;
};

function buildUpsertSql(): string {
  const cols =
    "id, provider_id, feed_id, name, brand, price, category, niche_type, image_url, affiliate_url, description, shipping_info";
  const placeholders = cols.split(", ").map(() => "?").join(", ");
  const updates = [
    "provider_id = excluded.provider_id",
    "feed_id = COALESCE(excluded.feed_id, products.feed_id)",
    "name = excluded.name",
    "brand = excluded.brand",
    "price = excluded.price",
    "category = excluded.category",
    "niche_type = excluded.niche_type",
    "image_url = excluded.image_url",
    "affiliate_url = excluded.affiliate_url",
    "description = excluded.description",
    "shipping_info = excluded.shipping_info",
  ].join(", ");
  return `
INSERT INTO ${CATALOG_PRODUCTS_TABLE} (${cols})
VALUES (${placeholders})
ON CONFLICT(id) DO UPDATE SET
  ${updates}
`.trim();
}

export class CatalogDbWriter {
  private readonly db: Database.Database;
  private readonly upsertStmt: Database.Statement;

  constructor(dbFilePath?: string) {
    const filePath = dbFilePath ?? catalogSqliteFilePath();
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    applyCatalogDbPragmas(this.db);
    initCatalogDatabase(this.db);
    this.upsertStmt = this.db.prepare(buildUpsertSql());
  }

  /**
   * Upsert pe `id` derivat din `affiliateLink` — actualizează preț și câmpuri la re-feed.
   * Compatibil sintactic cu PostgreSQL (`EXCLUDED` în PG = același rol ca SQLite `excluded.`).
   */
  upsertProducts(
    products: EssentialProduct[],
    opts?: {
      feedUrl?: string;
      providerId?: string;
      feedId?: number | null;
      catalogNiche?: CatalogNicheOverride;
    }
  ): void {
    if (products.length === 0) return;
    const feedUrl = opts?.feedUrl;
    const providerId = (opts?.providerId ?? "generic").trim() || "generic";
    const feedId = opts?.feedId == null ? null : opts.feedId;
    const catalogNiche = opts?.catalogNiche;
    const trx = this.db.transaction((rows: EssentialProduct[]) => {
      for (const p of rows) {
        const r = essentialToRow(p, feedUrl, providerId, feedId, catalogNiche);
        this.upsertStmt.run(
          r.id,
          r.provider_id,
          r.feed_id,
          r.name,
          r.brand,
          r.price,
          r.category,
          r.niche_type,
          r.image_url,
          r.affiliate_url,
          r.description,
          r.shipping_info
        );
      }
    });
    trx(products);
  }

  /** Upsert cu `id` fix (ex. date de test); aceeași clauză `ON CONFLICT(id)`. */
  upsertRawRows(rows: CatalogManualRow[]): void {
    if (rows.length === 0) return;
    const trx = this.db.transaction((items: CatalogManualRow[]) => {
      for (const r of items) {
        const pid = (r.provider_id ?? "seed").trim() || "seed";
        const fid = r.feed_id == null ? null : r.feed_id;
        const ship = (r.shipping_info ?? "").trim();
        this.upsertStmt.run(
          r.id,
          pid,
          fid,
          r.name,
          r.brand,
          r.price,
          r.category,
          r.niche_type,
          r.image_url,
          r.affiliate_url,
          r.description,
          ship
        );
      }
    });
    trx(rows);
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      /* */
    }
  }
}

/** Deschide DB, upsert într-o tranzacție, închide (util scripturi scurte). */
export function upsertProducts(
  products: EssentialProduct[],
  dbPath?: string,
  opts?: { feedUrl?: string; providerId?: string; feedId?: number | null; catalogNiche?: CatalogNicheOverride }
): void {
  const w = new CatalogDbWriter(dbPath);
  try {
    w.upsertProducts(products, opts);
  } finally {
    w.close();
  }
}

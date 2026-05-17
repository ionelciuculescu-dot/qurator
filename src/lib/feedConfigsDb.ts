import { Pool } from "pg";

import type { FeedConfigRow } from "@/ingestion/catalog/sync-feed-from-config";
import { buildAppPgPoolConfig, requirePgEnvConfigured } from "@/lib/pgPoolConfig";

export type FeedConfigWithCount = FeedConfigRow & { product_count: number };

function normalizeFeedRow<T extends FeedConfigRow>(r: T): T {
  return {
    ...r,
    id: Number(r.id),
    is_active: Number(r.is_active) === 1 ? 1 : 0,
  };
}

function mapPgRowWithCount(r: {
  id: number;
  name: string;
  url: string;
  niche: string;
  provider_id: string;
  is_active: boolean;
  product_count: string | null;
}): FeedConfigWithCount {
  const product_count = parseInt(r.product_count ?? "0", 10) || 0;
  const base = normalizeFeedRow({
    id: r.id,
    name: r.name ?? "",
    url: r.url ?? "",
    niche: r.niche ?? "auto",
    provider_id: r.provider_id ?? "generic",
    is_active: r.is_active ? 1 : 0,
  });
  return { ...base, product_count };
}

async function withPool<T>(fn: (pool: Pool) => Promise<T>): Promise<T> {
  requirePgEnvConfigured();
  const pool = new Pool(buildAppPgPoolConfig({ max: 2 }));
  try {
    return await fn(pool);
  } finally {
    await pool.end().catch(() => {});
  }
}

/** DDL idempotent — rulează la prima operație dacă tabelul lipsește. */
async function ensureFeedConfigsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.feed_configs (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL,
      niche TEXT NOT NULL DEFAULT 'auto',
      provider_id TEXT NOT NULL DEFAULT 'generic',
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);
}

export async function listFeedConfigsWithProductCounts(): Promise<FeedConfigWithCount[]> {
  return withPool(async (pool) => {
    await ensureFeedConfigsTable(pool);
    try {
      const r = await pool.query<{
        id: number;
        name: string;
        url: string;
        niche: string;
        provider_id: string;
        is_active: boolean;
        product_count: string | null;
      }>(
        `SELECT f.id, f.name, f.url, f.niche, f.provider_id, f.is_active,
                COALESCE(pc.c, 0)::text AS product_count
         FROM public.feed_configs f
         LEFT JOIN (
           SELECT provider_id, COUNT(*)::bigint AS c
           FROM public.products
           GROUP BY provider_id
         ) pc ON pc.provider_id = f.provider_id
         ORDER BY f.id ASC`
      );
      return r.rows.map((row) => mapPgRowWithCount(row));
    } catch (e) {
      console.warn(
        "[feed_configs] Agregare product_count eșuată (lipsește public.products?). Listez doar feed_configs.",
        e instanceof Error ? e.message : e
      );
      const r = await pool.query<{
        id: number;
        name: string;
        url: string;
        niche: string;
        provider_id: string;
        is_active: boolean;
      }>(
        `SELECT id, name, url, niche, provider_id, is_active
         FROM public.feed_configs
         ORDER BY id ASC`
      );
      return r.rows.map((row) =>
        mapPgRowWithCount({ ...row, product_count: "0" })
      );
    }
  });
}

export async function listActiveFeedConfigs(): Promise<FeedConfigRow[]> {
  return withPool(async (pool) => {
    await ensureFeedConfigsTable(pool);
    const r = await pool.query<{
      id: number;
      name: string;
      url: string;
      niche: string;
      provider_id: string;
      is_active: boolean;
    }>(
      `SELECT id, name, url, niche, provider_id, is_active
       FROM public.feed_configs
       WHERE is_active = TRUE
       ORDER BY id ASC`
    );
    return r.rows.map((row) =>
      normalizeFeedRow({
        id: row.id,
        name: row.name,
        url: row.url,
        niche: row.niche,
        provider_id: row.provider_id,
        is_active: row.is_active ? 1 : 0,
      })
    );
  });
}

export async function countFeedConfigs(): Promise<number> {
  return withPool(async (pool) => {
    await ensureFeedConfigsTable(pool);
    const r = await pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM public.feed_configs`);
    return parseInt(r.rows[0]?.c ?? "0", 10) || 0;
  });
}

export async function countAllProducts(): Promise<number> {
  return withPool(async (pool) => {
    const r = await pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM public.products`);
    return parseInt(r.rows[0]?.c ?? "0", 10) || 0;
  });
}

export type ProductSitemapRow = {
  id: string;
  external_id: string | null;
  updated_at: Date | null;
};

export type PublicProductPage = {
  id: string;
  external_id: string | null;
  name: string;
  brand: string;
  price: string;
  currency: string;
  niche_type: string;
  category: string;
  description: string;
  description_clean: string | null;
  image_url: string;
  affiliate_url: string;
  updated_at: Date | null;
};

/** Pagină publică produs: potrivire după `external_id` sau `id` (text). */
export async function getProductByIdOrExternalId(
  idOrExternalId: string
): Promise<PublicProductPage | null> {
  const key = idOrExternalId.trim();
  if (!key) return null;
  return withPool(async (pool) => {
    const r = await pool.query<PublicProductPage>(
      `SELECT id::text AS id, external_id, name, brand, price, currency,
              niche_type, category, description, description_clean,
              image_url, affiliate_url, updated_at
       FROM public.products
       WHERE external_id = $1 OR id::text = $1
       LIMIT 1`,
      [key]
    );
    return r.rows[0] ?? null;
  });
}

/** Rânduri pentru `app/sitemap.ts` (identificator: external_id sau id numeric). */
export async function listProductsForSitemap(): Promise<ProductSitemapRow[]> {
  return withPool(async (pool) => {
    try {
      const r = await pool.query<{
        id: string;
        external_id: string | null;
        updated_at: Date | null;
      }>(
        `SELECT id::text AS id, external_id, updated_at
         FROM public.products
         ORDER BY updated_at DESC`
      );
      return r.rows;
    } catch (e) {
      console.warn(
        "[sitemap] listProductsForSitemap eșuat:",
        e instanceof Error ? e.message : e
      );
      return [];
    }
  });
}

export async function insertFeedConfig(input: {
  name: string;
  url: string;
  niche: string;
  provider_id: string;
  is_active: number;
}): Promise<FeedConfigRow> {
  return withPool(async (pool) => {
    await ensureFeedConfigsTable(pool);
    const r = await pool.query<{
      id: number;
      name: string;
      url: string;
      niche: string;
      provider_id: string;
      is_active: boolean;
    }>(
      `INSERT INTO public.feed_configs (name, url, niche, provider_id, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, url, niche, provider_id, is_active`,
      [
        input.name.trim(),
        input.url.trim(),
        input.niche.trim() || "auto",
        (input.provider_id || "generic").trim() || "generic",
        Boolean(input.is_active),
      ]
    );
    const row = r.rows[0];
    if (!row) throw new Error("Insert feed_configs fără rând returnat");
    return normalizeFeedRow({
      id: row.id,
      name: row.name,
      url: row.url,
      niche: row.niche,
      provider_id: row.provider_id,
      is_active: row.is_active ? 1 : 0,
    });
  });
}

export async function deleteFeedConfig(id: number): Promise<boolean> {
  return withPool(async (pool) => {
    await ensureFeedConfigsTable(pool);
    const r = await pool.query(`DELETE FROM public.feed_configs WHERE id = $1`, [id]);
    return (r.rowCount ?? 0) > 0;
  });
}

export async function getFeedConfigById(id: number): Promise<FeedConfigRow | null> {
  return withPool(async (pool) => {
    await ensureFeedConfigsTable(pool);
    const r = await pool.query<{
      id: number;
      name: string;
      url: string;
      niche: string;
      provider_id: string;
      is_active: boolean;
    }>(`SELECT id, name, url, niche, provider_id, is_active FROM public.feed_configs WHERE id = $1`, [id]);
    const row = r.rows[0];
    if (!row) return null;
    return normalizeFeedRow({
      id: row.id,
      name: row.name,
      url: row.url,
      niche: row.niche,
      provider_id: row.provider_id,
      is_active: row.is_active ? 1 : 0,
    });
  });
}

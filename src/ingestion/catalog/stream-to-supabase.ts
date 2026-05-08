import { finished } from "node:stream/promises";
import { Pool } from "pg";

import {
  type CatalogNicheOverride,
  inferBrandFromTitle,
  inferCategoryHint,
  inferNicheTypeForCatalog,
  passesSamsungOrPetshopFilter,
} from "@/ingestion/catalog/niche-filters";
import {
  createProductFeedSaxStream,
  essentialFromFlat,
  fetchFeedResponse,
  webBodyToNodeReadable,
  type CreateProductFeedSaxStreamOpts,
} from "@/ingestion/xml/twoPerformantXmlStream";
import { buildAppPgPoolConfig, requirePgEnvConfigured } from "@/lib/pgPoolConfig";
import { generateContentHash } from "@/lib/utils/hash";
import { CATALOG_PRODUCTS_TABLE } from "@/shared/sql/catalog-queries";
import { stableProductIdFromAffiliateUrl } from "@/shared/lib/stable-product-id-from-affiliate-url";
import type { EssentialProduct } from "@/shared/models/product";

const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIM = 1536;
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const ASYNC_BATCH = 40;

/** Tabel catalog în Postgres/Supabase — schemă explicită (evită ambiguitatea `search_path`). */
const SUPABASE_STREAM_PRODUCTS_TABLE = "public.products";

export type StreamFeedToSupabaseOptions = {
  providerId?: string;
  flatToEssential?: (flat: Record<string, string>) => EssentialProduct | null;
  sax?: Pick<CreateProductFeedSaxStreamOpts, "rootTags" | "onParserEnd">;
  feedId?: number | null;
  catalogNiche?: CatalogNicheOverride;
  /** Raportare progres (UI / NDJSON). */
  onProgress?: (p: StreamFeedToSupabaseProgress) => void;
};

/** Snapshot progres import Mall → Supabase. */
export type StreamFeedToSupabaseProgress = {
  phase: "running" | "done";
  /** Noduri XML care au trecut `essentialFromFlat` (comision/stoc). */
  totalEssentialMatched: number;
  /** După filtrul vertical Samsung/pet. */
  queuedForImport: number;
  skippedByFilter: number;
  upserted: number;
  /**
   * Răspunsuri reușite de la API-ul OpenAI embeddings (înainte de upsert).
   * Actualizat live per produs care necesită vector nou.
   */
  openaiEmbeddingsCompleted: number;
  skippedContentUnchanged: number;
  /** Eșecuri la embedding / upsert (per produs). */
  errors: number;
  /** Ultimele mesaje de eroare (scurt). */
  errorSamples: string[];
};

export type StreamFeedToSupabaseResult = {
  totalEssentialMatched: number;
  afterFilterWritten: number;
  /** Răspunsuri OpenAI embeddings reușite (poate fi > afterFilterWritten dacă upsert eșuează după embedding). */
  openaiEmbeddingsCompleted: number;
  skippedByFilter: number;
  skippedContentUnchanged: number;
  errors: number;
  errorSamples: string[];
};


function buildExternalId(providerId: string, affiliateLink: string): string {
  const pid = (providerId || "generic").trim() || "generic";
  return `${pid}:${stableProductIdFromAffiliateUrl(affiliateLink)}`;
}

function embeddingInputText(p: EssentialProduct): string {
  const t = `${p.title}\n${p.description ?? ""}`.trim();
  return t.slice(0, 8000);
}

async function fetchEmbedding1536(text: string): Promise<number[]> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY lipsă (necesar pentru embedding la upsert).");
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

/** Nume tabel fără prefix schemă (pentru `information_schema`). */
function catalogTableBareName(): string {
  const t = CATALOG_PRODUCTS_TABLE.trim();
  return t.includes(".") ? (t.split(".").pop() ?? t) : t;
}

/**
 * Verifică că `products` are coloanele folosite de importul Mall → Supabase.
 * Fără ele, Postgres raportează `42703 column "external_id" does not exist`.
 */
async function assertCatalogProductsStreamColumns(pool: Pool): Promise<void> {
  const name = catalogTableBareName();
  const r = await pool.query<{ table_schema: string }>(
    `SELECT c1.table_schema
     FROM information_schema.columns c1
     INNER JOIN information_schema.columns c2
       ON c1.table_catalog = c2.table_catalog
      AND c1.table_schema = c2.table_schema
      AND c1.table_name = c2.table_name
     WHERE c1.table_name = $1
       AND c1.column_name = 'external_id'
       AND c2.column_name = 'content_hash'
     LIMIT 1`,
    [name]
  );
  if (r.rowCount && r.rows.length > 0) return;

  throw new Error(
    `Postgres: tabelul «${CATALOG_PRODUCTS_TABLE}» nu are coloanele «external_id» și «content_hash». ` +
      `Rulează migrarea (o dată): src/shared/sql/migrate_products_external_id_pg.sql — ex. în Supabase → SQL Editor.`
  );
}

async function loadContentHashMap(pool: Pool, externalIds: string[]): Promise<Map<string, string>> {
  if (externalIds.length === 0) return new Map();
  console.log("DEBUG CONEXIUNE:", {
    host: process.env.PGHOST || "nu e setat",
    database: process.env.PGDATABASE || "nu e setat",
    tabel: SUPABASE_STREAM_PRODUCTS_TABLE,
  });
  const r = await pool.query<{ external_id: string | null; content_hash: string | null }>(
    `SELECT "external_id", "content_hash" FROM public.products WHERE "external_id" = ANY($1::text[])`,
    [externalIds]
  );
  const m = new Map<string, string>();
  for (const row of r.rows) {
    if (row.external_id) m.set(row.external_id, (row.content_hash ?? "").trim());
  }
  return m;
}

/**
 * `feed_id` din admin trebuie să existe în `public.feed_configs` pe același Postgres
 * ca `products`, altfel FK `products_feed_id_fkey` eșuează (23503).
 */
async function resolveFeedIdForProductsFk(pool: Pool, configFeedId: number | null): Promise<number | null> {
  if (configFeedId == null || !Number.isFinite(configFeedId) || configFeedId <= 0) return null;
  const id = Math.floor(configFeedId);
  try {
    const r = await pool.query(`SELECT 1 AS ok FROM public.feed_configs WHERE id = $1 LIMIT 1`, [id]);
    if ((r.rowCount ?? 0) > 0) return id;
    console.warn(
      `[Sync] feed_id=${id} lipsește din public.feed_configs (Postgres). ` +
        `Folosesc NULL la products.feed_id. Replică feed_configs în Supabase sau inserează rândul cu același id.`
    );
    return null;
  } catch (e) {
    console.warn(
      "[Sync] Verificare public.feed_configs eșuată — folosesc NULL la products.feed_id.",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

async function upsertProductRow(
  pool: Pool,
  p: EssentialProduct,
  args: {
    externalId: string;
    contentHash: string;
    providerId: string;
    feedId: number | null;
    feedUrl: string | undefined;
    catalogNiche?: CatalogNicheOverride;
    embedding: number[];
  }
): Promise<void> {
  const niche = args.catalogNiche ?? inferNicheTypeForCatalog(p, args.feedUrl);
  const brand = inferBrandFromTitle(p.title);
  const category = inferCategoryHint(p.title, niche, args.feedUrl);
  const name = p.title.trim();
  const description = (p.description ?? "").trim();
  const price = (p.price ?? "").trim();
  const vecStr = `[${args.embedding.map((x) => (Number.isFinite(x) ? x : 0)).join(",")}]`;

  const sql = `
INSERT INTO ${SUPABASE_STREAM_PRODUCTS_TABLE} (
  external_id, content_hash, provider_id, feed_id, name, brand, price, currency,
  niche_type, category, description, description_clean, image_url, affiliate_url,
  shipping_info, tags, embedding
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::vector
)
ON CONFLICT (external_id) DO UPDATE SET
  content_hash = EXCLUDED.content_hash,
  provider_id = EXCLUDED.provider_id,
  feed_id = EXCLUDED.feed_id,
  name = EXCLUDED.name,
  brand = EXCLUDED.brand,
  price = EXCLUDED.price,
  currency = EXCLUDED.currency,
  niche_type = EXCLUDED.niche_type,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  description_clean = EXCLUDED.description_clean,
  image_url = EXCLUDED.image_url,
  affiliate_url = EXCLUDED.affiliate_url,
  shipping_info = EXCLUDED.shipping_info,
  tags = EXCLUDED.tags,
  embedding = EXCLUDED.embedding
`.trim();

  try {
    await pool.query(sql, [
      args.externalId,
      args.contentHash,
      args.providerId,
      args.feedId,
      name,
      brand,
      price,
      "RON",
      niche,
      category,
      description,
      description,
      (p.image ?? "").trim(),
      p.affiliateLink.trim(),
      (p.shippingNote ?? "").trim(),
      null,
      vecStr,
    ]);
  } catch (error) {
    console.error("Eroare detaliată Postgres:", error);
    const pgErr = error as {
      code?: string;
      detail?: string;
      hint?: string;
      constraint?: string;
      column?: string;
      table?: string;
      schema?: string;
    };
    if (pgErr?.code != null || pgErr?.detail != null) {
      console.error("Postgres (diagnostic RLS/conflict/colonă):", {
        code: pgErr.code,
        detail: pgErr.detail,
        hint: pgErr.hint,
        constraint: pgErr.constraint,
        column: pgErr.column,
        table: pgErr.table,
        schema: pgErr.schema,
      });
    }
    throw error;
  }
}

/**
 * Stream XML → Postgres (Supabase) cu `content_hash` (MD5 titlu+descriere+preț).
 * Dacă `external_id` există și hash-ul e identic, sare produsul (fără OpenAI).
 * Altfel: embedding `text-embedding-3-small` + upsert.
 */
export async function streamFeedUrlToSupabase(
  url: string,
  init?: RequestInit,
  options?: StreamFeedToSupabaseOptions
): Promise<StreamFeedToSupabaseResult> {
  let pool: Pool | null = null;
  try {
    requirePgEnvConfigured();
    const res = await fetchFeedResponse(url, init ?? undefined);
    if (!res.ok) {
      throw new Error(`Feed HTTP ${res.status}: ${res.statusText}`);
    }

    const providerId = (options?.providerId ?? "generic").trim() || "generic";
    const mapFlat = options?.flatToEssential ?? essentialFromFlat;
    const feedId = options?.feedId == null ? null : options.feedId;
    const catalogNiche = options?.catalogNiche;
    const fromManagedFeedConfig = feedId != null && feedId > 0;
    const feedUrl = url;

    pool = new Pool(buildAppPgPoolConfig({ max: 4 }));
    // await assertCatalogProductsStreamColumns(pool); // coloane verificate manual în Supabase

    const feedIdForPg = await resolveFeedIdForProductsFk(pool, feedId);

    let totalEssential = 0;
    let skipped = 0;
    let rejectLogRemaining = 5;
    let skippedContentUnchanged = 0;
    let upserted = 0;
    let openaiEmbeddingsCompleted = 0;
    let queuedForImport = 0;
    let errors = 0;
    const errorSamples: string[] = [];

    const emit = (phase: StreamFeedToSupabaseProgress["phase"]) => {
      options?.onProgress?.({
        phase,
        totalEssentialMatched: totalEssential,
        queuedForImport,
        skippedByFilter: skipped,
        upserted,
        openaiEmbeddingsCompleted,
        skippedContentUnchanged,
        errors,
        errorSamples: errorSamples.slice(-20),
      });
    };

    const maybeEmitScan = () => {
      if (totalEssential > 0 && totalEssential % 100 === 0) emit("running");
    };

    let writeChain: Promise<void> = Promise.resolve();
    const pending: EssentialProduct[] = [];

    const flushAsyncBatch = async (rows: EssentialProduct[]) => {
      if (rows.length === 0) return;
      const pg = pool;
      if (!pg) {
        throw new Error("[Sync] Pool indisponibil la flushAsyncBatch.");
      }
      const metas = rows.map((row) => {
        const externalId = buildExternalId(providerId, row.affiliateLink);
        const contentHash = generateContentHash(row.title, row.description ?? "", row.price);
        return { row, externalId, contentHash };
      });
      const idList = metas.map((m) => m.externalId);
      const existing = await loadContentHashMap(pg, idList);

      console.log("Trimit spre OpenAI lotul de 40...");

      let batchSkip = 0;
      let batchNew = 0;
      let batchErr = 0;

      for (const m of metas) {
        try {
          const prev = existing.get(m.externalId);
          if (prev != null && prev === m.contentHash) {
            skippedContentUnchanged += 1;
            batchSkip += 1;
            continue;
          }
          const emb = await fetchEmbedding1536(embeddingInputText(m.row));
          openaiEmbeddingsCompleted += 1;
          emit("running");
          await upsertProductRow(pg, m.row, {
            externalId: m.externalId,
            contentHash: m.contentHash,
            providerId,
            feedId: feedIdForPg,
            feedUrl,
            catalogNiche,
            embedding: emb,
          });
          upserted += 1;
          batchNew += 1;
          emit("running");
        } catch (err) {
          errors += 1;
          batchErr += 1;
          const msg = err instanceof Error ? err.message : String(err);
          if (errorSamples.length < 25) errorSamples.push(msg.slice(0, 240));
          emit("running");
        }
      }
      const batchN = rows.length;
      const errSuffix = batchErr > 0 ? `, Erori: ${batchErr}` : "";
      console.log(
        `[Sync] Batch procesat: ${batchN} produse. Noi: ${batchNew}, Skip: ${batchSkip}${errSuffix}`
      );
      emit("running");
    };

    const enqueue = (row: EssentialProduct) => {
      pending.push(row);
      queuedForImport += 1;
      maybeEmitScan();
      if (pending.length >= ASYNC_BATCH) {
        const chunk = pending.splice(0, ASYNC_BATCH);
        writeChain = writeChain.then(() => flushAsyncBatch(chunk));
      }
    };

    console.log("Stream pornit, încep parsarea XML...");
    const nodeBody = webBodyToNodeReadable(res);
    const saxStream = createProductFeedSaxStream(
      (flat) => {
        const row = mapFlat(flat);
        if (!row) return;
        console.log("Am găsit un produs în XML: ", row.title);
        totalEssential += 1;
        maybeEmitScan();
        if (!passesSamsungOrPetshopFilter(row, feedUrl, { fromManagedFeedConfig, catalogNiche })) {
          skipped += 1;
          if (rejectLogRemaining > 0) {
            rejectLogRemaining -= 1;
            const t = row.title.trim().slice(0, 160);
            console.log(`Produs respins: ${t.length > 0 ? t : "(fără titlu)"}`);
          }
          return;
        }
        enqueue(row);
      },
      {
        rootTags: options?.sax?.rootTags,
        onParserEnd: () => {
          const tail = pending.length;
          if (tail > 0) {
            console.log(`Finalizare: Procesez ultimele ${tail} produse din coadă...`);
            const chunk = pending.splice(0, tail);
            writeChain = writeChain.then(() => flushAsyncBatch(chunk));
          }
          try {
            options?.sax?.onParserEnd?.();
          } catch (hookErr) {
            console.error("[streamFeedUrlToSupabase] onParserEnd (opțiuni sax):", hookErr);
          }
        },
      }
    );

    nodeBody.pipe(saxStream);
    try {
      await finished(saxStream);
    } finally {
      try {
        nodeBody.unpipe(saxStream);
      } catch {
        /* */
      }
      try {
        nodeBody.destroy();
      } catch {
        /* */
      }
      try {
        saxStream.destroy();
      } catch {
        /* */
      }
    }

    await writeChain;
    if (pending.length > 0) {
      const tail = pending.length;
      console.log(`Finalizare: Procesez ultimele ${tail} produse din coadă...`);
      await flushAsyncBatch(pending.splice(0, tail));
    }

    const result: StreamFeedToSupabaseResult = {
      totalEssentialMatched: totalEssential,
      afterFilterWritten: upserted,
      openaiEmbeddingsCompleted,
      skippedByFilter: skipped,
      skippedContentUnchanged,
      errors,
      errorSamples: errorSamples.slice(-20),
    };
    emit("done");
    return result;
  } catch (error) {
    console.error("EROARE FATALĂ:", error);
    throw error;
  } finally {
    if (pool) {
      await pool.end().catch(() => {});
    }
  }
}

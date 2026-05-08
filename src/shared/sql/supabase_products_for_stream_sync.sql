-- =============================================================================
-- Supabase: `public.products` aliniat la `src/ingestion/catalog/stream-to-supabase.ts`
-- (INSERT / ON CONFLICT (external_id)).
--
-- Mapare nume (cod TypeScript → coloane):
--   • titlu produs     → name
--   • link afiliat     → affiliate_url
--   • nișă mall        → niche_type (TEXT); opțional niche_id (UUID) dacă adaugi FK mai târziu
--
-- Preț: codul trimite TEXT ($7); dacă vrei NUMERIC, modifică și parametrii din upsert.
-- Rulează în Supabase → SQL Editor ca superuser / owner.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- Necesar dacă vrei FK pe feed_id ca în `init_db.sql` (altfel comentează FK și păstrează INTEGER).
CREATE TABLE IF NOT EXISTS public.feed_configs (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  niche TEXT NOT NULL DEFAULT 'auto',
  provider_id TEXT NOT NULL DEFAULT 'generic',
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Tabel nou (fără DROP). Dacă ai deja `products` incomplet, folosește migrări / ALTER.
CREATE TABLE IF NOT EXISTS public.products (
  id BIGSERIAL PRIMARY KEY,

  -- Upsert + skip hash (loadContentHashMap)
  external_id TEXT,
  content_hash TEXT NOT NULL DEFAULT '',

  provider_id TEXT NOT NULL DEFAULT 'generic',
  feed_id INTEGER REFERENCES public.feed_configs (id) ON DELETE SET NULL,

  -- Titlu / catalog (în cod: name ← p.title)
  name TEXT NOT NULL DEFAULT '',
  brand VARCHAR(100) NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  currency VARCHAR(10) NOT NULL DEFAULT 'RON',

  niche_type VARCHAR(50) NOT NULL DEFAULT '',
  -- Opțional: mapare viitoare către tabele de nișă (nu e trimis în upsert-ul curent).
  niche_id UUID NULL,

  category VARCHAR(100) NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  description_clean TEXT,

  image_url TEXT NOT NULL DEFAULT '',
  -- Link afiliat (în cod: affiliate_link → affiliate_url)
  affiliate_url TEXT NOT NULL DEFAULT '',
  shipping_info TEXT NOT NULL DEFAULT '',
  tags TEXT[],

  embedding vector(1536) NULL,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Obligatoriu pentru ON CONFLICT (external_id) din stream-to-supabase.ts
CREATE UNIQUE INDEX IF NOT EXISTS products_external_id_uidx
  ON public.products (external_id);

COMMENT ON COLUMN public.products.name IS 'Titlu produs (echivalent semantic „title” din feed).';
COMMENT ON COLUMN public.products.affiliate_url IS 'Link afiliat.';
COMMENT ON COLUMN public.products.niche_type IS 'Nișă mall / catalog (string).';

-- Căutare full-text pe nume (română) — ca în init_db.sql
CREATE INDEX IF NOT EXISTS idx_products_name_fts
  ON public.products
  USING GIN (to_tsvector('romanian', name));

CREATE INDEX IF NOT EXISTS idx_products_feed_id ON public.products (feed_id);
CREATE INDEX IF NOT EXISTS idx_products_provider_id ON public.products (provider_id);
CREATE INDEX IF NOT EXISTS idx_products_niche_type ON public.products (niche_type);

-- ---------------------------------------------------------------------------
-- Căutare semantică (pgvector)
-- IVFFlat: bun după ce ai suficiente rânduri (ex. > 1000); tune lists după dimensiune.
-- HNSW: adesea preferat pe Supabase/pgvector recent; pornește cu unul dintre ele.
-- ---------------------------------------------------------------------------

-- Varianta IVFFlat (cosine), comentată dacă preferi doar HNSW:
-- CREATE INDEX IF NOT EXISTS idx_products_embedding_ivfflat
--   ON public.products
--   USING ivfflat (embedding vector_cosine_ops)
--   WITH (lists = 100);

-- Varianta HNSW (cosine). Dacă primești eroare la creare, comentează acest bloc și folosește IVFFlat.
CREATE INDEX IF NOT EXISTS idx_products_embedding_hnsw
  ON public.products
  USING hnsw (embedding vector_cosine_ops);

-- Dacă HNSW nu e suportat, șterge indexul de mai sus și rulează:
-- CREATE INDEX IF NOT EXISTS idx_products_embedding_ivfflat
--   ON public.products USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ---------------------------------------------------------------------------
-- FK: Sync „Magazine configurate” (id din admin) → Postgres
-- Fără acest rând, sync-ul folosește feed_id NULL pe products (evită 23503).
-- ---------------------------------------------------------------------------
-- INSERT INTO public.feed_configs (id, name, url, niche, provider_id, is_active)
-- VALUES (
--   10,
--   'Nume magazin',
--   'https://…/feed.xml',
--   'petshop',
--   'generic',
--   TRUE
-- )
-- ON CONFLICT (id) DO UPDATE SET
--   name = EXCLUDED.name,
--   url = EXCLUDED.url,
--   niche = EXCLUDED.niche,
--   provider_id = EXCLUDED.provider_id,
--   is_active = EXCLUDED.is_active;
-- SELECT setval(pg_get_serial_sequence('public.feed_configs', 'id'), (SELECT COALESCE(MAX(id), 1) FROM public.feed_configs));

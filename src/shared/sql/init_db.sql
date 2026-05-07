-- Init PostgreSQL + pgvector: catalog (echivalent SQLite din `catalog-schema-ddl.ts`)
-- + câmpuri AI (description_clean, tags, embedding).
-- Rulează într-o bază cu extensia pgvector instalată (ex. `CREATE EXTENSION` din superuser).

-- Inteligență semantică (vectori OpenAI etc.)
CREATE EXTENSION IF NOT EXISTS vector;

-- feed_configs și user_sessions: idempotent (fără DROP)
CREATE TABLE IF NOT EXISTS feed_configs (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  niche TEXT NOT NULL DEFAULT 'auto',
  provider_id TEXT NOT NULL DEFAULT 'generic',
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS user_sessions (
  session_id TEXT PRIMARY KEY NOT NULL,
  detected_niche TEXT,
  detected_species TEXT,
  last_context_summary TEXT,
  last_category TEXT,
  current_species TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  context_slots_json TEXT
);

-- Start curat doar pentru produse (conform ghidului inițial)
DROP TABLE IF EXISTS products;

-- Coloane aliniate la `CATALOG_PRODUCT_COLUMNS` + monedă, curat pentru AI, tag-uri, embedding.
-- `title` în ghid ≈ `name` aici (nume produs); index GIN pe același câmp.
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  provider_id TEXT NOT NULL DEFAULT 'generic',
  feed_id INTEGER REFERENCES feed_configs (id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '',
  brand VARCHAR(100) NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  currency VARCHAR(10) NOT NULL DEFAULT 'RON',
  niche_type VARCHAR(50) NOT NULL DEFAULT '',
  category VARCHAR(100) NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  description_clean TEXT,
  image_url TEXT NOT NULL DEFAULT '',
  affiliate_url TEXT NOT NULL DEFAULT '',
  shipping_info TEXT NOT NULL DEFAULT '',
  tags TEXT[],
  embedding vector(1536)
);

CREATE INDEX idx_products_title ON products USING GIN (to_tsvector('romanian', name));

CREATE INDEX IF NOT EXISTS idx_products_feed_id ON products (feed_id);
CREATE INDEX IF NOT EXISTS idx_products_provider_id ON products (provider_id);

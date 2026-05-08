-- Migrare manuală Postgres / Supabase: cheie stabilă + hash conținut (vezi `stream-to-supabase.ts`).
-- Rulează o dată dacă `products` există deja fără aceste coloane.

ALTER TABLE products ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS content_hash TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS products_external_id_uidx ON products (external_id);

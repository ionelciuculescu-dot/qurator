import { CATALOG_PRODUCTS_TABLE } from "@/shared/sql/catalog-queries";
import { FEED_CONFIGS_TABLE } from "@/shared/sql/feed-config-queries";

/** Sesiuni utilizator (nișă / specie / context) în același SQLite ca catalogul. */
export const USER_SESSIONS_TABLE = "user_sessions" as const;

/**
 * DDL pentru SQLite (fișier local).
 *
 * Echivalent recomandat PostgreSQL / Supabase: vezi `src/shared/sql/init_db.sql`.
 * Fragment orientativ (poate fi depășit de fișierul SQL):
 * ```sql
 * CREATE TABLE IF NOT EXISTS public.products (
 *   id            BIGSERIAL PRIMARY KEY,
 *   provider_id   TEXT NOT NULL DEFAULT 'generic',
 *   name          TEXT NOT NULL DEFAULT '',
 *   brand         TEXT NOT NULL DEFAULT '',
 *   price         TEXT NOT NULL DEFAULT '',
 *   category      TEXT NOT NULL DEFAULT '',
 *   niche_type    TEXT NOT NULL DEFAULT '',
 *   image_url     TEXT NOT NULL DEFAULT '',
 *   affiliate_url TEXT NOT NULL DEFAULT '',
 *   description   TEXT NOT NULL DEFAULT '',
 *   shipping_info TEXT NOT NULL DEFAULT ''
 * );
 * ```
 * - `INTEGER PRIMARY KEY AUTOINCREMENT` → `BIGSERIAL PRIMARY KEY`
 * - `TEXT` rămâne `TEXT` în PostgreSQL
 */
export function catalogProductsDdlSqlite(): string {
  return `
CREATE TABLE IF NOT EXISTS ${CATALOG_PRODUCTS_TABLE} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL DEFAULT 'generic',
  feed_id INTEGER,
  name TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  niche_type TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  affiliate_url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  shipping_info TEXT NOT NULL DEFAULT ''
);
`.trim();
}

/**
 * Baze create înainte de coloana `provider_id`: adaugă coloana fără a recrea tabelul.
 * Apelă după `CREATE TABLE IF NOT EXISTS` (ex. în `CatalogDbWriter`).
 */
export function ensureCatalogProviderIdColumnSqlite(
  db: { prepare: (sql: string) => { all: () => unknown[] }; exec: (sql: string) => void }
): void {
  const rows = db.prepare(`PRAGMA table_info(${CATALOG_PRODUCTS_TABLE})`).all() as { name: string }[];
  if (!rows.some((r) => r.name === "provider_id")) {
    db.exec(
      `ALTER TABLE ${CATALOG_PRODUCTS_TABLE} ADD COLUMN provider_id TEXT NOT NULL DEFAULT 'legacy';`
    );
  }
}

/**
 * Coloană `feed_id` pe `products` (legătură opțională la `feed_configs.id`).
 */
export function ensureCatalogFeedIdColumnSqlite(
  db: { prepare: (sql: string) => { all: () => unknown[] }; exec: (sql: string) => void }
): void {
  const rows = db.prepare(`PRAGMA table_info(${CATALOG_PRODUCTS_TABLE})`).all() as { name: string }[];
  if (!rows.some((r) => r.name === "feed_id")) {
    db.exec(`ALTER TABLE ${CATALOG_PRODUCTS_TABLE} ADD COLUMN feed_id INTEGER;`);
  }
}

export function ensureCatalogShippingInfoColumnSqlite(
  db: { prepare: (sql: string) => { all: () => unknown[] }; exec: (sql: string) => void }
): void {
  const rows = db.prepare(`PRAGMA table_info(${CATALOG_PRODUCTS_TABLE})`).all() as { name: string }[];
  if (!rows.some((r) => r.name === "shipping_info")) {
    db.exec(
      `ALTER TABLE ${CATALOG_PRODUCTS_TABLE} ADD COLUMN shipping_info TEXT NOT NULL DEFAULT '';`
    );
  }
}

export function feedConfigsDdlSqlite(): string {
  return `
CREATE TABLE IF NOT EXISTS ${FEED_CONFIGS_TABLE} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  niche TEXT NOT NULL DEFAULT 'auto',
  provider_id TEXT NOT NULL DEFAULT 'generic',
  is_active INTEGER NOT NULL DEFAULT 1
);
`.trim();
}

/**
 * Sesiuni chat per `session_id` (ex. UUID din `/api/chat`).
 * `updated_at` folosește tipul DATETIME SQLite (afinitate NUMERIC / ISO).
 */
export function userSessionsDdlSqlite(): string {
  return `
CREATE TABLE IF NOT EXISTS ${USER_SESSIONS_TABLE} (
  session_id TEXT PRIMARY KEY NOT NULL,
  detected_niche TEXT,
  detected_species TEXT,
  last_context_summary TEXT,
  last_category TEXT,
  current_species TEXT,
  updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
);
`.trim();
}

/** Migrare: coloană `last_category` pe sesiuni (context linie de produs). */
export function ensureUserSessionsLastCategoryColumnSqlite(
  db: { prepare: (sql: string) => { all: () => unknown[] }; exec: (sql: string) => void }
): void {
  const rows = db.prepare(`PRAGMA table_info(${USER_SESSIONS_TABLE})`).all() as { name: string }[];
  if (!rows.some((r) => r.name === "last_category")) {
    db.exec(`ALTER TABLE ${USER_SESSIONS_TABLE} ADD COLUMN last_category TEXT;`);
  }
}

/** Migrare: ancoră specie pentru SQL (ex. Labrador → câine). */
export function ensureUserSessionsCurrentSpeciesColumnSqlite(
  db: { prepare: (sql: string) => { all: () => unknown[] }; exec: (sql: string) => void }
): void {
  const rows = db.prepare(`PRAGMA table_info(${USER_SESSIONS_TABLE})`).all() as { name: string }[];
  if (!rows.some((r) => r.name === "current_species")) {
    db.exec(`ALTER TABLE ${USER_SESSIONS_TABLE} ADD COLUMN current_species TEXT;`);
  }
}

/** Sloturi de context (JSON), complementar `current_species` — formă hrană etc. */
export function ensureUserSessionsContextSlotsJsonColumnSqlite(
  db: { prepare: (sql: string) => { all: () => unknown[] }; exec: (sql: string) => void }
): void {
  const rows = db.prepare(`PRAGMA table_info(${USER_SESSIONS_TABLE})`).all() as { name: string }[];
  if (!rows.some((r) => r.name === "context_slots_json")) {
    db.exec(`ALTER TABLE ${USER_SESSIONS_TABLE} ADD COLUMN context_slots_json TEXT;`);
  }
}

type CatalogDbLike = {
  pragma: (s: string) => unknown;
  exec: (sql: string) => void;
  prepare: (sql: string) => { all: () => unknown[] };
};

/** Rulează DDL + migrări minime pentru fișierul catalog SQLite (după `journal_mode` dacă e cazul). */
export function initCatalogDatabase(db: CatalogDbLike): void {
  db.exec(catalogProductsDdlSqlite());
  ensureCatalogProviderIdColumnSqlite(db);
  ensureCatalogFeedIdColumnSqlite(db);
  ensureCatalogShippingInfoColumnSqlite(db);
  db.exec(feedConfigsDdlSqlite());
  db.exec(userSessionsDdlSqlite());
  ensureUserSessionsLastCategoryColumnSqlite(db);
  ensureUserSessionsCurrentSpeciesColumnSqlite(db);
  ensureUserSessionsContextSlotsJsonColumnSqlite(db);
}

/** WAL + așteptare la blocaj (ex. sync admin + polling SWR pe același fișier). */
export function applyCatalogDbPragmas(db: { pragma: (sql: string) => unknown }): void {
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 15000");
}

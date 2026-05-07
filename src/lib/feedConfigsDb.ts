import Database from "better-sqlite3";

import { applyCatalogDbPragmas, initCatalogDatabase } from "@/shared/db/catalog-schema-ddl";
import { catalogSqliteFilePath } from "@/shared/db/catalog-sqlite-path";
import { FEED_CONFIGS_TABLE } from "@/shared/sql/feed-config-queries";

import type { FeedConfigRow } from "@/ingestion/catalog/sync-feed-from-config";

export type FeedConfigWithCount = FeedConfigRow & { product_count: number };

function normalizeFeedRow<T extends FeedConfigRow>(r: T): T {
  return {
    ...r,
    id: Number(r.id),
    is_active: Number(r.is_active) === 1 ? 1 : 0,
  };
}

function openCatalog(): Database.Database {
  const db = new Database(catalogSqliteFilePath());
  applyCatalogDbPragmas(db);
  initCatalogDatabase(db);
  return db;
}

export function listFeedConfigsWithProductCounts(): FeedConfigWithCount[] {
  const db = openCatalog();
  try {
    const rows = db
      .prepare(
        `SELECT f.id, f.name, f.url, f.niche, f.provider_id, f.is_active,
          (SELECT COUNT(*) FROM products p WHERE p.feed_id = f.id) AS product_count
         FROM ${FEED_CONFIGS_TABLE} f
         ORDER BY f.id ASC`
      )
      .all() as FeedConfigWithCount[];
    return rows.map((r) => ({
      ...normalizeFeedRow(r),
      product_count: Number(r.product_count ?? 0),
    }));
  } finally {
    db.close();
  }
}

export function listActiveFeedConfigs(): FeedConfigRow[] {
  const db = openCatalog();
  try {
    const rows = db
      .prepare(
        `SELECT id, name, url, niche, provider_id, is_active FROM ${FEED_CONFIGS_TABLE}
         WHERE is_active = 1 ORDER BY id ASC`
      )
      .all() as FeedConfigRow[];
    return rows.map((r) => normalizeFeedRow(r));
  } finally {
    db.close();
  }
}

export function countFeedConfigs(): number {
  const db = openCatalog();
  try {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${FEED_CONFIGS_TABLE}`).get() as { c: number };
    return row.c;
  } finally {
    db.close();
  }
}

export function insertFeedConfig(input: {
  name: string;
  url: string;
  niche: string;
  provider_id: string;
  is_active: number;
}): FeedConfigRow {
  const db = openCatalog();
  try {
    const info = db
      .prepare(
        `INSERT INTO ${FEED_CONFIGS_TABLE} (name, url, niche, provider_id, is_active)
         VALUES (@name, @url, @niche, @provider_id, @is_active)`
      )
      .run({
        name: input.name.trim(),
        url: input.url.trim(),
        niche: input.niche.trim() || "auto",
        provider_id: (input.provider_id || "generic").trim() || "generic",
        is_active: input.is_active ? 1 : 0,
      });
    const newId = Number(info.lastInsertRowid);
    const row = db
      .prepare(`SELECT id, name, url, niche, provider_id, is_active FROM ${FEED_CONFIGS_TABLE} WHERE id = ?`)
      .get(newId) as FeedConfigRow | undefined;
    if (!row) throw new Error("Insert feed_configs fără rând returnat");
    return normalizeFeedRow(row);
  } finally {
    db.close();
  }
}

export function deleteFeedConfig(id: number): boolean {
  const db = openCatalog();
  try {
    const r = db.prepare(`DELETE FROM ${FEED_CONFIGS_TABLE} WHERE id = ?`).run(id);
    return r.changes > 0;
  } finally {
    db.close();
  }
}

export function getFeedConfigById(id: number): FeedConfigRow | null {
  const db = openCatalog();
  try {
    const row = db
      .prepare(`SELECT id, name, url, niche, provider_id, is_active FROM ${FEED_CONFIGS_TABLE} WHERE id = ?`)
      .get(id) as FeedConfigRow | undefined;
    return row ? normalizeFeedRow(row) : null;
  } finally {
    db.close();
  }
}

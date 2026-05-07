import path from "node:path";

/** Aceeași cale ca la `SqliteCatalogReader` / writer (override: `CATALOG_SQLITE_PATH`). */
export function catalogSqliteFilePath(): string {
  const fromEnv = process.env.CATALOG_SQLITE_PATH?.trim();
  if (fromEnv) return fromEnv;
  return path.join(process.cwd(), "data", "catalog.db");
}

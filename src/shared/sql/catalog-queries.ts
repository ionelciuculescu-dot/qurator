/**
 * Interogări SQL portabile (fără funcții specifice SQLite), aliniate la PostgreSQL / Supabase.
 * Evităm: datetime('now'), AUTOINCREMENT în SELECT, tipuri non-standard în expresii.
 *
 * La migrare PG: înlocuiește numele schemei dacă e cazul (`public.products`) și păstrează aceleași aliasuri de coloane.
 */

/** Nume tabel catalog (în PG: adesea `public.products`). */
export const CATALOG_PRODUCTS_TABLE = "products";

/** Lista coloane pentru mapare către `ParsedProduct` (aceeași ordine în ambele dialecte). */
export const CATALOG_PRODUCT_COLUMNS = [
  "id",
  "provider_id",
  "feed_id",
  "name",
  "brand",
  "price",
  "category",
  "niche_type",
  "image_url",
  "affiliate_url",
  "description",
  "shipping_info",
] as const;

/**
 * Toate produsele, ordonate stabil după `id` (index-friendly în PG și SQLite).
 */
export function sqlSelectAllProductsByIdAsc(): string {
  const cols = CATALOG_PRODUCT_COLUMNS.join(", ");
  return `SELECT ${cols} FROM ${CATALOG_PRODUCTS_TABLE} ORDER BY id ASC`;
}

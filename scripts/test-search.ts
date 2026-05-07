/**
 * Caută un produs după nume în SQLite (`products.name`).
 * 1) Potrivire strictă `name = ?`
 * 2) Dacă nu e nimic: `TRIM(name) = TRIM(?)` (același string căutat)
 *
 * Dacă apare rândul → datele sunt în catalog; problema e probabil în Sales / AI, nu în Ingestion.
 *
 * Rulează:
 *   npx tsx scripts/test-search.ts -- "Nume Exact Produs"
 *   npm run test:search -- "Nume Exact Produs"
 */
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { config } from "dotenv";

import { catalogSqliteFilePath } from "../src/shared/db/catalog-sqlite-path";
import { CATALOG_PRODUCTS_TABLE } from "../src/shared/sql/catalog-queries";

const root = process.cwd();
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });

type ProductRow = {
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
};

function needleFromArgv(): string {
  const parts = process.argv.slice(2);
  if (parts[0] === "--") parts.shift();
  return parts.join(" ").trim();
}

function main() {
  const needle = needleFromArgv();
  if (!needle) {
    console.error(
      "Lipsește numele produsului.\n" +
        "  Exemplu: npx tsx scripts/test-search.ts -- \"Hrana uscata pentru pisici Advance 1.5kg\""
    );
    process.exit(1);
  }

  const dbPath = catalogSqliteFilePath();
  const db = new Database(dbPath, { readonly: true });

  const cols = [
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
  ].join(", ");

  try {
    let mode = "name = ? (exact)";
    let rows = db.prepare(`SELECT ${cols} FROM ${CATALOG_PRODUCTS_TABLE} WHERE name = ?`).all(needle) as ProductRow[];

    if (rows.length === 0) {
      mode = "TRIM(name) = TRIM(?)";
      rows = db
        .prepare(`SELECT ${cols} FROM ${CATALOG_PRODUCTS_TABLE} WHERE TRIM(name) = TRIM(?)`)
        .all(needle) as ProductRow[];
    }

    console.log(`Fișier DB: ${dbPath}`);
    console.log(`String căutat: ${JSON.stringify(needle)}`);
    console.log(`Mod potrivire: ${mode}\n`);

    if (rows.length === 0) {
      console.log("Rezultat: NICIUN rând (nici exact, nici cu TRIM).");
      console.log(
        "→ Verifică Ingestion / textul exact din `products.name` (diacritice, ghilimele, caractere invizibile)."
      );
      process.exit(1);
    }

    console.log(`Rezultat: ${rows.length} rând(uri).`);
    if (mode.includes("TRIM")) {
      console.log("Notă: potrivirea strictă a eșuat; s-a folosit TRIM — compară `name` din DB cu stringul tău.\n");
    } else {
      console.log("→ SQLite returnează produsul; dacă AI-ul nu-l folosește, verifică Sales (build context, limită, keyword).\n");
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const desc = (r.description ?? "").trim();
      const descShort = desc.length > 200 ? `${desc.slice(0, 200)}…` : desc;
      console.log(`--- #${i + 1} ---`);
      console.log(`  id:            ${r.id}`);
      console.log(`  provider_id:   ${r.provider_id}`);
      console.log(`  feed_id:       ${r.feed_id ?? "(null)"}`);
      console.log(`  name:          ${r.name}`);
      console.log(`  brand:         ${r.brand}`);
      console.log(`  price:         ${r.price}`);
      console.log(`  category:      ${r.category}`);
      console.log(`  niche_type:    ${r.niche_type}`);
      console.log(`  affiliate_url: ${(r.affiliate_url ?? "").slice(0, 120)}${(r.affiliate_url ?? "").length > 120 ? "…" : ""}`);
      console.log(`  image_url:     ${(r.image_url ?? "").slice(0, 100)}${(r.image_url ?? "").length > 100 ? "…" : ""}`);
      console.log(`  description:   ${descShort || "(gol)"}`);
      console.log("");
    }

    process.exit(0);
  } finally {
    db.close();
  }
}

main();

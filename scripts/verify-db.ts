/**
 * Verificare rapidă catalog SQLite. Rulează: `npx tsx scripts/verify-db.ts`
 */
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { config } from "dotenv";

import { catalogSqliteFilePath } from "../src/shared/db/catalog-sqlite-path";
import { CATALOG_PRODUCTS_TABLE } from "../src/shared/sql/catalog-queries";

const root = process.cwd();
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });

function main() {
  const dbPath = catalogSqliteFilePath();
  const db = new Database(dbPath, { readonly: true });

  try {
    const total = (
      db.prepare(`SELECT COUNT(*) AS c FROM ${CATALOG_PRODUCTS_TABLE}`).get() as { c: number }
    ).c;
    console.log(`Total produse în \`${CATALOG_PRODUCTS_TABLE}\`: ${total}`);

    const brands = db
      .prepare(
        `SELECT DISTINCT TRIM(brand) AS brand FROM ${CATALOG_PRODUCTS_TABLE} ORDER BY brand ASC`
      )
      .all() as { brand: string }[];
    const unique = brands.map((r) => r.brand).filter((b) => b.length > 0);
    const emptyBrandCount = brands.filter((r) => r.brand.length === 0).length;
    console.log(
      `\nBranduri unice (nevide): ${unique.length}` +
        (emptyBrandCount > 0 ? ` (+ ${emptyBrandCount} rânduri cu brand gol)` : "")
    );
    console.log(unique.length ? unique.join(", ") : "(niciun brand nevid)");

    const sample = db
      .prepare(
        `SELECT id, provider_id, name, price, affiliate_url FROM ${CATALOG_PRODUCTS_TABLE} ORDER BY id ASC LIMIT 3`
      )
      .all() as {
      id: number;
      provider_id: string;
      name: string;
      price: string;
      affiliate_url: string;
    }[];

    console.log("\nPrimele 3 rânduri (provider_id, name, price, affiliate_url):");
    if (sample.length === 0) {
      console.log("  (tabel gol)");
    } else {
      for (const row of sample) {
        console.log(`  [${row.id}] provider=${row.provider_id} | ${row.name}`);
        console.log(`      preț: ${row.price}`);
        console.log(`      link: ${row.affiliate_url}`);
      }
    }

    console.log(`\nFișier: ${dbPath}`);
  } finally {
    db.close();
  }
}

main();

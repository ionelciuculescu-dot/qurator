/**
 * Verificare rapidă catalog Postgres (`public.products`). Rulează: `npm run db:verify`
 */
import { resolve } from "node:path";
import { config } from "dotenv";
import { Pool } from "pg";

import { buildAppPgPoolConfig, requirePgEnvConfigured } from "../src/lib/pgPoolConfig";
import { CATALOG_PRODUCTS_TABLE } from "../src/shared/sql/catalog-queries";

const root = process.cwd();
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });

const TABLE = `public.${CATALOG_PRODUCTS_TABLE}`;

async function main() {
  requirePgEnvConfigured();
  const pool = new Pool(buildAppPgPoolConfig({ max: 2 }));
  try {
    const total = (
      await pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM ${TABLE}`)
    ).rows[0]!.c;
    console.log(`Total produse în \`${TABLE}\`: ${total}`);

    const brands = await pool.query<{ brand: string }>(
      `SELECT DISTINCT TRIM(brand) AS brand FROM ${TABLE} ORDER BY brand ASC`
    );
    const unique = brands.rows.map((r) => r.brand).filter((b) => b.length > 0);
    const emptyBrandCount = brands.rows.filter((r) => r.brand.length === 0).length;
    console.log(
      `\nBranduri unice (nevide): ${unique.length}` +
        (emptyBrandCount > 0 ? ` (+ ${emptyBrandCount} rânduri cu brand gol)` : "")
    );
    console.log(unique.length ? unique.join(", ") : "(niciun brand nevid)");

    const sample = await pool.query<{
      id: string;
      provider_id: string;
      name: string;
      price: string;
      affiliate_url: string;
    }>(
      `SELECT id::text, provider_id, name, price, affiliate_url FROM ${TABLE} ORDER BY id ASC LIMIT 3`
    );

    console.log("\nPrimele 3 rânduri (provider_id, name, price, affiliate_url):");
    if (sample.rows.length === 0) {
      console.log("  (tabel gol)");
    } else {
      for (const row of sample.rows) {
        console.log(`  [${row.id}] provider=${row.provider_id} | ${row.name}`);
        console.log(`      preț: ${row.price}`);
        console.log(`      link: ${row.affiliate_url}`);
      }
    }

    console.log("\nSursă: DATABASE_URL / PG* din .env");
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

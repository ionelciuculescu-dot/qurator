/**
 * Caută un produs după nume în Postgres (`public.products.name`).
 * 1) Potrivire strictă `name = $1`
 * 2) Dacă nu e nimic: `TRIM(name) = TRIM($1)`
 *
 * Dacă apare rândul → datele sunt în catalog; problema e probabil în Sales / AI, nu în Ingestion.
 *
 * Rulează:
 *   npx tsx scripts/test-search.ts -- "Nume Exact Produs"
 *   npm run test:search -- "Nume Exact Produs"
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

type ProductRow = {
  id: string;
  provider_id: string;
  feed_id: string | null;
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

async function main() {
  const needle = needleFromArgv();
  if (!needle) {
    console.error(
      "Lipsește numele produsului.\n" +
        "  Exemplu: npx tsx scripts/test-search.ts -- \"Hrana uscata pentru pisici Advance 1.5kg\""
    );
    process.exit(1);
  }

  requirePgEnvConfigured();
  const pool = new Pool(buildAppPgPoolConfig({ max: 2 }));

  const cols = [
    "id::text AS id",
    "provider_id",
    "feed_id::text AS feed_id",
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
    let rows = (
      await pool.query<ProductRow>(`SELECT ${cols} FROM ${TABLE} WHERE name = $1`, [needle])
    ).rows;

    if (rows.length === 0) {
      mode = "TRIM(name) = TRIM(?)";
      rows = (
        await pool.query<ProductRow>(
          `SELECT ${cols} FROM ${TABLE} WHERE TRIM(name) = TRIM($1)`,
          [needle]
        )
      ).rows;
    }

    console.log(`Tabel: ${TABLE}`);
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
      console.log(
        "→ Postgres returnează produsul; dacă AI-ul nu-l folosește, verifică Sales (build context, limită, keyword).\n"
      );
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
      console.log(
        `  affiliate_url: ${(r.affiliate_url ?? "").slice(0, 120)}${(r.affiliate_url ?? "").length > 120 ? "…" : ""}`
      );
      console.log(
        `  image_url:     ${(r.image_url ?? "").slice(0, 100)}${(r.image_url ?? "").length > 100 ? "…" : ""}`
      );
      console.log(`  description:   ${descShort || "(gol)"}`);
      console.log("");
    }

    process.exit(0);
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

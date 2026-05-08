/**
 * Inserează produse de test în `public.products` (Postgres / Supabase).
 * Rulează: `npm run db:seed`
 */
import { resolve } from "node:path";
import { config } from "dotenv";
import { Pool } from "pg";

import { buildAppPgPoolConfig, requirePgEnvConfigured } from "../src/lib/pgPoolConfig";

const root = process.cwd();
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });

const PROVIDER_ID = "seed-demo";
const CONTENT_HASH = "seed";

type SeedRow = {
  external_id: string;
  name: string;
  brand: string;
  price: string;
  category: string;
  niche_type: string;
  image_url: string;
  affiliate_url: string;
  description: string;
  shipping_info: string;
};

const SAMPLE: SeedRow[] = [
  {
    external_id: "qurator-seed-s24u",
    name: "Samsung Galaxy S24 Ultra 256GB",
    brand: "Samsung",
    price: "5499 RON",
    category: "Telefoane",
    niche_type: "it",
    image_url: "https://example.com/img/s24u.jpg",
    affiliate_url: "https://example.com/aff/samsung-s24u-seed-1",
    description: "Flagship Samsung, ecran Dynamic AMOLED.",
    shipping_info: "Transport gratuit la comenzi online. Livrare rapidă 24–48h.",
  },
  {
    external_id: "qurator-seed-a55",
    name: "Samsung Galaxy A55 5G 128GB",
    brand: "Samsung",
    price: "1899 RON",
    category: "Telefoane",
    niche_type: "it",
    image_url: "https://example.com/img/a55.jpg",
    affiliate_url: "https://example.com/aff/samsung-a55-seed-2",
    description: "Mid-range 5G, baterie mare.",
    shipping_info: "",
  },
  {
    external_id: "qurator-seed-buds3",
    name: "Samsung Galaxy Buds3 Pro",
    brand: "Samsung",
    price: "899 RON",
    category: "Audio",
    niche_type: "it",
    image_url: "https://example.com/img/buds3.jpg",
    affiliate_url: "https://example.com/aff/samsung-buds3-seed-3",
    description: "Căști true wireless cu ANC.",
    shipping_info: "",
  },
  {
    external_id: "qurator-seed-cat-food",
    name: "Hrană uscată pisici adult, pui, 7kg",
    brand: "",
    price: "219 RON",
    category: "Pisici",
    niche_type: "petshop",
    image_url: "https://example.com/img/cat-food.jpg",
    affiliate_url: "https://example.com/aff/pet-food-cat-seed-4",
    description: "Crochete pentru pisici adulte, aromă pui.",
    shipping_info: "",
  },
  {
    external_id: "qurator-seed-dog-toy",
    name: "Jucărie câine — frânghie dentală",
    brand: "",
    price: "45 RON",
    category: "Câini",
    niche_type: "petshop",
    image_url: "https://example.com/img/dog-toy.jpg",
    affiliate_url: "https://example.com/aff/pet-toy-dog-seed-5",
    description: "Jucărie rezistentă pentru dentiție.",
    shipping_info: "",
  },
  {
    external_id: "qurator-seed-litter",
    name: "Litiere silicatic pisici, 10L",
    brand: "",
    price: "129 RON",
    category: "Pisici",
    niche_type: "petshop",
    image_url: "https://example.com/img/litter.jpg",
    affiliate_url: "https://example.com/aff/pet-litter-seed-6",
    description: "Absorbant, control miros.",
    shipping_info: "",
  },
  {
    external_id: "qurator-seed-tab-s9",
    name: "Samsung Galaxy Tab S9 FE Wi‑Fi",
    brand: "Samsung",
    price: "2299 RON",
    category: "Tablete",
    niche_type: "it",
    image_url: "https://example.com/img/tabs9fe.jpg",
    affiliate_url: "https://example.com/aff/samsung-tab-s9fe-seed-7",
    description: "Tabletă cu stylus inclus.",
    shipping_info: "",
  },
  {
    external_id: "qurator-seed-wet-dog",
    name: "Apă de vită pentru câini seniori, 12x400g",
    brand: "",
    price: "99 RON",
    category: "Câini",
    niche_type: "petshop",
    image_url: "https://example.com/img/wet-dog.jpg",
    affiliate_url: "https://example.com/aff/pet-wet-dog-seed-8",
    description: "Multipack conservă umedă.",
    shipping_info: "",
  },
];

const UPSERT_SQL = `
INSERT INTO public.products (
  external_id, content_hash, provider_id, feed_id, name, brand, price, currency,
  niche_type, category, description, description_clean, image_url, affiliate_url,
  shipping_info, tags, embedding
) VALUES (
  $1, $2, $3, NULL, $4, $5, $6, 'RON', $7, $8, $9, $9, $10, $11, $12, NULL, NULL
)
ON CONFLICT (external_id) DO UPDATE SET
  content_hash = EXCLUDED.content_hash,
  provider_id = EXCLUDED.provider_id,
  feed_id = EXCLUDED.feed_id,
  name = EXCLUDED.name,
  brand = EXCLUDED.brand,
  price = EXCLUDED.price,
  currency = EXCLUDED.currency,
  niche_type = EXCLUDED.niche_type,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  description_clean = EXCLUDED.description_clean,
  image_url = EXCLUDED.image_url,
  affiliate_url = EXCLUDED.affiliate_url,
  shipping_info = EXCLUDED.shipping_info,
  tags = EXCLUDED.tags,
  embedding = EXCLUDED.embedding
`.trim();

async function main() {
  requirePgEnvConfigured();
  const pool = new Pool(buildAppPgPoolConfig({ max: 2 }));
  try {
    for (const row of SAMPLE) {
      await pool.query(UPSERT_SQL, [
        row.external_id,
        CONTENT_HASH,
        PROVIDER_ID,
        row.name,
        row.brand,
        row.price,
        row.niche_type,
        row.category,
        row.description,
        row.image_url,
        row.affiliate_url,
        row.shipping_info || "",
      ]);
    }
    console.log(`[seed-sample-data] Upsert ${SAMPLE.length} produse în public.products (provider_id=${PROVIDER_ID})`);
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

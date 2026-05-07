/**
 * Inserează produse de test în `data/catalog.db` (Samsung + Petshop).
 * Rulează: `npm run db:seed`
 */
import { config } from "dotenv";
import { resolve } from "node:path";

import type { CatalogManualRow } from "../src/ingestion/persistence/catalog-db-writer";
import { CatalogDbWriter } from "../src/ingestion/persistence/catalog-db-writer";

const root = process.cwd();
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });

const SAMPLE: CatalogManualRow[] = [
  {
    id: 1,
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
    id: 2,
    name: "Samsung Galaxy A55 5G 128GB",
    brand: "Samsung",
    price: "1899 RON",
    category: "Telefoane",
    niche_type: "it",
    image_url: "https://example.com/img/a55.jpg",
    affiliate_url: "https://example.com/aff/samsung-a55-seed-2",
    description: "Mid-range 5G, baterie mare.",
  },
  {
    id: 3,
    name: "Samsung Galaxy Buds3 Pro",
    brand: "Samsung",
    price: "899 RON",
    category: "Audio",
    niche_type: "it",
    image_url: "https://example.com/img/buds3.jpg",
    affiliate_url: "https://example.com/aff/samsung-buds3-seed-3",
    description: "Căști true wireless cu ANC.",
  },
  {
    id: 4,
    name: "Hrană uscată pisici adult, pui, 7kg",
    brand: "",
    price: "219 RON",
    category: "Pisici",
    niche_type: "petshop",
    image_url: "https://example.com/img/cat-food.jpg",
    affiliate_url: "https://example.com/aff/pet-food-cat-seed-4",
    description: "Crochete pentru pisici adulte, aromă pui.",
  },
  {
    id: 5,
    name: "Jucărie câine — frânghie dentală",
    brand: "",
    price: "45 RON",
    category: "Câini",
    niche_type: "petshop",
    image_url: "https://example.com/img/dog-toy.jpg",
    affiliate_url: "https://example.com/aff/pet-toy-dog-seed-5",
    description: "Jucărie rezistentă pentru dentiție.",
  },
  {
    id: 6,
    name: "Litiere silicatic pisici, 10L",
    brand: "",
    price: "129 RON",
    category: "Pisici",
    niche_type: "petshop",
    image_url: "https://example.com/img/litter.jpg",
    affiliate_url: "https://example.com/aff/pet-litter-seed-6",
    description: "Absorbant, control miros.",
  },
  {
    id: 7,
    name: "Samsung Galaxy Tab S9 FE Wi‑Fi",
    brand: "Samsung",
    price: "2299 RON",
    category: "Tablete",
    niche_type: "it",
    image_url: "https://example.com/img/tabs9fe.jpg",
    affiliate_url: "https://example.com/aff/samsung-tab-s9fe-seed-7",
    description: "Tabletă cu stylus inclus.",
  },
  {
    id: 8,
    name: "Apă de vită pentru câini seniori, 12x400g",
    brand: "",
    price: "99 RON",
    category: "Câini",
    niche_type: "petshop",
    image_url: "https://example.com/img/wet-dog.jpg",
    affiliate_url: "https://example.com/aff/pet-wet-dog-seed-8",
    description: "Multipack conservă umedă.",
  },
];

function main() {
  const w = new CatalogDbWriter();
  try {
    w.upsertRawRows(SAMPLE);
    console.log(`[seed-sample-data] Upsert ${SAMPLE.length} produse în catalog.db`);
  } finally {
    w.close();
  }
}

main();

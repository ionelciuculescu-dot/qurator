import { filterPetshopProductsBySpeciesIntent } from "@/shared/filters/petshop-logic";
import { extractDeliveryPerks } from "@/shared/lib/delivery-hints";
import type { ParsedProduct } from "@/shared/models/product";
import type { CatalogListOptions } from "@/shared/ports/catalog-reader";

/** Rând `products` aliniat la coloanele citite de reader (Postgres). */
export type CatalogProductRow = {
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
  shipping_info: string;
};

export function rowToParsedProduct(row: CatalogProductRow): ParsedProduct {
  const name = (row.name ?? "").trim();
  const brand = (row.brand ?? "").trim();
  const title =
    name && brand && !name.toLowerCase().includes(brand.toLowerCase())
      ? `${name} — ${brand}`
      : name || brand || `Produs #${row.id}`;

  const category = (row.category ?? "").trim();
  const niche = (row.niche_type ?? "").trim();
  const categoryOut =
    category && niche ? `${category} (${niche})` : category || niche || undefined;

  const desc = (row.description ?? "").trim();
  const ship = (row.shipping_info ?? "").trim();
  const deliveryPerks = extractDeliveryPerks(desc, ship);

  return {
    title,
    price: (row.price ?? "").trim(),
    affiliateLink: (row.affiliate_url ?? "").trim(),
    image: (row.image_url ?? "").trim(),
    description: desc,
    ...(categoryOut ? { category: categoryOut } : {}),
    ...(deliveryPerks ? { deliveryPerks } : {}),
    ...(niche ? { nicheType: niche } : {}),
  };
}

/**
 * După maparea din SQL: pentru `niche_type === petshop` poate aplica filtrarea câine/pisică
 * pe baza mesajului (`refineForUserMessage`) când `CatalogListOptions.speciesSqlAnchor` e setat.
 */
export function applyCatalogNicheSpeciesFilters(
  products: ParsedProduct[],
  options?: CatalogListOptions
): ParsedProduct[] {
  if (!options?.speciesSqlAnchor) {
    return products;
  }
  const userMessage = options?.refineForUserMessage ?? "";
  const nicheKey = (p: ParsedProduct) => (p.nicheType ?? "").trim().toLowerCase();

  const petshop = products.filter((p) => nicheKey(p) === "petshop");
  const keptPetshop = filterPetshopProductsBySpeciesIntent(petshop, userMessage);
  const kept = new Set(keptPetshop);

  return products.filter((p) => (nicheKey(p) === "petshop" ? kept.has(p) : true));
}

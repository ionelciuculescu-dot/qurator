import type { EssentialProduct } from "@/shared/models/product";

import { streamFeedUrlToSupabase } from "@/ingestion/catalog/stream-to-supabase";
import {
  MAX_DESCRIPTION_OUT,
  cap,
  flattenKeys,
  normalizePriceFromFlat,
  parseCommissionPercent,
  parseInStock,
  pickFirst,
} from "@/ingestion/xml/twoPerformantXmlStream";
import { firstImageUrlFromField } from "@/shared/lib/product-image-url";

import { BaseFeedProvider } from "./base-provider";

/**
 * Mapare strictă pentru feed-ul Bravapet (XML 2Performant / magazin):
 * `title`, `aff_code`, `price`, `image_urls`, `description`, `campaign_name` (ignorat la mapare esențială).
 * Comision/stoc: aceleași reguli ca feed-ul generic dacă apar câmpuri extra.
 */
export function essentialFromBravapetProductFlat(flat: Record<string, string>): EssentialProduct | null {
  const f = flattenKeys(flat);

  const commissionRaw = pickFirst(f, [
    "commission_percent",
    "commission",
    "comision",
    "commission_rate",
    "affiliate_commission",
    "comision_procent",
    "cpa",
    "revenue_share",
  ]);

  let commissionPct: number;
  if (commissionRaw.trim() !== "") {
    const parsed = parseCommissionPercent(commissionRaw);
    if (parsed == null || parsed <= 5) return null;
    commissionPct = parsed;
  } else {
    commissionPct = 10;
  }

  const stockRaw = pickFirst(f, [
    "availability",
    "product_active",
    "stock",
    "in_stock",
    "inventory",
    "is_in_stock",
  ]);
  const inStock = stockRaw.trim() === "" ? true : parseInStock(stockRaw);
  if (!inStock) return null;

  const title = (f.title ?? "").trim();
  const affiliateLink = (f.aff_code ?? "").trim();
  const priceRaw = (f.price ?? "").trim();
  const price = normalizePriceFromFlat(priceRaw) || priceRaw;
  const descriptionRaw = (f.description ?? "").trim();
  const imageUrlsRaw = (f.image_urls ?? "").trim();

  if (!title || !affiliateLink) return null;

  const image = imageUrlsRaw ? firstImageUrlFromField(imageUrlsRaw) : "";

  const description = descriptionRaw ? cap(descriptionRaw, MAX_DESCRIPTION_OUT) : "";

  const out: EssentialProduct = {
    title,
    price,
    affiliateLink,
    commissionPct,
    inStock: true,
  };
  if (image) out.image = image;
  if (description) out.description = description;
  return out;
}

export class BravapetFeedProvider extends BaseFeedProvider {
  readonly providerId = "bravapet";

  matchesUrl(url: URL): boolean {
    const h = url.hostname.toLowerCase();
    const needle = `${url.hostname}${url.pathname}${url.search}`.toLowerCase();
    return (
      h === "bravapet.ro" ||
      h.endsWith(".bravapet.ro") ||
      h.includes("bravapet") ||
      needle.includes("bravapet")
    );
  }

  async sync(url: string, init?: RequestInit) {
    return streamFeedUrlToSupabase(url, init, {
      providerId: this.providerId,
      flatToEssential: essentialFromBravapetProductFlat,
    });
  }
}

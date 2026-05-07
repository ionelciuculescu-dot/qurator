import { essentialFromFlat } from "@/ingestion/xml/twoPerformantXmlStream";
import type { EssentialProduct } from "@/shared/models/product";

import type { CatalogNicheOverride } from "@/ingestion/catalog/niche-filters";
import { essentialFromBravapetProductFlat } from "@/ingestion/providers/bravapet-provider";

import { streamFeedUrlToCatalogDb, type StreamFeedToCatalogDbResult } from "./stream-to-db";

/** Rând `feed_configs` din SQLite. */
export type FeedConfigRow = {
  id: number;
  name: string;
  url: string;
  niche: string;
  provider_id: string;
  is_active: number;
};

export function flatMapperForStoredProvider(
  providerId: string
): (flat: Record<string, string>) => EssentialProduct | null {
  const p = providerId.trim().toLowerCase();
  if (p === "bravapet") return essentialFromBravapetProductFlat;
  return essentialFromFlat;
}

/**
 * Mapează `feed_configs.niche` → override pentru `products.niche_type` la import XML.
 * `auto` / necunoscut → inferență din conținut (`inferNicheTypeForCatalog`).
 */
function catalogNicheFromFeedRow(niche: string): CatalogNicheOverride | undefined {
  const n = niche.trim().toLowerCase();
  if (n === "auto" || n === "") return undefined;
  if (n === "petshop" || n === "it" || n === "tech" || n === "generic") {
    return n;
  }
  return undefined;
}

/** Stream un feed după config DB (URL, provider, nișă, feed_id). */
export async function streamFeedFromFeedConfig(
  row: FeedConfigRow,
  init?: RequestInit
): Promise<StreamFeedToCatalogDbResult> {
  const pid = row.provider_id.trim() || "generic";
  return streamFeedUrlToCatalogDb(row.url, init, {
    providerId: pid,
    flatToEssential: flatMapperForStoredProvider(pid),
    feedId: row.id,
    catalogNiche: catalogNicheFromFeedRow(row.niche),
  });
}

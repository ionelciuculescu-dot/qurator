import { essentialFromFlat } from "@/ingestion/xml/twoPerformantXmlStream";
import type { EssentialProduct } from "@/shared/models/product";

import type { CatalogNicheOverride } from "@/ingestion/catalog/niche-filters";
import { essentialFromBravapetProductFlat } from "@/ingestion/providers/bravapet-provider";

import { streamFeedUrlToSupabase, type StreamFeedToSupabaseResult } from "./stream-to-supabase";

/** Rând `public.feed_configs` (Postgres / Supabase). */
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

function catalogNicheFromFeedRow(niche: string): CatalogNicheOverride | undefined {
  const n = niche.trim().toLowerCase();
  if (n === "auto" || n === "") return undefined;
  if (n === "petshop" || n === "it" || n === "tech" || n === "generic" || n === "bricolaj") {
    return n;
  }
  return undefined;
}

/** Stream un feed după config (URL, provider, nișă, feed_id) → Postgres/Supabase + embedding. */
export async function streamFeedFromFeedConfig(
  row: FeedConfigRow,
  init?: RequestInit
): Promise<StreamFeedToSupabaseResult> {
  const pid = row.provider_id.trim() || "generic";
  return streamFeedUrlToSupabase(row.url, init, {
    providerId: pid,
    flatToEssential: flatMapperForStoredProvider(pid),
    feedId: row.id,
    catalogNiche: catalogNicheFromFeedRow(row.niche),
  });
}

/** Alias explicit pentru scripturi / API care menționează Supabase. */
export async function streamFeedFromFeedConfigToSupabase(
  row: FeedConfigRow,
  init?: RequestInit
): Promise<StreamFeedToSupabaseResult> {
  return streamFeedFromFeedConfig(row, init);
}

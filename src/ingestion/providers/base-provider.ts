import type { StreamFeedToSupabaseResult } from "@/ingestion/catalog/stream-to-supabase";

/**
 * Provider de feed: detectare după URL + `sync()` descarcă și scrie în Postgres (Supabase).
 */
export abstract class BaseFeedProvider {
  /** Valoare stocată în `products.provider_id`. */
  abstract readonly providerId: string;

  abstract matchesUrl(url: URL): boolean;

  abstract sync(url: string, init?: RequestInit): Promise<StreamFeedToSupabaseResult>;
}

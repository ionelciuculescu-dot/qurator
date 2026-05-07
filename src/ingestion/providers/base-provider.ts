import type { StreamFeedToCatalogDbResult } from "@/ingestion/catalog/stream-to-db";

/**
 * Provider de feed: detectare după URL + `sync()` descarcă și scrie în catalog.
 */
export abstract class BaseFeedProvider {
  /** Valoare stocată în `products.provider_id`. */
  abstract readonly providerId: string;

  abstract matchesUrl(url: URL): boolean;

  abstract sync(url: string, init?: RequestInit): Promise<StreamFeedToCatalogDbResult>;
}

import { streamFeedUrlToCatalogDb } from "@/ingestion/catalog/stream-to-db";

import { BaseFeedProvider } from "./base-provider";

export class GenericFeedProvider extends BaseFeedProvider {
  readonly providerId = "generic";

  /** Fallback: acceptă orice URL (folosit ultimul în lanțul de rezolvare). */
  matchesUrl(): boolean {
    return true;
  }

  async sync(url: string, init?: RequestInit) {
    return streamFeedUrlToCatalogDb(url, init, {
      providerId: this.providerId,
    });
  }
}

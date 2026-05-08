import { streamFeedUrlToSupabase } from "@/ingestion/catalog/stream-to-supabase";

import { BaseFeedProvider } from "./base-provider";

export class GenericFeedProvider extends BaseFeedProvider {
  readonly providerId = "generic";

  /** Fallback: acceptă orice URL (folosit ultimul în lanțul de rezolvare). */
  matchesUrl(): boolean {
    return true;
  }

  async sync(url: string, init?: RequestInit) {
    return streamFeedUrlToSupabase(url, init, {
      providerId: this.providerId,
    });
  }
}

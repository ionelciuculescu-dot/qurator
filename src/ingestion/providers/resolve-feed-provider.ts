import { BaseFeedProvider } from "./base-provider";
import { BravapetFeedProvider } from "./bravapet-provider";
import { GenericFeedProvider } from "./generic-provider";

const bravapet = new BravapetFeedProvider();
const generic = new GenericFeedProvider();

/** Ordinea contează: primul `matchesUrl` câștigă; generic e mereu ultimul. */
const REGISTRY: BaseFeedProvider[] = [bravapet, generic];

/**
 * Alege providerul după host/cale URL. Dacă niciunul specific nu se potrivește → `GenericFeedProvider`.
 */
export function resolveFeedProvider(feedUrl: string): BaseFeedProvider {
  let parsed: URL;
  try {
    parsed = new URL(feedUrl);
  } catch {
    return generic;
  }
  for (const p of REGISTRY) {
    if (p.matchesUrl(parsed)) return p;
  }
  return generic;
}

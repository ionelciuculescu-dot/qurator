import { finished } from "node:stream/promises";

import {
  type CatalogNicheOverride,
  passesSamsungOrPetshopFilter,
} from "@/ingestion/catalog/niche-filters";
import { CatalogDbWriter } from "@/ingestion/persistence/catalog-db-writer";
import {
  createProductFeedSaxStream,
  essentialFromFlat,
  fetchFeedResponse,
  webBodyToNodeReadable,
  type CreateProductFeedSaxStreamOpts,
} from "@/ingestion/xml/twoPerformantXmlStream";
import type { EssentialProduct } from "@/shared/models/product";

export type StreamFeedToCatalogDbResult = {
  /** Câte noduri au trecut `flatToEssential` (comision/stoc). */
  totalEssentialMatched: number;
  /** Înregistrate în SQLite după filtrele Samsung / Petshop. */
  afterFilterWritten: number;
  /** Esențiale ignorate de filtru. */
  skippedByFilter: number;
};

export type StreamFeedToCatalogDbOptions = {
  /** ID scris în `products.provider_id` (ex. `bravapet`, `generic`). */
  providerId?: string;
  /** Mapare flat SAX → produs esențial (implicit: feed generic 2Performant). */
  flatToEssential?: (flat: Record<string, string>) => EssentialProduct | null;
  /** Opțiuni SAX (rădăcină produs etc.). */
  sax?: Pick<CreateProductFeedSaxStreamOpts, "rootTags" | "onParserEnd">;
  /** Legătură la `feed_configs.id` (produse numărabile per sursă). */
  feedId?: number | null;
  /** Forțează `niche_type` din config feed (`auto` = inferență din conținut). */
  catalogNiche?: CatalogNicheOverride;
};

/**
 * Descarcă feed XML, SAX, filtrează verticale Samsung & Petshop,
 * upsert în `catalog.db` prin `CatalogDbWriter`.
 */
export async function streamFeedUrlToCatalogDb(
  url: string,
  init?: RequestInit,
  options?: StreamFeedToCatalogDbOptions
): Promise<StreamFeedToCatalogDbResult> {
  const res = await fetchFeedResponse(url, init ?? undefined);
  if (!res.ok) {
    throw new Error(`Feed HTTP ${res.status}: ${res.statusText}`);
  }

  const providerId = (options?.providerId ?? "generic").trim() || "generic";
  const mapFlat = options?.flatToEssential ?? essentialFromFlat;
  const feedId = options?.feedId == null ? null : options.feedId;
  const catalogNiche = options?.catalogNiche;
  const fromManagedFeedConfig = feedId != null && feedId > 0;

  const writer = new CatalogDbWriter();
  const feedUrl = url;
  let totalEssential = 0;
  let skipped = 0;
  let written = 0;
  let rejectLogRemaining = 5;
  const batch: EssentialProduct[] = [];
  const BATCH_SIZE = 100;

  const flush = () => {
    if (batch.length === 0) return;
    const n = batch.length;
    writer.upsertProducts([...batch], { feedUrl, providerId, feedId, catalogNiche });
    written += n;
    batch.length = 0;
  };

  try {
    const nodeBody = webBodyToNodeReadable(res);
    const saxStream = createProductFeedSaxStream(
      (flat) => {
        const row = mapFlat(flat);
        if (!row) return;
        totalEssential += 1;
        if (!passesSamsungOrPetshopFilter(row, feedUrl, { fromManagedFeedConfig, catalogNiche })) {
          skipped += 1;
          if (rejectLogRemaining > 0) {
            rejectLogRemaining -= 1;
            const t = row.title.trim().slice(0, 160);
            console.log(`Produs respins: ${t.length > 0 ? t : "(fără titlu)"}`);
          }
          return;
        }
        batch.push(row);
        if (batch.length >= BATCH_SIZE) flush();
      },
      {
        rootTags: options?.sax?.rootTags,
        onParserEnd: options?.sax?.onParserEnd,
      }
    );

    nodeBody.pipe(saxStream);
    try {
      await finished(saxStream);
    } finally {
      try {
        nodeBody.unpipe(saxStream);
      } catch {
        /* */
      }
      try {
        nodeBody.destroy();
      } catch {
        /* */
      }
      try {
        saxStream.destroy();
      } catch {
        /* */
      }
    }

    flush();
    return {
      totalEssentialMatched: totalEssential,
      afterFilterWritten: written,
      skippedByFilter: skipped,
    };
  } finally {
    flush();
    writer.close();
  }
}

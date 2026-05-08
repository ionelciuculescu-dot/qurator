/**
 * Stream feed-uri XML → Postgres/Supabase (hash conținut + embedding OpenAI la schimbare).
 * `npm run catalog:stream-supabase`
 *
 * Necesită: DATABASE_URL (sau PG*), OPENAI_API_KEY, migrare `migrate_products_external_id_pg.sql` dacă tabelul există deja.
 *
 * Surse URL-uri: aceeași logică ca `catalog:stream-db` (CLI → public.feed_configs active → env).
 */
import { config } from "dotenv";
import { resolve } from "node:path";

import { countFeedConfigs, listActiveFeedConfigs } from "../src/lib/feedConfigsDb";
import {
  streamFeedFromFeedConfigToSupabase,
} from "../src/ingestion/catalog/sync-feed-from-config";
import { streamFeedUrlToSupabase } from "../src/ingestion/catalog/stream-to-supabase";
import { resolveFeedProvider } from "../src/ingestion/providers/resolve-feed-provider";

const root = process.cwd();
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });

function isPlaceholderUrl(url: string): boolean {
  const u = url.trim();
  return !u || u.includes("YOUR-2PERFORMANT");
}

function splitCommaSeparatedUrls(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !isPlaceholderUrl(s));
}

function parseUrlsFromEnv(): string[] {
  const primary = process.env.CATALOG_FEED_URLS?.trim();
  if (primary) {
    return splitCommaSeparatedUrls(primary);
  }
  const legacy = process.env.TWO_PERFORMANT_FEED_URL?.trim();
  if (legacy) {
    return splitCommaSeparatedUrls(legacy);
  }
  return [];
}

function parseUrlsFromArgv(): string[] {
  const args = process.argv.slice(2);
  if (args.length === 0) return [];
  return args.flatMap((a) => splitCommaSeparatedUrls(a));
}

function feedHostname(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname || url;
  } catch {
    return url.length > 72 ? `${url.slice(0, 69)}…` : url;
  }
}

async function main() {
  const fromCli = parseUrlsFromArgv();
  if (fromCli.length > 0) {
    await runUrlList(fromCli, "CLI");
    return;
  }

  if ((await countFeedConfigs()) > 0) {
    const active = await listActiveFeedConfigs();
    if (active.length > 0) {
      console.log(
        `[stream-feed-to-supabase] Sursă: public.feed_configs (Postgres) | ${active.length} feed(uri) active`
      );
      const totals = {
        totalEssentialMatched: 0,
        afterFilterWritten: 0,
        openaiEmbeddingsCompleted: 0,
        skippedByFilter: 0,
        skippedContentUnchanged: 0,
      };
      let index = 0;
      for (const row of active) {
        index += 1;
        const hostname = feedHostname(row.url);
        console.log(
          `--- START: ${hostname} --- (${index}/${active.length}) [feed_id=${row.id}] [provider=${row.provider_id}]`
        );
        const r = await streamFeedFromFeedConfigToSupabase(row);
        totals.totalEssentialMatched += r.totalEssentialMatched;
        totals.afterFilterWritten += r.afterFilterWritten;
        totals.openaiEmbeddingsCompleted += r.openaiEmbeddingsCompleted;
        totals.skippedByFilter += r.skippedByFilter;
        totals.skippedContentUnchanged += r.skippedContentUnchanged;
        console.log(
          `  → esențiale: ${r.totalEssentialMatched}, OpenAI embeddings: ${r.openaiEmbeddingsCompleted}, upsert PG: ${r.afterFilterWritten}, sărite filtru: ${r.skippedByFilter}, neschimbate (hash): ${r.skippedContentUnchanged}`
        );
        console.log(`--- FINALIZAT: ${hostname} ---`);
      }
      console.log("[stream-feed-to-supabase] Total:", JSON.stringify(totals, null, 2));
      return;
    }
    console.log(
      "[stream-feed-to-supabase] Există feed_configs dar niciunul activ — încerc variabilele de mediu."
    );
  }

  const fromEnv = parseUrlsFromEnv();
  if (fromEnv.length === 0) {
    const nCfg = await countFeedConfigs();
    const nActive = nCfg > 0 ? (await listActiveFeedConfigs()).length : 0;
    const hintInactive =
      nCfg > 0 && nActive === 0
        ? "\n  • Există rânduri în feed_configs dar niciunul nu e activ — `/admin/feeds`.\n"
        : "";
    console.error(
      "Lipsește sursa de feed-uri." +
        hintInactive +
        "\n  • public.feed_configs (Postgres) active, sau CATALOG_FEED_URLS / TWO_PERFORMANT_FEED_URL, sau CLI:\n" +
        "  • npm run catalog:stream-supabase -- https://…feed.xml"
    );
    process.exit(1);
  }

  await runUrlList(fromEnv, "CATALOG_FEED_URLS / TWO_PERFORMANT_FEED_URL");
}

async function runUrlList(urls: string[], source: string) {
  console.log(
    `[stream-feed-to-supabase] Sursă: ${source} | ${urls.length} URL(uri):`,
    urls.map((u) => feedHostname(u)).join(", ")
  );
  const totals = {
    totalEssentialMatched: 0,
    afterFilterWritten: 0,
    openaiEmbeddingsCompleted: 0,
    skippedByFilter: 0,
    skippedContentUnchanged: 0,
  };
  let index = 0;
  const y = urls.length;
  for (const url of urls) {
    index += 1;
    const hostname = feedHostname(url);
    const provider = resolveFeedProvider(url);
    console.log(`--- START: ${hostname} --- (${index}/${y}) [provider=${provider.providerId}]`);
    const r = await streamFeedUrlToSupabase(url, undefined, {
      providerId: provider.providerId,
    });
    totals.totalEssentialMatched += r.totalEssentialMatched;
    totals.afterFilterWritten += r.afterFilterWritten;
    totals.openaiEmbeddingsCompleted += r.openaiEmbeddingsCompleted;
    totals.skippedByFilter += r.skippedByFilter;
    totals.skippedContentUnchanged += r.skippedContentUnchanged;
    console.log(
      `  → esențiale: ${r.totalEssentialMatched}, OpenAI embeddings: ${r.openaiEmbeddingsCompleted}, upsert PG: ${r.afterFilterWritten}, sărite filtru: ${r.skippedByFilter}, neschimbate (hash): ${r.skippedContentUnchanged}`
    );
    console.log(`--- FINALIZAT: ${hostname} ---`);
  }
  console.log("[stream-feed-to-supabase] Total:", JSON.stringify(totals, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

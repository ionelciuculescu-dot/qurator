/**
 * Stream feed-uri XML → Postgres / Supabase (`public.products`). `npm run catalog:stream-db`
 *
 * Ordine surse URL-uri:
 * 1. Argumente CLI (`npm run catalog:stream-db -- https://a.xml …`)
 * 2. Dacă există rânduri **active** în `public.feed_configs` (Postgres) → sync din admin
 * 3. Altfel `.env.local`: `CATALOG_FEED_URLS` sau `TWO_PERFORMANT_FEED_URL` (virgulă + trim)
 *
 * Gestionare feed-uri: `/admin/feeds`
 */
import { config } from "dotenv";
import { resolve } from "node:path";

import { countFeedConfigs, listActiveFeedConfigs } from "../src/lib/feedConfigsDb";
import { streamFeedFromFeedConfig } from "../src/ingestion/catalog/sync-feed-from-config";
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
          `[catalog:stream] Sursă: public.feed_configs (Postgres) | ${active.length} feed(uri) active`
        );
      const totals = {
        totalEssentialMatched: 0,
        afterFilterWritten: 0,
        skippedByFilter: 0,
      };
      let index = 0;
      for (const row of active) {
        index += 1;
        const hostname = feedHostname(row.url);
        console.log(
          `--- START IMPORT: ${hostname} --- (${index} din ${active.length}) [feed_id=${row.id} name=${row.name}] [provider=${row.provider_id}]`
        );
        const r = await streamFeedFromFeedConfig(row);
        totals.totalEssentialMatched += r.totalEssentialMatched;
        totals.afterFilterWritten += r.afterFilterWritten;
        totals.skippedByFilter += r.skippedByFilter;
        console.log(
          `  → esențiale: ${r.totalEssentialMatched}, în DB după filtru: ${r.afterFilterWritten}, sărite filtru: ${r.skippedByFilter}`
        );
        console.log(`--- FINALIZAT IMPORT: ${hostname} ---`);
      }
      console.log("[catalog:stream] Total agregat:", JSON.stringify(totals, null, 2));
      return;
    }
    console.log(
      "[catalog:stream] Există feed_configs dar niciunul activ — folosesc variabilele de mediu dacă există."
    );
  }

  const fromEnv = parseUrlsFromEnv();
  if (fromEnv.length === 0) {
    const nCfg = await countFeedConfigs();
    const nActive = nCfg > 0 ? (await listActiveFeedConfigs()).length : 0;
    const hintInactive =
      nCfg > 0 && nActive === 0
        ? "\n  • Există feed_configs dar niciunul nu e activ — bifează „Activ” sau adaugă un feed activ în `/admin/feeds`.\n"
        : "";
    console.error(
      "Lipsește sursa de feed-uri." +
        hintInactive +
        "\n  • Adaugă feed-uri active în `/admin/feeds`, sau\n" +
        "  • În `.env.local`: CATALOG_FEED_URLS=\"https://…,https://…\"\n" +
        "  • CLI: npm run catalog:stream-db -- https://a.xml https://b.xml"
    );
    process.exit(1);
  }

  await runUrlList(fromEnv, "CATALOG_FEED_URLS / TWO_PERFORMANT_FEED_URL (.env)");
}

async function runUrlList(urls: string[], source: string) {
  console.log(
    `[catalog:stream] Sursă: ${source} | ${urls.length} URL(uri) după parsare:`,
    urls.map((u) => feedHostname(u)).join(", ")
  );
  const totals = {
    totalEssentialMatched: 0,
    afterFilterWritten: 0,
    skippedByFilter: 0,
  };
  let index = 0;
  const y = urls.length;
  for (const url of urls) {
    index += 1;
    const hostname = feedHostname(url);
    const provider = resolveFeedProvider(url);
    console.log(`--- START IMPORT: ${hostname} --- (${index} din ${y}) [provider=${provider.providerId}]`);
    const r = await provider.sync(url, undefined);
    totals.totalEssentialMatched += r.totalEssentialMatched;
    totals.afterFilterWritten += r.afterFilterWritten;
    totals.skippedByFilter += r.skippedByFilter;
    console.log(
      `  → esențiale: ${r.totalEssentialMatched}, în DB după filtru: ${r.afterFilterWritten}, sărite filtru: ${r.skippedByFilter}`
    );
    console.log(`--- FINALIZAT IMPORT: ${hostname} ---`);
  }
  console.log("[catalog:stream] Total agregat:", JSON.stringify(totals, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

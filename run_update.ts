/**
 * Script de test / actualizare: streaming SAX → `data/produse_esentiale.json`.
 *
 * Rulează: `npx tsx run_update.ts` sau `npm run catalog:update`
 * Pentru rulare din CLI folosește **tsx** (rezolvă ESM + TypeScript + căi). `ts-node` simplu poate eșua pe importuri fără extensie.
 * Opțional: `npx tsx run_update.ts https://feed-ul-tau.xml` (suprascrie feedUrl)
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { essentialsJsonAbsolutePath } from "./src/ingestion/catalog/json-catalog-reader";
import { streamFeedToEssentialsFile } from "./src/ingestion/xml/twoPerformantXmlStream";

const root = process.cwd();
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });

/** Fallback dacă nu există argument CLI și nici TWO_PERFORMANT_FEED_URL în mediu (după dotenv). */
const DEFAULT_FEED_URL = "https://YOUR-2PERFORMANT-FEED.xml";

function resolveFeedUrl(): string {
  const fromArg = process.argv[2]?.trim();
  if (fromArg) return fromArg;
  const fromEnv = process.env.TWO_PERFORMANT_FEED_URL?.trim();
  if (fromEnv) return fromEnv;
  return DEFAULT_FEED_URL;
}

/** Doar URL-ul generic nesetat — nu compara cu URL-ul real din DEFAULT, altfel respinge mereu același link. */
function isUnsetFeedUrl(url: string): boolean {
  const u = url.trim();
  if (!u) return true;
  return u.includes("YOUR-2PERFORMANT");
}

function formatNetworkError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.message];
  const cause = err.cause;
  if (cause instanceof Error) parts.push(`Cauză: ${cause.message}`);
  const anyErr = err as NodeJS.ErrnoException;
  if (anyErr.code) parts.push(`Cod: ${anyErr.code}`);
  return parts.join(" | ");
}

async function main() {
  const feedUrl = resolveFeedUrl();
  if (isUnsetFeedUrl(feedUrl)) {
    console.error(
      "[run_update] Lipsește URL-ul feed-ului 2Performant.\n" +
        "  → setează TWO_PERFORMANT_FEED_URL în .env.local (lângă acest proiect), sau\n" +
        "  → înlocuiește DEFAULT_FEED_URL din run_update.ts cu feed-ul tău, sau\n" +
        "  → rulează: npx tsx run_update.ts https://...feed.xml"
    );
    process.exit(1);
  }

  const outPath = essentialsJsonAbsolutePath();

  console.log("[run_update] — Început — descărcare feed + parsare stream (SAX)…");
  console.log("[run_update] URL:", feedUrl);
  console.log("[run_update] Fișier țintă:", outPath);

  const t0 = Date.now();

  try {
    const { totalMatched, returnListTruncated, products } = await streamFeedToEssentialsFile(
      feedUrl,
      undefined,
      outPath
    );

    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[run_update] — Produse găsite (comision > 5%, în stoc): ${totalMatched}`);
    if (returnListTruncated) {
      console.log(
        `[run_update] Notă: lista returnată în memorie e trunchiată (${products.length} rânduri); fișierul JSON conține toate produsele scrise incremental.`
      );
    }
    console.log(`[run_update] — Terminat — fișierul a fost scris: ${outPath} (${sec}s)`);
  } catch (err) {
    console.error("[run_update] — Eroare —");
    console.error(formatNetworkError(err));
    if (err instanceof TypeError && /fetch|network|Failed to fetch/i.test(String(err.message))) {
      console.error(
        "[run_update] Sfat: verifică conexiunea la internet, URL-ul feed-ului și firewall-ul / proxy-ul."
      );
    }
    if (err instanceof Error && /HTTP \d+/.test(err.message)) {
      console.error("[run_update] Sfat: feed-ul poate fi indisponibil sau URL-ul poate fi greșit (403/404/500).");
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[run_update] Eroare neașteptată:", formatNetworkError(err));
  process.exit(1);
});

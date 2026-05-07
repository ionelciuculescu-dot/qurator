/**
 * Rulează: npm run feed:fetch
 * sau: npm run feed:fetch -- https://exemplu.ro/feed.xml
 *
 * URL implicit: TWO_PERFORMANT_FEED_URL din .env.local
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { fetchAndParseProductFeed } from "../src/ingestion/xml/twoPerformantXml";

config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const url = process.argv[2] ?? process.env.TWO_PERFORMANT_FEED_URL;
  if (!url) {
    console.error(
      "Lipsește URL-ul feed-ului. Setează TWO_PERFORMANT_FEED_URL în .env.local sau transmite URL-ul ca argument."
    );
    process.exit(1);
  }

  const products = await fetchAndParseProductFeed(url);
  console.log(JSON.stringify(products, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

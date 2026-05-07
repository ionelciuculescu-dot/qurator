import { JsonCatalogReader } from "@/ingestion/catalog/json-catalog-reader";
import { STORE_FEED_AI_LIMIT, type ParsedProduct } from "@/ingestion/xml/twoPerformantXml";
import { essentialsToParsedProducts, streamFeedToEssentialsFile } from "@/ingestion/xml/twoPerformantXmlStream";
import { productMatchesKeywordQuery } from "@/shared/lib/product-query";

/**
 * Înlocuiește cu URL-ul feed-ului XML 2Performant sau setează `TWO_PERFORMANT_FEED_URL` în `.env.local`.
 * Folosit doar dacă nu transmiți `url` la `fetchFeed`.
 */
export const FEED_URL_PLACEHOLDER = "https://YOUR-2PERFORMANT-FEED-URL.xml";

export type FetchFeedResult = {
  /**
   * Nu mai încărcăm tot XML-ul: rămâne un marcaj pentru compatibilitate.
   * Lista completă filtrată (comision &gt; 5%, stoc) e în `data/produse_esentiale.json`.
   */
  document: unknown;
  /** Produse mapate pentru trimitere ulterioară la DeepSeek (`/api/chat`). */
  products: ParsedProduct[];
};

/**
 * Descarcă feed-ul ca ReadableStream + sax (fără `res.text()`), scrie `data/produse_esentiale.json`
 * incremental, cu produse comision &gt; 5% și în stoc; întoarce lista mapată pentru DeepSeek.
 * Plafon memorie: câmpuri text tăiate în parser; lista returnată max. 200k rânduri (vezi `returnListTruncated`).
 *
 * @param url — feed XML; implicit `TWO_PERFORMANT_FEED_URL` din mediu, altfel `FEED_URL_PLACEHOLDER` (trebuie înlocuit).
 * @param query — dacă e nevid, păstrează doar produsele la care fiecare cuvânt din query apare în titlu (descrierea e goală la essentials).
 */
export async function fetchFeed(
  url?: string,
  init?: RequestInit,
  query?: string
): Promise<FetchFeedResult> {
  const resolved =
    url?.trim() ||
    process.env.TWO_PERFORMANT_FEED_URL?.trim() ||
    (FEED_URL_PLACEHOLDER.includes("YOUR-2PERFORMANT") ? "" : FEED_URL_PLACEHOLDER);

  if (!resolved) {
    throw new Error(
      "Lipsește URL-ul feed-ului: pune linkul în FEED_URL_PLACEHOLDER din fetchFeed.ts, setează TWO_PERFORMANT_FEED_URL în .env.local sau apelează fetchFeed(\"https://...\")."
    );
  }

  const { products: essentials, totalMatched, returnListTruncated } = await streamFeedToEssentialsFile(
    resolved,
    init
  );
  const reader = new JsonCatalogReader();
  let allProducts = await reader.listProducts();
  if (allProducts.length === 0 && essentials.length > 0) {
    allProducts = essentialsToParsedProducts(essentials);
  }
  const q = query?.trim();
  const filtered =
    q && q.length > 0 ? allProducts.filter((p) => productMatchesKeywordQuery(p, q)) : allProducts;
  const products = filtered.slice(0, STORE_FEED_AI_LIMIT);

  if (products.length > 0) {
    console.log("[fetchFeed] products[0]:", JSON.stringify(products[0], null, 2));
  } else {
    console.log("[fetchFeed] products: [] (niciun produs după filtrare)");
  }

  const document = {
    feedStreamed: true,
    essentialsCount: totalMatched,
    essentialsFile: "data/produse_esentiale.json",
    returnListTruncated,
  };

  return { document, products };
}

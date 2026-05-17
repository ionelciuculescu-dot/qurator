import { XMLParser } from "fast-xml-parser";

import type { ParsedProduct, StreamEssentialsResult } from "@/shared/models/product";
import { MAX_PRODUCTS, STORE_FEED_AI_LIMIT } from "@/shared/constants/limits";
import { firstImageUrlFromField } from "@/shared/lib/product-image-url";

export type { ParsedProduct, StreamEssentialsResult } from "@/shared/models/product";
export { STORE_FEED_AI_LIMIT } from "@/shared/constants/limits";

function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Extrage text din noduri simple, CDATA sau obiecte {#text}. */
export function xmlNodeToString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return value.map(xmlNodeToString).filter(Boolean).join(" ");
  }
  if (isRecord(value)) {
    if ("#text" in value) return xmlNodeToString(value["#text"]);
    const keys = Object.keys(value).filter((k) => !k.startsWith("@_"));
    if (keys.length === 1) return xmlNodeToString(value[keys[0]!]);
  }
  return "";
}

function pickFirst(obj: Record<string, unknown>, candidates: string[]): unknown {
  for (const cand of candidates) {
    if (Object.prototype.hasOwnProperty.call(obj, cand) && obj[cand] !== undefined) {
      return obj[cand];
    }
  }
  const keys = Object.keys(obj);
  for (const cand of candidates) {
    const candLc = cand.toLowerCase();
    const candTail = cand.includes(":") ? cand.split(":").pop()!.toLowerCase() : candLc;
    for (const k of keys) {
      if (k.toLowerCase() === candLc) return obj[k];
      if (k.includes(":") && k.split(":").pop()!.toLowerCase() === candTail) return obj[k];
    }
  }
  return undefined;
}

/** Primul string nevid din candidați (evită `<url></url>` care blochează `<link>`). */
function firstNonemptyTextFromCandidates(item: Record<string, unknown>, candidates: string[]): string {
  for (const cand of candidates) {
    const v = pickFirst(item, [cand]);
    const s = xmlNodeToString(v);
    if (s.length > 0) return s;
  }
  return "";
}

/**
 * Convertește valoarea tag-ului &lt;url&gt; / link într-un string URL (inclusiv tablouri, CDATA, href).
 */
function affiliateUrlToString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    for (const el of value) {
      const s = affiliateUrlToString(el);
      if (s) return s;
    }
    return "";
  }
  if (isRecord(value)) {
    if (typeof value["@_href"] === "string" && value["@_href"].trim()) {
      return value["@_href"].trim();
    }
    if ("#text" in value) return affiliateUrlToString(value["#text"]);
    const keys = Object.keys(value).filter((k) => !k.startsWith("@_"));
    if (keys.length === 1) return affiliateUrlToString(value[keys[0]!]);
  }
  return "";
}

function affiliateLinkFromAttributes(item: Record<string, unknown>): string {
  const direct = item["@_url"] ?? item["@_href"];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  return "";
}

function firstAffiliateUrlFromCandidates(item: Record<string, unknown>, candidates: string[]): string {
  for (const cand of candidates) {
    const raw = pickFirst(item, [cand]);
    const s = affiliateUrlToString(raw);
    if (s.length > 0) return s;
  }
  return "";
}

/** 2Performant: &lt;aff_code&gt; → `item.aff_code` în JSON (link / cod de afiliat). */
function affiliateLinkFromAffCodeField(item: Record<string, unknown>): string {
  const direct = item["aff_code"] ?? item["Aff_code"] ?? item["AFF_CODE"];
  let out = affiliateUrlToString(direct);
  if (!out) out = xmlNodeToString(direct);
  if (out) return out;

  for (const key of Object.keys(item)) {
    if (key.startsWith("@_")) continue;
    const kl = key.toLowerCase();
    if (kl === "aff_code" || kl.endsWith(":aff_code")) {
      out = affiliateUrlToString(item[key]) || xmlNodeToString(item[key]);
      if (out) return out;
    }
  }

  const nestedKeys = [
    "product",
    "Product",
    "item",
    "Item",
    "row",
    "Row",
    "offer",
    "Offer",
    "entry",
    "Entry",
  ];
  for (const key of nestedKeys) {
    const val = item[key];
    if (!isRecord(val)) continue;
    if ("aff_code" in val || "Aff_code" in val) {
      const raw = val["aff_code"] ?? val["Aff_code"];
      out = affiliateUrlToString(raw) || xmlNodeToString(raw);
      if (out) return out;
    }
  }

  return "";
}

/**
 * 2Performant: link în &lt;url&gt; → `item.url` (fallback după aff_code).
 * Citește explicit această proprietate (plus namespace / copil cu `url`).
 */
function affiliateLinkFromItemUrlField(item: Record<string, unknown>): string {
  const direct =
    item["url"] ??
    item["Url"] ??
    item["URL"];
  let out = affiliateUrlToString(direct);
  if (out) return out;

  for (const key of Object.keys(item)) {
    if (key.startsWith("@_")) continue;
    const kl = key.toLowerCase();
    if (kl === "url" || kl.endsWith(":url")) {
      out = affiliateUrlToString(item[key]);
      if (out) return out;
    }
  }

  const nestedKeys = [
    "product",
    "Product",
    "item",
    "Item",
    "row",
    "Row",
    "offer",
    "Offer",
    "entry",
    "Entry",
  ];
  for (const key of nestedKeys) {
    const val = item[key];
    if (!isRecord(val)) continue;
    if ("url" in val || "Url" in val) {
      out = affiliateUrlToString(val["url"] ?? val["Url"]);
      if (out) return out;
    }
  }

  return "";
}

/** Dacă produsul e împachetat într-un singur copil (ex. &lt;product&gt;&lt;row&gt;...&lt;/row&gt;), folosește interiorul. */
function unwrapInnerProductNode(item: Record<string, unknown>): Record<string, unknown> {
  const dataKeys = Object.keys(item).filter((k) => !k.startsWith("@_"));
  if (dataKeys.length !== 1) return item;
  const inner = item[dataKeys[0]!];
  if (!isRecord(inner)) return item;
  const hasShape =
    pickFirst(inner, [
      "aff_code",
      "Aff_code",
      "url",
      "URL",
      "Url",
      "name",
      "Name",
      "title",
      "Title",
      "product_url",
    ]) !== undefined;
  if (hasShape) {
    return { ...item, ...inner };
  }
  return item;
}

function enclosureImage(item: Record<string, unknown>): string {
  const enc = item.enclosure;
  for (const e of ensureArray(enc)) {
    if (!isRecord(e)) continue;
    const url = e["@_url"];
    if (typeof url === "string" && /^https?:\/\//i.test(url)) return url.trim();
  }
  return "";
}

function mediaContentImage(item: Record<string, unknown>): string {
  const mc = item["media:content"] ?? item["media:thumbnail"];
  for (const node of ensureArray(mc)) {
    if (!isRecord(node)) continue;
    const url = node["@_url"];
    if (typeof url === "string" && url.trim()) return url.trim();
  }
  return "";
}

function additionalImagesLink(item: Record<string, unknown>): string {
  const add = item["g:additional_image_link"] ?? item.additional_image_link;
  const s = xmlNodeToString(add);
  if (s) {
    const first = s.split(/[|,]/)[0]?.trim();
    if (first) return first;
  }
  return "";
}

/** Feed 2Performant: &lt;image_urls&gt; (și `images`) — mai multe URL-uri separate prin virgulă / spațiu / rând nou. */
function firstImageFromImagesField(item: Record<string, unknown>): string {
  const direct =
    item["image_urls"] ??
    item["Image_urls"] ??
    item["ImageUrls"] ??
    item["imageUrls"];
  let raw = xmlNodeToString(direct);
  if (!raw) {
    raw = xmlNodeToString(
      pickFirst(item, ["image_urls", "Image_urls", "ImageUrls", "images", "Images", "imageurls"])
    );
  }
  if (!raw) return "";
  return firstImageUrlFromField(raw);
}

/**
 * Mapare orientată spre feed-urile XML 2Performant / comercianți:
 * - nume produs: adesea &lt;name&gt; sau &lt;title&gt;
 * - link afiliat: &lt;aff_code&gt; → `affiliateLink` (fallback: &lt;url&gt;, product_url, …)
 * - preț: &lt;sale_price&gt;, &lt;price&gt;, etc.
 * - imagini: &lt;image_urls&gt; (prioritar), apoi &lt;images&gt;, etc.
 */
function mapItemToProduct(item: Record<string, unknown>): ParsedProduct {
  const node = unwrapInnerProductNode(item);

  const title = firstNonemptyTextFromCandidates(node, [
    "name",
    "Name",
    "title",
    "Title",
    "product_name",
    "ProductName",
    "g:title",
    "productname",
  ]);

  const price = firstNonemptyTextFromCandidates(node, [
    "sale_price",
    "SalePrice",
    "price",
    "Price",
    "current_price",
    "regular_price",
    "old_price",
    "g:price",
  ]);

  // 2Performant: `affiliateLink` ← `item.aff_code` (&lt;aff_code&gt;).
  let affiliateLink = affiliateLinkFromAffCodeField(node);
  if (!affiliateLink) {
    affiliateLink = affiliateLinkFromItemUrlField(node);
  }
  if (!affiliateLink) {
    affiliateLink = firstAffiliateUrlFromCandidates(node, [
      "product_url",
      "ProductURL",
      "affiliate_url",
      "deeplink",
      "Deeplink",
      "link",
      "Link",
      "g:link",
    ]);
  }
  if (!affiliateLink) {
    affiliateLink = affiliateLinkFromAttributes(node);
  }
  if (!affiliateLink) {
    const guid = node.guid;
    if (isRecord(guid) && typeof guid["@_isPermaLink"] === "string") {
      affiliateLink = affiliateUrlToString(guid["#text"] ?? guid);
    } else {
      affiliateLink = affiliateUrlToString(guid);
    }
  }

  let image = firstImageFromImagesField(node);
  if (!image) {
    image = firstNonemptyTextFromCandidates(node, [
      "image_link",
      "g:image_link",
      "image",
      "Image",
      "image_url",
      "img",
      "thumbnail",
      "picture",
      "big_image",
      "small_image",
    ]);
  }
  if (!image) image = enclosureImage(node);
  if (!image) image = mediaContentImage(node);
  if (!image) image = additionalImagesLink(node);

  let description = firstNonemptyTextFromCandidates(node, [
    "description",
    "Description",
    "g:description",
    "short_description",
    "long_description",
    "summary",
    "content",
    "body",
  ]);
  if (!description && isRecord(node["content:encoded"])) {
    description = xmlNodeToString(node["content:encoded"]);
  }

  const category = firstNonemptyTextFromCandidates(node, [
    "category",
    "Category",
    "g:google_product_category",
    "g:product_type",
    "product_type",
    "ProductType",
    "product_category",
    "breadcrumb",
  ]);

  return {
    title,
    price,
    affiliateLink,
    image,
    description,
    ...(category ? { category } : {}),
  };
}

/**
 * Găsește lista de noduri „produs” din documentul parsat (RSS, Atom, colecții tipice).
 */
export function findProductNodes(parsed: unknown): Record<string, unknown>[] {
  if (!isRecord(parsed)) return [];

  const rss = parsed.rss;
  if (isRecord(rss)) {
    const channel = rss.channel;
    if (isRecord(channel) && channel.item !== undefined) {
      return ensureArray(channel.item).filter(isRecord);
    }
  }

  const feed = parsed.feed;
  if (isRecord(feed) && feed.entry !== undefined) {
    return ensureArray(feed.entry).filter(isRecord);
  }

  const wrapKeys = [
    "products",
    "Products",
    "catalog",
    "Catalog",
    "channel",
    "Channel",
    "store",
    "Store",
    "offers",
    "Offers",
    "data",
    "Data",
  ];
  const itemKeys = ["product", "Product", "item", "Item", "entry", "offer", "row"];
  for (const wrapKey of wrapKeys) {
    const wrap = parsed[wrapKey];
    if (!isRecord(wrap)) continue;
    for (const itemKey of itemKeys) {
      if (wrap[itemKey] !== undefined) {
        return ensureArray(wrap[itemKey]).filter(isRecord);
      }
    }
  }

  if (parsed.product !== undefined || parsed.Product !== undefined) {
    return ensureArray(parsed.product ?? parsed.Product).filter(isRecord);
  }

  if (isRecord(parsed.items) && parsed.items.item !== undefined) {
    return ensureArray(parsed.items.item).filter(isRecord);
  }

  if (parsed.item !== undefined) {
    return ensureArray(parsed.item).filter(isRecord);
  }

  return [];
}

export function createFeedParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    trimValues: true,
    isArray: (tagName) => {
      const t = tagName.toLowerCase();
      return ["item", "product", "entry", "offer", "enclosure", "url", "link", "image_urls"].includes(
        t
      );
    },
  });
}

/**
 * Parsează XML din **string** (fast-xml-parser). Potrivit doar pentru fișiere mici în memorie;
 * pentru feed-uri mari folosește `streamFeedToParsedProductsLimited` / `streamFeedToEssentialsFile`.
 */
export function parseFeedXml(xml: string, parser: XMLParser = createFeedParser()): Record<string, unknown>[] {
  const doc = parser.parse(xml) as unknown;
  return findProductNodes(doc);
}

/**
 * Descarcă XML-ul ca `ReadableStream` (fără `res.text()`); pentru parsare folosește SAX în
 * `streamFeedToEssentialsFile` / `streamFeedToParsedProductsLimited` din `twoPerformantXmlStream.ts`.
 */
export async function downloadXmlFeedAsStream(
  url: string,
  init?: RequestInit
): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/xml, text/xml, */*",
      ...(init?.headers as Record<string, string>),
    },
  });
  if (!res.ok) {
    throw new Error(`Feed HTTP ${res.status}: ${res.statusText}`);
  }
  if (!res.body) {
    throw new Error("Feed fără corp (stream indisponibil)");
  }
  return res.body;
}

/**
 * Parsează XML și extrage primele 20 de produse cu câmpurile cerute.
 */
export function parseTwoPerformantProductFeed(xml: string, limit = MAX_PRODUCTS): ParsedProduct[] {
  const items = parseFeedXml(xml);
  return items.slice(0, limit).map(mapItemToProduct);
}

/**
 * Descarcă feed-ul de la URL și returnează primele 20 de produse parsate.
 */
export async function fetchAndParseProductFeed(
  url: string,
  init?: RequestInit,
  limit = MAX_PRODUCTS
): Promise<ParsedProduct[]> {
  const { streamFeedToParsedProductsLimited } = await import("@/ingestion/xml/twoPerformantXmlStream");
  return streamFeedToParsedProductsLimited(url, init, limit);
}

export function toParsedProducts(
  items: Record<string, unknown>[],
  limit: number = STORE_FEED_AI_LIMIT
): ParsedProduct[] {
  const n = Math.max(0, limit);
  return items.slice(0, n).map(mapItemToProduct);
}

/** Mapează toate nodurile de produs din feed (fără limită), ex. înainte de filtrare după query. */
export function mapFeedItemsToProducts(items: Record<string, unknown>[]): ParsedProduct[] {
  return items.map(mapItemToProduct);
}

/**
 * Descarcă feed-ul ca stream + SAX; primele 15–20 de produse (implicit 18), fără XML întreg în RAM.
 */
export async function getStoreProducts(url: string, init?: RequestInit): Promise<ParsedProduct[]> {
  const { streamFeedToParsedProductsLimited } = await import("@/ingestion/xml/twoPerformantXmlStream");
  return streamFeedToParsedProductsLimited(url, init, STORE_FEED_AI_LIMIT);
}

/**
 * Descarcă feed-ul ca stream (sax), scrie `data/produse_esentiale.json` — fără a încărca tot XML-ul în memorie.
 * Implementare: `twoPerformantXmlStream.ts`.
 */
export async function streamFeedToEssentialsFile(
  url: string,
  init?: RequestInit,
  outPath?: string
): Promise<StreamEssentialsResult> {
  const { streamFeedToEssentialsFile: run } = await import("@/ingestion/xml/twoPerformantXmlStream");
  return run(url, init, outPath);
}

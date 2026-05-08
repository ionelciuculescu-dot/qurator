import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sax from "sax";
import { Readable, Transform } from "node:stream";
import { finished } from "node:stream/promises";

import type {
  EssentialProduct,
  EssentialAsParsedProduct,
  ParsedProduct,
  StreamEssentialsResult,
} from "@/shared/models/product";

/** Limite pentru consum de memorie sub ~100MB chiar la feed-uri foarte mari. */
const MAX_LEAF_CHARS = 65536;
const MAX_RETURN_ESSENTIALS = 200_000;
/** După atâtea produse esențiale scrise în fișier, fluxul se oprește (rename .tmp → final). */
const MAX_STREAMED_ESSENTIALS_TO_FILE = 100;
export const MAX_DESCRIPTION_OUT = 32_768;
export const MAX_IMAGE_URL = 2048;

/** Feed 2Performant / RSS: produsul este nodul `<item>` (nu `<product>`). */
const DEFAULT_ROOT_TAGS = new Set(["item"]);

export function normTag(name: string): string {
  const lower = name.toLowerCase();
  const i = lower.lastIndexOf(":");
  return i >= 0 ? lower.slice(i + 1) : lower;
}

export function cap(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function mergeAbortSignals(a: AbortSignal | null | undefined, b: AbortSignal): AbortSignal {
  if (a == null) return b;
  if (a.aborted) return a;
  if (b.aborted) return b;
  const c = new AbortController();
  const forward = (src: AbortSignal) => {
    try {
      c.abort(src.reason);
    } catch {
      c.abort();
    }
  };
  a.addEventListener("abort", () => forward(a), { once: true });
  b.addEventListener("abort", () => forward(b), { once: true });
  return c.signal;
}

function isAbortLike(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return e.name === "AbortError" || /aborted|abort/i.test(e.message);
}

export function parseCommissionPercent(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, "").replace(",", ".");
  if (!s) return null;
  const hasPct = s.includes("%");
  const m = s.match(/([\d.]+)/);
  if (!m) return null;
  let v = parseFloat(m[1]!);
  if (!Number.isFinite(v)) return null;
  if (!hasPct && v > 0 && v <= 1) v *= 100;
  return v;
}

export function parseInStock(raw: string): boolean {
  const s = raw.trim().toLowerCase();
  if (!s) return false;
  if (["1", "true", "yes", "in stock", "instock", "disponibil", "available"].includes(s)) return true;
  if (["0", "false", "no", "out of stock", "indisponibil", "unavailable", "preorder"].includes(s)) return false;
  return s.includes("stock") && !s.includes("out");
}

export function pickFirst(f: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = f[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * Extrage primul număr rezonabil din textul de preț (ex. `63.04`, `63,04 RON`, `pret: 63,04`)
 * și îl normalizează ca string cu punct zecimal (compatibil JSON / DB).
 */
export function normalizePriceFromFlat(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const compact = t.replace(/\s+/g, "");
  const m = compact.match(/-?\d{1,12}(?:[.,]\d{1,4})?/);
  if (!m) return "";
  const n = Number(m[0].replace(",", "."));
  if (!Number.isFinite(n)) return "";
  if (Math.abs(n) > 1e12) return "";
  return String(n);
}

export function flattenKeys(f: Record<string, string>): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) {
    o[normTag(k)] = v;
  }
  return o;
}

/**
 * Citește un câmp după numele local normalizat (lowercase, fără prefix namespace).
 * Mapare 1:1 cu tag-urile din feed: `title`, `description`, `price`, `aff_code`, `image_urls`.
 */
function fieldFromFlat(f: Record<string, string>, localName: string): string {
  const key = normTag(localName);
  const v = f[key];
  return typeof v === "string" ? v.trim() : "";
}

/** Prima imagine din `<image_urls>` (liste separate prin virgulă / spațiu). */
function imageUrlFromImageUrlsField(f: Record<string, string>): string {
  const raw = fieldFromFlat(f, "image_urls");
  if (!raw) return "";
  const tokens = raw
    .split(/[,;|\n\r\t\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const httpFirst = tokens.find((t) => /^https?:\/\//i.test(t));
  const u = httpFirst ?? tokens[0] ?? "";
  return cap(u, MAX_IMAGE_URL);
}

export function essentialFromFlat(flat: Record<string, string>): EssentialProduct | null {
  const f = flattenKeys(flat);

  const commissionRaw = pickFirst(f, [
    "commission_percent",
    "commission",
    "Commission",
    "comision",
    "commission_rate",
    "affiliate_commission",
    "comision_procent",
    "cpa",
    "revenue_share",
  ]);

  /** Feed-uri fără nod de comision (ex. XML produs 2Performant): asumăm eligibil; dacă e prezent și ≤5%, respingem. */
  let commissionPct: number;
  if (commissionRaw.trim() !== "") {
    const parsed = parseCommissionPercent(commissionRaw);
    if (parsed == null || parsed <= 5) return null;
    commissionPct = parsed;
  } else {
    commissionPct = 10;
  }

  const stockRaw = pickFirst(f, [
    "availability",
    "product_active",
    "stock",
    "in_stock",
    "inventory",
    "is_in_stock",
  ]);
  /** RSS `<item>` fără câmp stoc: considerăm în stoc dacă nu e explicit negativ. */
  const inStock = stockRaw.trim() === "" ? true : parseInStock(stockRaw);
  if (!inStock) return null;

  const title = fieldFromFlat(f, "title");
  const descriptionRaw = fieldFromFlat(f, "description");
  const priceRaw = fieldFromFlat(f, "price");
  const price = normalizePriceFromFlat(priceRaw) || priceRaw;
  const affiliateLink = fieldFromFlat(f, "aff_code");

  if (!title || !affiliateLink) return null;

  const image = imageUrlFromImageUrlsField(f);
  const description = descriptionRaw ? cap(descriptionRaw, MAX_DESCRIPTION_OUT) : "";

  const shippingRaw = pickFirst(f, [
    "shipping",
    "shipping_info",
    "shipping_description",
    "delivery",
    "livrare",
    "transport",
    "g:shipping",
  ]);
  const shippingNote = shippingRaw.trim() ? cap(shippingRaw.trim(), 500) : "";

  const out: EssentialProduct = {
    title,
    price,
    affiliateLink,
    commissionPct,
    inStock: true,
  };
  if (image) out.image = image;
  if (description) out.description = description;
  if (shippingNote) out.shippingNote = shippingNote;
  return out;
}

function firstImageFromFlat(f: Record<string, string>): string {
  const strict = imageUrlFromImageUrlsField(f);
  if (strict) return strict;
  const raw = pickFirst(f, ["images", "imageurls", "image_link", "g:image_link", "image", "thumbnail"]);
  if (!raw) return "";
  const tokens = raw
    .split(/[,;|\n\r\t\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const httpFirst = tokens.find((t) => /^https?:\/\//i.test(t));
  const u = httpFirst ?? tokens[0] ?? "";
  return cap(u, MAX_IMAGE_URL);
}

export function parsedProductFromFlat(flat: Record<string, string>): ParsedProduct {
  const f = flattenKeys(flat);

  const title = fieldFromFlat(f, "title") || pickFirst(f, ["name", "product_name", "productname", "g:title"]);

  const priceRaw = fieldFromFlat(f, "price") || pickFirst(f, ["sale_price", "current_price", "regular_price", "old_price", "g:price"]);
  const price = normalizePriceFromFlat(priceRaw) || priceRaw.trim();

  let affiliateLink = fieldFromFlat(f, "aff_code");
  if (!affiliateLink) affiliateLink = pickFirst(f, ["url"]);
  if (!affiliateLink) {
    affiliateLink = pickFirst(f, [
      "product_url",
      "affiliate_url",
      "deeplink",
      "link",
      "g:link",
    ]);
  }
  if (!affiliateLink) affiliateLink = pickFirst(f, ["guid"]);

  let image = imageUrlFromImageUrlsField(f);
  if (!image) {
    image = firstImageFromFlat(f);
  }
  if (!image) {
    image = cap(
      pickFirst(f, ["image_url", "img", "picture", "big_image", "small_image", "g:image_link"]),
      MAX_IMAGE_URL
    );
  }

  let description = fieldFromFlat(f, "description");
  if (!description) {
    description = pickFirst(f, [
      "g:description",
      "short_description",
      "long_description",
      "summary",
      "content",
      "body",
    ]);
  }
  description = cap(description, MAX_DESCRIPTION_OUT);

  const categoryRaw = pickFirst(f, [
    "category",
    "g:google_product_category",
    "g:product_type",
    "product_type",
    "product_category",
    "breadcrumb",
  ]);
  const category = categoryRaw ? cap(categoryRaw, 2048) : undefined;

  return {
    title,
    price,
    affiliateLink,
    image,
    description,
    ...(category ? { category } : {}),
  };
}

type SaxProductState = {
  inside: boolean;
  stack: string[];
  textBuf: string;
  flat: Record<string, string>;
};

export type CreateProductFeedSaxStreamOpts = {
  /** Apelat când `_parser.onend` — documentul XML s-a terminat natural (înainte de `]}` pe disc, care vine după coada de scrieri). */
  onParserEnd?: () => void;
  /** Rădăcina nodului produs (implicit `<item>`). */
  rootTags?: Set<string>;
};

export function createProductFeedSaxStream(
  onProductRootClose: (flat: Record<string, string>) => void,
  opts?: CreateProductFeedSaxStreamOpts
): sax.SAXStream {
  const rootTags = opts?.rootTags ?? DEFAULT_ROOT_TAGS;
  const saxStream = sax.createStream(false, { trim: true });

  saxStream.on("error", (err: Error) => {
    console.error("[createProductFeedSaxStream] saxStream.on('error'):", err?.stack ?? err?.message ?? err);
  });

  type SaxParserLike = {
    onerror?: ((e: unknown) => void) | null;
    onend?: (() => void) | null;
  };
  const saxParser = (saxStream as unknown as { _parser?: SaxParserLike })._parser;
  if (saxParser) {
    const prevOnError = saxParser.onerror;
    saxParser.onerror = (e: unknown) => {
      console.error("[createProductFeedSaxStream] parser.onerror:", e);
      if (typeof prevOnError === "function") {
        try {
          prevOnError.call(saxParser, e);
        } catch (chainErr) {
          console.error("[createProductFeedSaxStream] parser.onerror (handler anterior):", chainErr);
        }
      }
    };

    const prevOnEnd = saxParser.onend;
    saxParser.onend = function (this: unknown) {
      console.log(
        "[createProductFeedSaxStream] parser.onend — parsarea XML s-a încheiat; `]}` se scrie după golirea cozii write (writeQueue), nu în acest handler."
      );
      try {
        opts?.onParserEnd?.();
      } catch (hookErr) {
        console.error("[createProductFeedSaxStream] onParserEnd:", hookErr);
      }
      if (typeof prevOnEnd === "function") {
        try {
          prevOnEnd.call(this);
        } catch (endErr) {
          console.error("[createProductFeedSaxStream] parser.onend (handler anterior):", endErr);
        }
      }
    };
  }

  const state: SaxProductState = {
    inside: false,
    stack: [],
    textBuf: "",
    flat: {},
  };

  const resetFlat = () => {
    for (const k of Object.keys(state.flat)) delete state.flat[k];
  };

  saxStream.on("opentag", (node: { name: string; attributes: Record<string, string> }) => {
    const name = normTag(node.name);
    console.log(`[SAX opentag] tag brut="${node.name}" → normalizat="${name}"`);
    if (!state.inside) {
      if (rootTags.has(name)) {
        state.inside = true;
        state.stack.length = 0;
        state.stack.push(name);
        resetFlat();
        for (const [ak, av] of Object.entries(node.attributes || {})) {
          if (av != null && String(av).trim()) {
            state.flat[normTag(ak)] = cap(String(av).trim(), MAX_LEAF_CHARS);
          }
        }
      }
      return;
    }
    state.stack.push(name);
    state.textBuf = "";
  });

  const appendText = (t: string) => {
    if (state.inside) state.textBuf += t;
  };
  saxStream.on("text", appendText);
  saxStream.on("cdata", appendText);

  saxStream.on("closetag", (name: string) => {
    const n = normTag(name);
    if (!state.inside) return;

    if (state.stack.length === 1 && state.stack[0] === n) {
      const snapshot = { ...state.flat };
      onProductRootClose(snapshot);
      state.inside = false;
      state.stack.length = 0;
      state.textBuf = "";
      resetFlat();
      return;
    }

    if (state.stack.length > 1 && state.stack[state.stack.length - 1] === n) {
      const merged = cap(((state.flat[n] ?? "") + state.textBuf).trim(), MAX_LEAF_CHARS);
      state.flat[n] = merged;
      state.textBuf = "";
      state.stack.pop();
    }
  });

  return saxStream;
}

export async function fetchFeedResponse(url: string, init: RequestInit | undefined): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/xml, text/xml, */*",
      ...(init?.headers as Record<string, string>),
    },
  });
}

export function webBodyToNodeReadable(res: Response): Readable {
  if (!res.body) throw new Error("Feed fără corp (stream indisponibil)");
  return Readable.fromWeb(res.body as unknown as import("stream/web").ReadableStream);
}

/** Loghează primele `maxChars` caractere UTF-8 din flux, apoi lasă datele nemodificate (înainte de SAX). */
function createXmlHeadDebugTap(maxChars: number): Transform {
  let acc = "";
  let logged = false;
  const logPrefix = (label: string, text: string) => {
    console.log(`[streamFeedToEssentialsFile] ${label}\n${text}`);
  };
  return new Transform({
    transform(chunk: Buffer | string, _enc, callback) {
      if (!logged && chunk != null) {
        const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
        if (buf.length > 0) {
          acc += buf.toString("utf8");
          if (acc.length >= maxChars) {
            logged = true;
            logPrefix(
              `Primele ${maxChars} caractere din XML-ul descărcat (înainte de parsare):`,
              acc.slice(0, maxChars)
            );
          }
        }
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (!logged && acc.length > 0) {
        logged = true;
        logPrefix(
          `XML descărcat s-a încheiat înainte de ${maxChars} caractere (total ${acc.length}); conținut integral citit:`,
          acc
        );
      }
      callback();
    },
  });
}

/** Închide writable-ul și așteaptă `close` (descriptor fișier eliberat) înainte de rename. */
function endWriteStreamAndWaitClose(ws: WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.destroyed) {
      resolve();
      return;
    }
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      ws.off("close", onClose);
      ws.off("error", onError);
      fn();
    };
    const onClose = () => settle(() => resolve());
    const onError = (err: Error) => settle(() => reject(err));
    ws.once("close", onClose);
    ws.once("error", onError);
    ws.end((err?: Error | null) => {
      if (err) settle(() => reject(err));
    });
  });
}

/**
 * `writeStream.write` cu callback Node + backpressure (`drain` când returnează false).
 * Log înainte de scriere ca să se vadă exact payload-ul JSON trimis pe disc.
 */
async function writeWithBackpressure(ws: WriteStream, chunk: string): Promise<void> {
  if (ws.destroyed) throw new Error("Writable distrus înainte de scriere");

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      ws.off("drain", onDrain);
      ws.off("error", onError);
      fn();
    };
    const onError = (err: Error) => settle(() => reject(err));
    const onDrain = () => settle(() => resolve());
    ws.once("error", onError);

    console.log("[streamFeedToEssentialsFile] writeStream.write:", chunk);
    const ok = ws.write(chunk, "utf8", (err) => {
      if (err) return settle(() => reject(err));
      if (ok) settle(() => resolve());
      else ws.once("drain", onDrain);
    });
  });
}

const DEFAULT_OUT = path.join(process.cwd(), "data", "produse_esentiale.json");

/**
 * ReadableStream (fetch body) → sax, element cu element; scriere JSON incrementală.
 * Fără `res.text()` / XML întreg în memorie.
 */
export async function streamFeedToEssentialsFile(
  url: string,
  init: RequestInit | undefined,
  outPath: string = DEFAULT_OUT
): Promise<StreamEssentialsResult> {
  const essentials: EssentialProduct[] = [];
  let totalMatched = 0;
  let returnListTruncated = false;

  await mkdir(path.dirname(outPath), { recursive: true });

  const tmpPath = `${outPath}.tmp`;
  await unlink(tmpPath).catch(() => {});

  const res = await fetchFeedResponse(url, init);
  if (!res.ok) {
    const errBody = JSON.stringify({
      updatedAt: new Date().toISOString(),
      sourceUrl: url,
      products: [],
      feedError: `HTTP ${res.status} ${res.statusText}`,
    });
    await writeFile(tmpPath, errBody, "utf8");
    try {
      await rename(tmpPath, outPath);
    } catch (renameErr) {
      await unlink(tmpPath).catch(() => {});
      console.error(
        "[streamFeedToEssentialsFile] Nu pot înlocui catalogul (fișier deschis exclusiv în editor?). Închide produse_esentiale.json și reîncearcă.",
        renameErr
      );
      throw renameErr;
    }
    throw new Error(`Feed HTTP ${res.status}: ${res.statusText}`);
  }

  const ws = createWriteStream(tmpPath, { encoding: "utf8" });
  let firstProduct = true;
  let jsonFooterWritten = false;
  let count = 0;
  let stoppedByProductLimit = false;

  /** Scrieri produs din SAX (sincron); serializăm pe disc ca să nu se amestece chunk-urile. */
  let writeQueue: Promise<void> = Promise.resolve();
  const enqueueProductChunk = (chunk: string) => {
    writeQueue = writeQueue.then(() => writeWithBackpressure(ws, chunk));
  };

  const writeJsonFooterAsync = async () => {
    if (jsonFooterWritten) return;
    if (ws.destroyed || ws.writableEnded) {
      jsonFooterWritten = true;
      return;
    }
    try {
      await writeWithBackpressure(ws, "]}");
      jsonFooterWritten = true;
    } catch (footerErr) {
      console.error("[streamFeedToEssentialsFile] scriere footer ]}:", footerErr);
      throw footerErr;
    }
  };

  const header = `{"updatedAt":${JSON.stringify(new Date().toISOString())},"sourceUrl":${JSON.stringify(url)},"products":[`;

  const nodeBody = webBodyToNodeReadable(res);
  const xmlHeadTap = createXmlHeadDebugTap(500);
  let saxStream: sax.SAXStream;

  const stopAfter100Products = () => {
    if (stoppedByProductLimit) return;
    stoppedByProductLimit = true;
    try {
      xmlHeadTap.unpipe(saxStream);
    } catch {
      /* */
    }
    try {
      nodeBody.unpipe(xmlHeadTap);
    } catch {
      /* */
    }
    try {
      nodeBody.destroy();
    } catch {
      /* */
    }
    try {
      xmlHeadTap.destroy();
    } catch {
      /* */
    }
    try {
      const parser = (saxStream as unknown as { _parser?: { close?: () => void } })._parser;
      if (parser && typeof parser.close === "function") {
        parser.close();
      } else {
        saxStream.end();
      }
    } catch {
      /* */
    }
  };

  saxStream = createProductFeedSaxStream(
    (flat) => {
      const row = essentialFromFlat(flat);
      if (!row) return;
      totalMatched += 1;
      if (essentials.length < MAX_RETURN_ESSENTIALS) {
        essentials.push(row);
      } else {
        returnListTruncated = true;
      }

      const json = JSON.stringify(row);
      const chunk = (firstProduct ? "" : ",") + json;
      firstProduct = false;
      enqueueProductChunk(chunk);
      count += 1;
      if (count >= MAX_STREAMED_ESSENTIALS_TO_FILE) {
        setImmediate(stopAfter100Products);
      }
    },
    {
      onParserEnd: () => {
        console.log(
          "[streamFeedToEssentialsFile] parser.onend — urmează în finally: drain writeQueue → `]}` → writeStream.end() → eveniment close → rename"
        );
      },
    }
  );

  saxStream.on("error", (err: Error) => {
    console.error("[streamFeedToEssentialsFile] saxStream.on('error'):", err?.stack ?? err?.message ?? err);
  });

  let saxCompleted = false;
  let pipelineError: unknown;

  try {
    await writeWithBackpressure(ws, header);
    nodeBody.pipe(xmlHeadTap).pipe(saxStream);
    try {
      await finished(saxStream);
      saxCompleted = true;
    } catch (finishedErr) {
      if (stoppedByProductLimit) {
        saxCompleted = true;
      } else {
        throw finishedErr;
      }
    }
  } catch (e) {
    pipelineError = e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[streamFeedToEssentialsFile] flux XML:", msg);
  } finally {
    try {
      await writeQueue.catch((wErr) => {
        console.error("[streamFeedToEssentialsFile] scriere produs:", wErr);
      });
    } catch {
      /* */
    }
    try {
      xmlHeadTap.unpipe(saxStream);
    } catch {
      /* deja despărțit */
    }
    try {
      nodeBody.unpipe(xmlHeadTap);
    } catch {
      /* */
    }
    try {
      nodeBody.destroy();
    } catch {
      /* */
    }
    try {
      xmlHeadTap.destroy();
    } catch {
      /* */
    }
    try {
      saxStream.destroy();
    } catch {
      /* */
    }
    try {
      if (!jsonFooterWritten) {
        await writeJsonFooterAsync();
      }
      if (!ws.destroyed) {
        await endWriteStreamAndWaitClose(ws);
      }
    } catch (closeErr) {
      console.error("[streamFeedToEssentialsFile] închidere fișier temporar (footer / end / close):", closeErr);
    }
  }

  if (saxCompleted) {
    try {
      await rename(tmpPath, outPath);
    } catch (renameErr) {
      console.error(
        "[streamFeedToEssentialsFile] rename eșuat (Windows: închide produse_esentiale.json în editor, apoi rulează din nou catalog:update):",
        renameErr
      );
      await unlink(tmpPath).catch(() => {});
      throw renameErr;
    }
  } else {
    await unlink(tmpPath).catch(() => {});
  }

  if (pipelineError) {
    throw pipelineError;
  }

  return { products: essentials, totalMatched, returnListTruncated };
}

/** Primele `limit` produse: stream + sax, oprire timpurie (abort + destroy) la limită. */
export async function streamFeedToParsedProductsLimited(
  url: string,
  init: RequestInit | undefined,
  limit: number
): Promise<ParsedProduct[]> {
  const out: ParsedProduct[] = [];
  const early = new AbortController();
  const signal = mergeAbortSignals(init?.signal, early.signal);

  const res = await fetchFeedResponse(url, { ...init, signal });
  if (!res.ok) {
    throw new Error(`Feed HTTP ${res.status}: ${res.statusText}`);
  }

  const nodeBody = webBodyToNodeReadable(res);
  const saxStream = createProductFeedSaxStream((flat) => {
    const p = parsedProductFromFlat(flat);
    if (p.title && p.affiliateLink) {
      out.push(p);
      if (out.length >= limit) {
        early.abort();
        nodeBody.destroy();
        saxStream.destroy();
      }
    }
  });

  nodeBody.pipe(saxStream);

  try {
    await finished(saxStream);
  } catch (e) {
    if (out.length >= limit && (isAbortLike(e) || early.signal.aborted)) {
      return out.slice(0, limit);
    }
    if (out.length > 0 && (isAbortLike(e) || early.signal.aborted)) {
      return out.slice(0, limit);
    }
    throw e;
  }

  return out.slice(0, limit);
}

export function essentialsToParsedProducts(items: EssentialProduct[]): EssentialAsParsedProduct[] {
  return items.map((e) => ({
    title: e.title,
    price: e.price,
    affiliateLink: e.affiliateLink,
    image: e.image ?? "",
    description: e.description ?? "",
  }));
}

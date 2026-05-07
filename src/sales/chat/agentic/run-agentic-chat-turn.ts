import { PostgresCatalogReader } from "@/sales/adapters/postgres-catalog-reader";
import type { CatalogReader } from "@/shared/ports/catalog-reader";
import type { ParsedProduct } from "@/shared/models/product";

import type {
  ChatHistoryTurn,
  ChatProductCard,
  ChatRequestBody,
  ChatSuccessPayload,
  HandleChatOptions,
} from "../types";
import { CATALOG_STALE_MESSAGE } from "../types";
import {
  AGENTIC_SYSTEM_PROMPT,
  DEEPSEEK_CHAT_COMPLETIONS_URL,
  DEEPSEEK_MODEL,
  SEARCH_STOCK_TOOL,
  VITRINA_UNIFIED_USER_TAG,
} from "./agent-config";
import { cleanParsedProductForLLM } from "@/sales/lib/cleanProductForLLM";
import { embedPlainProdusRefsWithClickThrough } from "@/sales/lib/clickThroughLinks";
import { assignUniqueProductShortIds } from "@/sales/lib/productShortId";
import { executeSearchStockTool } from "./execute-search-stock-tool";

const MAX_TOOL_ROUNDS = 8;
/** Mesaje user+assistant trimise înapoi la model (fără system / fără mesajul curent). */
const MAX_HISTORY_MESSAGES = 24;
const MAX_HISTORY_CHARS_PER_MESSAGE = 12_000;

function parseHistoryFromBody(raw: unknown): ChatHistoryTurn[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ChatHistoryTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const role = o.role;
    const content = o.content;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string" || !content.trim()) continue;
    const trimmed = content.trim();
    out.push({
      role,
      content:
        trimmed.length > MAX_HISTORY_CHARS_PER_MESSAGE
          ? `${trimmed.slice(0, MAX_HISTORY_CHARS_PER_MESSAGE)}…`
          : trimmed,
    });
  }
  return out.length > 0 ? out : undefined;
}

function tailHistory(turns: ChatHistoryTurn[]): ChatHistoryTurn[] {
  if (turns.length <= MAX_HISTORY_MESSAGES) return turns;
  return turns.slice(-MAX_HISTORY_MESSAGES);
}

type DsToolCall = {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
};

type DsMessage = {
  role: string;
  content: string | null;
  tool_calls?: DsToolCall[];
};

function parseChatBody(body: unknown): ChatRequestBody | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const message = o.message;
  const query = o.query;
  const priorRaw = o.priorMessageCount;
  if (typeof message !== "string" || !message.trim()) return null;
  const q = typeof query === "string" ? query.trim() : "";
  let priorMessageCount: number | undefined;
  if (typeof priorRaw === "number" && Number.isFinite(priorRaw) && priorRaw >= 0) {
    priorMessageCount = Math.min(Math.floor(priorRaw), 500);
  }
  let sessionId: string | undefined;
  const sid = o.sessionId;
  if (typeof sid === "string") {
    const t = sid.trim();
    if (/^[a-zA-Z0-9_-]{8,128}$/.test(t)) sessionId = t;
  }
  const history = parseHistoryFromBody(o.history);
  return {
    message: message.trim(),
    ...(q ? { query: q } : {}),
    ...(history ? { history: tailHistory(history) } : {}),
    ...(priorMessageCount !== undefined ? { priorMessageCount } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

function toChatProductCards(products: ParsedProduct[], shortIds: string[]): ChatProductCard[] {
  return products.map((p, i) => ({
    title: (p.title ?? "").trim(),
    imageUrl: (p.image ?? "").trim(),
    price: (p.price ?? "").trim(),
    currency: "RON",
    affiliateUrl: (p.affiliateLink ?? "").trim(),
    productShortId: shortIds[i] ?? "000000",
    ...((p.description ?? "").trim() ? { description: (p.description ?? "").trim() } : {}),
  }));
}

function shortIdsForProductList(products: ParsedProduct[]): string[] {
  return assignUniqueProductShortIds(
    products.map((p) => ({
      title: (p.title ?? "").trim(),
      affiliateUrl: (p.affiliateLink ?? "").trim(),
    }))
  ).map((r) => r.productShortId);
}

/** Titlu normalizat pentru deduplicare (fără ID în `ParsedProduct` — folosim și link afiliat ca „ID”). */
function normalizedProductTitleKey(p: ParsedProduct): string {
  return (p.title ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function affiliateLinkKey(p: ParsedProduct): string {
  return (p.affiliateLink ?? "").trim();
}

/**
 * Adaugă la `accum` produsele din `incoming` păstrând ordinea, fără duplicate:
 * același `affiliateLink` nevid sau același titlu normalizat nevid.
 */
function appendUniqueProducts(accum: ParsedProduct[], incoming: ParsedProduct[]): void {
  const seenLinks = new Set<string>();
  const seenTitles = new Set<string>();
  for (const p of accum) {
    const lk = affiliateLinkKey(p);
    if (lk) seenLinks.add(lk);
    const tk = normalizedProductTitleKey(p);
    if (tk) seenTitles.add(tk);
  }
  for (const p of incoming) {
    const lk = affiliateLinkKey(p);
    const tk = normalizedProductTitleKey(p);
    if (lk && seenLinks.has(lk)) continue;
    if (tk && seenTitles.has(tk)) continue;
    accum.push(p);
    if (lk) seenLinks.add(lk);
    if (tk) seenTitles.add(tk);
  }
}

/**
 * Lista canonică (deduplicată deja în `latestProducts`) injectată înainte ca modelul
 * să mai vadă un răspuns text — aceeași ordine ca `contextProducts` în API.
 */
function buildUnifiedVitrinaUserMessage(products: ParsedProduct[], shortIds: string[]): string {
  const entries = products.map((p, i) => ({
    produs_slot: i + 1,
    product_short_id: shortIds[i] ?? "",
    ...cleanParsedProductForLLM(p),
  }));
  return (
    `${VITRINA_UNIFIED_USER_TAG}\n` +
    `Acest mesaj este context tehnic (nu îl reciti utilizatorului). ` +
    `În răspunsul tău, marcajele [Produs N] trebuie să corespundă EXACT câmpului produs_slot (N = produs_slot). ` +
    `Fiecare element are product_short_id stabil (legat de DOM id=\"prod-{product_short_id}\"). ` +
    `Ordinea de mai jos este identică cu cardurile din vitrina UI.\n` +
    `produse_vitrina_canonice:${JSON.stringify(entries)}`
  );
}

/**
 * Flux chat: DeepSeek + tool `search_stock`.
 * Necesită `PostgresCatalogReader` + `DEEPSEEK_API_KEY` + `OPENAI_API_KEY` (embeddings).
 */
export async function handleChatAgenticFromParsed(
  raw: unknown,
  getCatalogReader: () => CatalogReader,
  _options?: HandleChatOptions
): Promise<Response> {
  const parsed = parseChatBody(raw);
  if (!parsed) {
    return Response.json(
      {
        error:
          "Body invalid. Aștept JSON: { message: string (nevid), query?, history?, priorMessageCount?, sessionId? }",
      },
      { status: 400 }
    );
  }

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: "DEEPSEEK_API_KEY lipsește din .env.local" }, { status: 500 });
  }

  const reader = getCatalogReader();
  if (!(reader instanceof PostgresCatalogReader)) {
    return Response.json(
      { error: "Chat-ul necesită catalog PostgreSQL cu embeddings (vector)." },
      { status: 503 }
    );
  }

  const prior = parsed.priorMessageCount ?? 0;
  const continuation =
    prior > 1
      ? "\n\n(Utilizatorul continuă conversația — nu reîncepe cu salut lung; răspunde direct.)"
      : "";

  const priorTurns: Record<string, unknown>[] = (parsed.history ?? []).map((h) => ({
    role: h.role,
    content: h.content,
  }));

  const messages: Record<string, unknown>[] = [
    { role: "system", content: AGENTIC_SYSTEM_PROMPT + continuation },
    ...priorTurns,
    { role: "user", content: parsed.message },
  ];

  let latestProducts: ParsedProduct[] = [];
  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds += 1;
    const res = await fetch(DEEPSEEK_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages,
        tools: [SEARCH_STOCK_TOOL],
        tool_choice: "auto",
      }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return Response.json(
        { error: `DeepSeek HTTP ${res.status}`, detail: t.slice(0, 500) },
        { status: 502 }
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: DsMessage }>;
      error?: { message?: string };
    };

    if (data.error?.message) {
      return Response.json({ error: data.error.message }, { status: 502 });
    }

    const msg = data.choices?.[0]?.message;
    if (!msg) {
      return Response.json({ error: "Răspuns DeepSeek invalid (fără message)." }, { status: 502 });
    }

    const toolCalls = msg.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: msg.content ?? null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      for (const tc of toolCalls) {
        if (tc.function.name === "search_stock") {
          const toolResult = await executeSearchStockTool(reader, tc.function.arguments);
          if (toolResult.ok) {
            appendUniqueProducts(latestProducts, toolResult.rawProducts ?? []);
          }
          const { rawProducts: _rp, ...forLlm } = toolResult;
          const toolPayload =
            toolResult.ok && toolResult.products.length > 0
              ? {
                  ok: true as const,
                  count: toolResult.count,
                  vitrina_note: `Pentru titlu/preț/link și [Produs N], folosește STRICT mesajul utilizator «${VITRINA_UNIFIED_USER_TAG}» imediat după răspunsurile tool din această rundă.`,
                }
              : forLlm;
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(toolPayload),
          });
        } else {
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({ ok: false, error: `unknown_tool:${tc.function.name}`, products: [] }),
          });
        }
      }
      if (latestProducts.length > 0) {
        const shortIds = shortIdsForProductList(latestProducts);
        messages.push({
          role: "user",
          content: buildUnifiedVitrinaUserMessage(latestProducts, shortIds),
        });
      }
      continue;
    }

    const reply = (msg.content ?? "").trim();
    messages.push({ role: "assistant", content: reply });

    const noProducts = latestProducts.length === 0;
    const shortIds = noProducts ? [] : shortIdsForProductList(latestProducts);
    const contextProducts = noProducts ? undefined : toChatProductCards(latestProducts, shortIds);
    let replyOut = noProducts && reply.length === 0 ? CATALOG_STALE_MESSAGE : reply;
    if (contextProducts && contextProducts.length > 0) {
      replyOut = embedPlainProdusRefsWithClickThrough(replyOut, contextProducts);
    }
    const payload: ChatSuccessPayload = {
      reply: replyOut,
      productsInContext: latestProducts.length,
      recommendedProductTitle: (latestProducts[0]?.title ?? "").trim(),
      requiresEmailCapture: false,
      ...(contextProducts && contextProducts.length > 0 ? { contextProducts } : {}),
    };
    return Response.json(payload);
  }

  return Response.json(
    {
      reply: "Prea multe runde de instrumente; reformulează te rog cererea.",
      productsInContext: 0,
      recommendedProductTitle: "",
      requiresEmailCapture: false,
    },
    { status: 200 }
  );
}

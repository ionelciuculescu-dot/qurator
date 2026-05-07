import { PostgresCatalogReader } from "@/sales/adapters/postgres-catalog-reader";
import { appendConversationIdToClickLinks } from "@/sales/lib/clickThroughLinks";
import { handleChatFromParsed } from "@/sales/chat/deepseek";
import { logConversation } from "@/lib/db";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

let postgresCatalogReader: PostgresCatalogReader | undefined;

function getPostgresCatalogReader(): PostgresCatalogReader {
  if (!postgresCatalogReader) {
    postgresCatalogReader = new PostgresCatalogReader();
  }
  return postgresCatalogReader;
}

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const res = await handleChatFromParsed(raw, () => getPostgresCatalogReader(), {
    requestCookieHeader: req.headers.get("cookie"),
  });

  if (res.ok && raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const message = o.message;
    const data = (await res.clone().json().catch(() => null)) as {
      reply?: string;
      productsInContext?: number;
      recommendedProductTitle?: string;
      requiresEmailCapture?: boolean;
      debugLlmProductsJson?: string;
      contextProducts?: Array<{
        title: string;
        imageUrl: string;
        price: string;
        currency: string;
        affiliateUrl: string;
      }>;
    } | null;
    if (typeof message === "string" && data && typeof data.reply === "string") {
      const sid = typeof o.sessionId === "string" ? o.sessionId.trim() : "";
      const cidRaw = typeof o.conversationId === "string" ? o.conversationId.trim() : "";
      const idOk = (t: string) => t.length >= 8 && t.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(t);
      const conversationId =
        sid.length >= 8 && idOk(sid) ? sid : cidRaw.length >= 8 && idOk(cidRaw) ? cidRaw : randomUUID();
      const replyOut = appendConversationIdToClickLinks(data.reply, conversationId);
      await logConversation({
        id: conversationId,
        question: message,
        reply: replyOut,
        productsInContext:
          typeof data.productsInContext === "number" ? data.productsInContext : 0,
        recommendedProductTitle:
          typeof data.recommendedProductTitle === "string" ? data.recommendedProductTitle : "",
      }).catch(() => {});
      const requiresEmailCapture = data.requiresEmailCapture === true;
      const debugPayload =
        typeof data.debugLlmProductsJson === "string" && data.debugLlmProductsJson.length > 0
          ? { debugLlmProductsJson: data.debugLlmProductsJson }
          : {};
      const cardsPayload =
        Array.isArray(data.contextProducts) && data.contextProducts.length > 0
          ? { contextProducts: data.contextProducts }
          : {};
      const forwardCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      const outHeaders = new Headers({ "Content-Type": "application/json" });
      for (const c of forwardCookies) outHeaders.append("Set-Cookie", c);
      return new Response(
        JSON.stringify({
          reply: replyOut,
          requiresEmailCapture,
          productsInContext:
            typeof data.productsInContext === "number" ? data.productsInContext : 0,
          recommendedProductTitle:
            typeof data.recommendedProductTitle === "string" ? data.recommendedProductTitle : "",
          ...cardsPayload,
          ...debugPayload,
        }),
        { status: 200, headers: outHeaders }
      );
    }
  }

  return res;
}

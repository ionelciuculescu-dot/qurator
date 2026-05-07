import type { ParsedProduct } from "@/shared/models/product";

const CLICK_BASE = "https://click.local";

/**
 * Markdown: elimină spațiile dintre `](` și URL (ex. `](  /api/click` → `](/api/click`),
 * ca linkurile să se randeze corect în UI.
 */
export function normalizeMarkdownLinkWhitespace(reply: string): string {
  return reply.replace(/\]\(\s+/g, "](");
}

/** Elimină caractere care pot sparge markdown `](...)` sau query-ul HTTP. */
export function sanitizeProductTitleForClickParam(title: string): string {
  return title
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

/** Construiește calea `/api/click?...` cu `URLSearchParams` (encode corect, fără spații libere). */
export function buildClickThroughPath(
  affiliateUrl: string,
  productTitle: string,
  productShortId?: string | null
): string {
  const u = new URL("/api/click", CLICK_BASE);
  u.searchParams.set("url", affiliateUrl.trim());
  u.searchParams.set("produs", sanitizeProductTitleForClickParam(productTitle || "Produs"));
  const pid = (productShortId ?? "").trim().toLowerCase();
  if (/^[a-z0-9]{6}$/.test(pid)) {
    u.searchParams.set("pid", pid);
  }
  return `${u.pathname}${u.search}`;
}

/**
 * Transformă `[Produs N]` fără URL în link markdown cu `/api/click?...&pid=...`
 * (UI poate derula la `id="prod-{pid}"` fără să depindă doar de indexul din snapshot).
 */
export function embedPlainProdusRefsWithClickThrough(
  reply: string,
  cards: Array<{ title: string; affiliateUrl: string; productShortId: string }>
): string {
  return reply.replace(/\[Produs\s*#?\s*(\d+)\](?!\()/gi, (_full, numStr: string) => {
    const n = Number.parseInt(String(numStr), 10);
    if (!Number.isFinite(n) || n < 1 || n > cards.length) {
      return _full;
    }
    const c = cards[n - 1];
    const path = buildClickThroughPath(c.affiliateUrl, c.title, c.productShortId);
    return `[Produs ${n}](${path})`;
  });
}

/**
 * Înlocuiește în markdown linkurile directe către `affiliateLink` cu ruta de tracking
 * `/api/click?...` (parametri via `URLSearchParams` = același efect ca `encodeURIComponent` per cheie).
 */
export function rewriteAffiliateMarkdownToClickThrough(
  reply: string,
  products: ParsedProduct[]
): string {
  let out = reply;
  const sorted = [...products]
    .filter((p) => typeof p.affiliateLink === "string" && p.affiliateLink.trim().length > 0)
    .sort((a, b) => b.affiliateLink.length - a.affiliateLink.length);

  for (const p of sorted) {
    const raw = p.affiliateLink.trim();
    const title = (p.title || "Produs").trim();
    const clickPath = buildClickThroughPath(raw, title, null);
    const replacement = `](${clickPath})`;
    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\]\\(${escaped}\\)`, "g"), replacement);
  }
  return normalizeMarkdownLinkWhitespace(out);
}

/** Adaugă `cid` la toate linkurile `/api/click?...` din markdown (pentru corelare click ↔ conversație). */
export function appendConversationIdToClickLinks(reply: string, conversationId: string): string {
  const withCid = reply.replace(/\]\((\/api\/click\?[^)]+)\)/g, (full, inner: string) => {
    if (String(inner).includes("cid=")) return full;
    try {
      const u = new URL(inner, CLICK_BASE);
      u.searchParams.set("cid", conversationId.trim());
      return `](${u.pathname}${u.search})`;
    } catch {
      const enc = encodeURIComponent(conversationId.trim());
      return `](${inner}&cid=${enc})`;
    }
  });
  return normalizeMarkdownLinkWhitespace(withCid);
}

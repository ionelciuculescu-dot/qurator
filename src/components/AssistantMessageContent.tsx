"use client";

import type { ReactNode } from "react";
import { useCallback } from "react";

import { productDomIdFromShortId, shortIdForChatProductCard } from "@/sales/lib/productShortId";
import type { ChatProductCard } from "@/sales/chat/types";

function vitrinaGlowScroll(el: HTMLElement) {
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("vitrine-product-glow");
  window.setTimeout(() => {
    el.classList.remove("vitrine-product-glow");
  }, 2200);
}

function parsePidFromApiClickHref(href: string): string | null {
  try {
    const u = new URL(href, typeof window !== "undefined" ? window.location.origin : "https://localhost");
    const pid = u.searchParams.get("pid")?.trim().toLowerCase() ?? "";
    return /^[a-z0-9]{6}$/.test(pid) ? pid : null;
  } catch {
    return null;
  }
}

function affiliateUrlFromApiClickHref(href: string): string {
  try {
    const u = new URL(href, typeof window !== "undefined" ? window.location.origin : "https://localhost");
    return u.searchParams.get("url")?.trim() ?? "";
  } catch {
    return "";
  }
}

function tryScrollProductByShortId(
  shortId: string,
  fallbackUrl: string,
  onOpenHistoryDrawer?: (() => void) | null
) {
  const domId = productDomIdFromShortId(shortId);
  const tryEl = () => document.getElementById(domId);
  let el = tryEl();
  if (el) {
    vitrinaGlowScroll(el);
    return;
  }
  if (onOpenHistoryDrawer) {
    onOpenHistoryDrawer();
    window.setTimeout(() => {
      el = tryEl();
      if (el) {
        vitrinaGlowScroll(el);
        return;
      }
      window.setTimeout(() => {
        el = tryEl();
        if (el) vitrinaGlowScroll(el);
        else if (fallbackUrl.trim()) {
          window.open(fallbackUrl, "_blank", "noopener,noreferrer");
        }
      }, 160);
    }, 0);
    return;
  }
  if (fallbackUrl.trim()) {
    window.open(fallbackUrl, "_blank", "noopener,noreferrer");
  }
}

/**
 * Markdown: linkuri https sau `/api/click?...`
 * Nu opri la spațiu (`%20` e OK în query); ne oprim la `)` care închide `](...)`.
 */
const MD_LINK_RE = /\[([^\]]*)\]\((\/api\/click\?[^)]+|https?:\/\/[^)]+)\)/g;

/** [Produs N] = al N-lea produs din snapshot-ul acestui mesaj. */
const PRODUS_REF_RE = /\[Produs\s*#?\s*(\d+)\]/gi;

const PRODUS_LINK_LABEL_RE = /^produs\s*#?\s*(\d+)$/i;

/** Elimină marcaje ușoare markdown din eticheta unui link (ex. **Produs 1**). */
function stripLightMarkdownEmphasis(s: string): string {
  return s.replace(/\*+/g, "").trim();
}

function parseProdusSlotFromPlainLabel(label: string): number | null {
  const m = stripLightMarkdownEmphasis(label).match(PRODUS_LINK_LABEL_RE);
  if (!m) return null;
  const n = Number.parseInt(m[1] ?? "0", 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/** Linie cu preț: 💰 Preț: … sau Preț: … (RON sau altceva pe linie). */
const PRICE_LINE_RE = /(💰\s*)?((?:Preț|Pret):\s*)([^\n]+)/gi;

function formatPricesInText(segment: string): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  let k = 0;
  const re = new RegExp(PRICE_LINE_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) {
    if (m.index > last) {
      parts.push(segment.slice(last, m.index));
    }
    const emoji = m[1] ?? "";
    const label = m[2] ?? "";
    const value = (m[3] ?? "").trim();
    parts.push(
      <span key={`price-${k++}`} className="inline">
        {emoji}
        <span>{label}</span>
        <strong className="text-xl font-bold tracking-tight text-neutral-900">{value}</strong>
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < segment.length) {
    parts.push(segment.slice(last));
  }
  return parts.length > 0 ? parts : segment;
}

function renderSegmentWithProductRefs(
  segment: string,
  keyPrefix: string,
  onProdusSlot: ((n: number) => void) | null
): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  let k = 0;
  const re = new RegExp(PRODUS_REF_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) {
    if (m.index > last) {
      parts.push(
        <span key={`${keyPrefix}-txt-${k}`} className="inline align-baseline">
          {formatPricesInText(segment.slice(last, m.index))}
        </span>
      );
    }
    const slot = Number.parseInt(m[1] ?? "0", 10);
    const label = m[0];
    if (onProdusSlot && Number.isFinite(slot) && slot >= 1) {
      parts.push(
        <button
          key={`${keyPrefix}-ref-${k++}`}
          type="button"
          onClick={() => onProdusSlot(slot)}
          className="mx-0.5 inline cursor-pointer rounded-md border border-orange-200/90 bg-orange-50 px-1.5 py-0.5 align-baseline text-[13px] font-semibold text-orange-800 underline decoration-orange-400/80 underline-offset-2 transition hover:border-orange-400 hover:bg-orange-100"
        >
          {label}
        </button>
      );
    } else {
      parts.push(
        <span key={`${keyPrefix}-ref-${k++}`} className="mx-0.5 inline font-semibold text-orange-800">
          {label}
        </span>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < segment.length) {
    parts.push(
      <span key={`${keyPrefix}-txt-end`} className="inline align-baseline">
        {formatPricesInText(segment.slice(last))}
      </span>
    );
  }
  return parts.length > 0 ? parts : formatPricesInText(segment);
}

export type AssistantMessageContentProps = {
  content: string;
  /** Snapshot produse pentru acest răspuns (inclusiv mod dashboard). */
  messageContextProducts?: ChatProductCard[];
  /** Pe mobil: deschide sertarul „Văzute anterior” ca să poată apărea `prod-*` în DOM. */
  onOpenHistoryDrawer?: (() => void) | null;
};

/**
 * Randare mesaj asistent: linkuri markdown cu OFERTA/CUMPARA → buton portocaliu;
 * linii „Preț:” → valoare îngroșată text-xl; [Produs N] → scroll la `prod-{shortId}` sau deschidere link.
 */
export function AssistantMessageContent({
  content,
  messageContextProducts,
  onOpenHistoryDrawer = null,
}: AssistantMessageContentProps) {
  const resolveProdusClick = useCallback(
    (slot: number, mdClickUrl?: string) => {
      const idx = slot - 1;
      const snap = messageContextProducts;
      const hasSnap = Array.isArray(snap) && idx >= 0 && idx < snap.length;
      const pidFromMd = mdClickUrl && mdClickUrl.includes("/api/click") ? parsePidFromApiClickHref(mdClickUrl) : null;
      const shortId =
        pidFromMd ??
        (hasSnap && snap ? shortIdForChatProductCard(snap[idx]) : null);
      if (!shortId) return;

      let fallback = "";
      if (mdClickUrl && mdClickUrl.includes("/api/click")) {
        fallback = affiliateUrlFromApiClickHref(mdClickUrl);
      }
      if (!fallback && hasSnap && snap) {
        fallback = (snap[idx].affiliateUrl ?? "").trim();
      }

      tryScrollProductByShortId(shortId, fallback, onOpenHistoryDrawer ?? null);
    },
    [messageContextProducts, onOpenHistoryDrawer]
  );

  const onProdusSlot = useCallback(
    (slot: number) => {
      resolveProdusClick(slot, undefined);
    },
    [resolveProdusClick]
  );

  const nodes: ReactNode[] = [];
  let key = 0;
  const re = new RegExp(MD_LINK_RE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      nodes.push(
        <span key={`txt-${key++}`} className="inline align-baseline">
          {renderSegmentWithProductRefs(content.slice(last, m.index), `seg-${key}`, onProdusSlot)}
        </span>
      );
    }
    const label = m[1];
    const url = m[2];
    const slotFromMdLabel = parseProdusSlotFromPlainLabel(label);
    if (slotFromMdLabel !== null) {
      nodes.push(
        <button
          key={`lnk-v-${key++}`}
          type="button"
          onClick={() => resolveProdusClick(slotFromMdLabel, url)}
          className="mx-0.5 inline cursor-pointer rounded-md border border-orange-200/90 bg-orange-50 px-1.5 py-0.5 align-baseline text-[13px] font-semibold text-orange-800 underline decoration-orange-400/80 underline-offset-2 transition hover:border-orange-400 hover:bg-orange-100"
        >
          {`[Produs ${slotFromMdLabel}]`}
        </button>
      );
    } else {
      const isOfferCta = /OFERTA|CUMPARA/i.test(label);
      nodes.push(
        <a
          key={`lnk-${key++}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={
            isOfferCta
              ? "my-2 flex w-full max-w-md items-center justify-center rounded-lg bg-[#ff6200] px-4 py-2.5 text-center text-[14px] font-semibold leading-snug text-white no-underline shadow-sm transition hover:bg-[#e55800] hover:shadow-md active:scale-[0.98] sm:inline-flex sm:w-auto"
              : "font-medium text-blue-600 underline decoration-blue-400/60 underline-offset-2 transition hover:text-blue-800"
          }
        >
          {label}
        </a>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    nodes.push(
      <span key={`txt-${key++}`} className="inline align-baseline">
        {renderSegmentWithProductRefs(content.slice(last), `seg-${key}`, onProdusSlot)}
      </span>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-neutral-800">
        {renderSegmentWithProductRefs(content, "all", onProdusSlot)}
      </div>
    );
  }

  return (
    <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-neutral-800">{nodes}</div>
  );
}

import type { ChatProductCard } from "@/sales/chat/types";

export { productDomIdFromChatCard as productDomIdFromCard } from "@/sales/lib/productShortId";

/** Cheie stabilă pentru deduplicare (aliniat la server: link apoi titlu). */
export function chatProductKey(p: ChatProductCard): string {
  const u = (p.affiliateUrl ?? "").trim();
  if (u) return `u:${u}`;
  const t = (p.title ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const img = (p.imageUrl ?? "").trim();
  if (img) return `t:${t}|img:${img.slice(0, 120)}`;
  return `t:${t}`;
}

/**
 * `newMain` devine vitrina curentă; produsele din `prevMain` și `prevHistory` care nu mai sunt
 * în `newMain` intră în istoric, deduplicate, fără duplicate între ele.
 */
export function mergeMainAndHistory(
  prevMain: ChatProductCard[],
  prevHistory: ChatProductCard[],
  newMain: ChatProductCard[]
): { main: ChatProductCard[]; history: ChatProductCard[] } {
  const mainKeys = new Set(newMain.map(chatProductKey));
  const seen = new Set<string>();
  const history: ChatProductCard[] = [];

  for (const p of prevHistory) {
    const k = chatProductKey(p);
    if (mainKeys.has(k) || seen.has(k)) continue;
    seen.add(k);
    history.push(p);
  }
  for (const p of prevMain) {
    const k = chatProductKey(p);
    if (mainKeys.has(k) || seen.has(k)) continue;
    seen.add(k);
    history.push(p);
  }

  return { main: newMain, history };
}

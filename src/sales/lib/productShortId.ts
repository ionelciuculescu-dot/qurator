import type { ChatProductCard } from "@/sales/chat/types";

/**
 * ID scurt stabil (6 caractere [a-z0-9]) din titlu + link — același algoritm pe server și client.
 * Folosit pentru `id="prod-{shortId}"` și query `pid=` în `/api/click`.
 */
export function stableProductShortId(title: string, affiliateUrl: string): string {
  const basis = `${(affiliateUrl ?? "").trim().toLowerCase()}|${(title ?? "").trim().toLowerCase()}`;
  let h = 2166136261;
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const n = h >>> 0;
  const a = n.toString(36);
  const b = Math.imul(n, 2654435761) >>> 0;
  const c = b.toString(36);
  const raw = (a + c).replace(/[^a-z0-9]/gi, "");
  return raw.slice(0, 6).padEnd(6, "0");
}

/** `prod-{shortId}` — singurul format de ancoră DOM pentru carduri. */
export function productDomIdFromShortId(shortId: string): string {
  const s = shortId.trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return `prod-${s}`;
}

export function shortIdForChatProductCard(p: ChatProductCard): string {
  const sid = (p.productShortId ?? "").trim().toLowerCase();
  if (/^[a-z0-9]{6}$/.test(sid)) return sid;
  return stableProductShortId(p.title ?? "", p.affiliateUrl ?? "");
}

export function productDomIdFromChatCard(p: ChatProductCard): string {
  return productDomIdFromShortId(shortIdForChatProductCard(p));
}

/**
 * Asigură `productShortId` unic în listă (coliziuni rare: re-hash cu sufix discret).
 */
export function assignUniqueProductShortIds<T extends { title: string; affiliateUrl: string; productShortId?: string }>(
  items: T[]
): (T & { productShortId: string })[] {
  const used = new Set<string>();
  return items.map((p) => {
    let base = (p.productShortId ?? "").trim().toLowerCase();
    if (!/^[a-z0-9]{6}$/.test(base)) {
      base = stableProductShortId(p.title ?? "", p.affiliateUrl ?? "");
    }
    let id = base.slice(0, 6);
    let salt = 0;
    while (used.has(id)) {
      salt += 1;
      id = stableProductShortId(`${p.title ?? ""}\0${salt}`, p.affiliateUrl ?? "").slice(0, 6);
    }
    used.add(id);
    return { ...p, productShortId: id };
  });
}

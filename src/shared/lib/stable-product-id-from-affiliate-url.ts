/** ID stabil derivat din URL afiliat (FNV-1a 32-bit), aliniat la upsert `public.products` (Postgres). */
export function stableProductIdFromAffiliateUrl(affiliateUrl: string): number {
  let h = 2166136261 >>> 0;
  const s = affiliateUrl.trim();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 0x7fffffff) + 1;
}

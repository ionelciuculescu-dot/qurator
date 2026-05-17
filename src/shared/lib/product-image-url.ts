const MAX_IMAGE_URL = 2048;

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|avif|svg)(\?|#|$)/i;

function capUrl(s: string, max = MAX_IMAGE_URL): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max);
}

/**
 * Extrage URL-uri de imagine din câmpul XML `image_urls` fără a sparge path-uri la spațiu.
 * Separatori de listă: virgulă, punct-virgulă, pipe, rând nou — nu whitespace generic.
 */
export function extractImageUrlsFromField(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];

  const parts = t
    .split(/[,;|\n\r]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const urls: string[] = [];
  for (const part of parts) {
    if (/^https?:\/\//i.test(part)) {
      urls.push(part);
      continue;
    }
    const embedded = part.match(/https?:\/\/[^\s<>"',;|]+/gi);
    if (embedded) urls.push(...embedded.map((u) => u.trim()));
  }

  if (urls.length > 0) return urls;

  if (/^https?:\/\//i.test(t)) return [t];

  const loose = t.match(/https?:\/\/[^\s<>"',;|]+/gi);
  return loose ? loose.map((u) => u.trim()) : [];
}

/** Prima imagine http(s) din câmpul brut (cap la 2048 caractere). */
export function firstImageUrlFromField(raw: string): string {
  const tokens = extractImageUrlsFromField(raw);
  const httpFirst = tokens.find((u) => /^https?:\/\//i.test(u));
  const u = httpFirst ?? tokens[0] ?? "";
  return capUrl(u);
}

/** URL utilizabil în UI / JSON-LD (extensie validă, fără path trunchiat „Screenshot”). */
export function isUsableProductImageUrl(url: string): boolean {
  const u = url.trim();
  if (!u || !/^https?:\/\//i.test(u)) return false;

  const pathOnly = (u.split(/[?#]/)[0] ?? u).replace(/\/+$/, "");
  const lastSegment = pathOnly.split("/").pop() ?? pathOnly;

  if (/\bscreenshot\.?$/i.test(lastSegment)) return false;
  if (/screenshot\.?$/i.test(pathOnly) && !IMAGE_EXT_RE.test(u)) return false;

  return IMAGE_EXT_RE.test(u);
}

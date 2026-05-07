import type { ParsedProduct } from "@/shared/models/product";

/** Lower ASCII fără diacritice (aliniat la filtrele de catalog). */
function foldAsciiLower(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/**
 * Curăță text pentru căutare: diacritice eliminate, `&` și punctuație → spațiu,
 * spații colapsate (compară cu același tratament pe datele din catalog).
 */
export function normalizeForProductSearch(s: string): string {
  let t = foldAsciiLower(s);
  t = t.replace(/[^\p{L}\p{N}\s]+/gu, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

/**
 * Împarte interogarea în tokeni (cuvinte / numere utile).
 * Ignoră tokenii de un singur caracter (în afară de secvențe numerice).
 */
export function tokenizeCatalogQuery(query: string): string[] {
  const n = normalizeForProductSearch(query);
  return n.split(/\s+/).filter((t) => {
    if (t.length === 0) return false;
    if (/^\d+$/.test(t)) return true;
    return t.length >= 2;
  });
}

/** Câți tokeni trebuie să se potrivească (permite un cuvânt „în plus” sau lipsă la ≥2 tokeni). */
export function requiredTokenMatches(total: number): number {
  if (total <= 0) return 0;
  if (total === 1) return 1;
  return Math.max(1, total - 1);
}

/** Tokeni scurți unde prefixul nu trebuie extins cu literă (ex. „pila” ≠ „pilar”). */
const STRICT_PREFIX_NO_LETTER_SUFFIX = new Set(["pila"]);

function isAsciiLetter(ch: string | undefined): boolean {
  return ch != null && /^[a-z]$/i.test(ch);
}

/**
 * Potrivire flexibilă pe cuvinte; fără `hay.includes` scurt care prinde „pila” în „pilar”.
 * Pentru tokeni foarte lungi păstrăm și potrivire substring pe tot haystack-ul.
 */
export function tokenMatchesInHaystack(token: string, hay: string): boolean {
  if (!token) return true;
  const words = hay.split(/\s+/).filter(Boolean);

  for (const w of words) {
    if (w === token) return true;
    if (token.length >= 4) {
      const minus = token.slice(0, -1);
      if (minus.length >= 3 && w === minus) return true;
    }
    if (w.startsWith(token)) {
      if (w.length === token.length) return true;
      if (
        w.length > token.length &&
        isAsciiLetter(w[token.length]) &&
        STRICT_PREFIX_NO_LETTER_SUFFIX.has(token)
      ) {
        continue;
      }
      return true;
    }
    if (token.length >= 3 && w.length >= 3 && token.startsWith(w)) return true;
  }

  if (token.length >= 6 && hay.includes(token)) return true;
  return false;
}

/**
 * Filtrare după tokeni în titlu / descriere: normalizare, majoritatea tokenilor,
 * potrivire parțială (prefix / un caracter lipsă pe token lungi).
 */
export function productMatchesKeywordQuery(product: ParsedProduct, query: string): boolean {
  const tokens = tokenizeCatalogQuery(query);
  if (tokens.length === 0) return true;
  const hay = normalizeForProductSearch(`${product.title} ${product.description}`);
  let matched = 0;
  for (const tok of tokens) {
    if (tokenMatchesInHaystack(tok, hay)) matched += 1;
  }
  return matched >= requiredTokenMatches(tokens.length);
}

/** Intenție hrană uscată vs umedă din interogare (tokeni normalizați). */
export type PetFoodTextureIntent = "dry" | "wet";

/**
 * Detectează dacă utilizatorul cere explicit hrană uscată sau umedă.
 * Dacă apar semnale contradictorii (ex. uscat + umed în aceeași frază), returnează `null`.
 */
export function inferPetFoodTextureIntent(query: string): PetFoodTextureIntent | null {
  const n = normalizeForProductSearch(query);
  if (!n) return null;
  const toks = n.split(/\s+/).filter(Boolean);
  let dry = false;
  let wet = false;
  for (const t of toks) {
    if (t.startsWith("uscat") || t === "crochete" || t === "granule" || t === "brobite" || t === "kibble") {
      dry = true;
    }
    if (t.includes("umed") || t.includes("conserva") || t.includes("conserve") || t === "pate" || t.startsWith("pate")) {
      wet = true;
    }
  }
  if (n.includes("hrana uscata") || n.includes("mancare uscata")) dry = true;
  if (n.includes("hrana umeda") || n.includes("mancare umeda")) wet = true;
  if (dry && !wet) return "dry";
  if (wet && !dry) return "wet";
  return null;
}

function normalizedTitleWords(title: string): string[] {
  const t = normalizeForProductSearch(title);
  if (!t) return [];
  return t.split(/[^a-z0-9]+/).filter((w) => w.length > 0);
}

/** Titlu sugerează hrană umedă / conservă — conflict când utilizatorul cere uscată (cuvinte, nu substring „conservant”). */
export function titleConflictsWithDryIntent(title: string): boolean {
  const words = normalizedTitleWords(title);
  for (const w of words) {
    if (w.startsWith("umed")) return true;
    if (w === "conserva" || w === "conserve" || w === "conservele") return true;
    if (w === "pate" || (w.startsWith("pate") && !w.includes("uscat"))) return true;
  }
  return false;
}

/** Titlu sugerează hrană uscată (crochete etc.) — conflict când utilizatorul cere umedă. */
export function titleConflictsWithWetIntent(title: string): boolean {
  const words = normalizedTitleWords(title);
  for (const w of words) {
    if (w.startsWith("uscat")) return true;
    if (w === "crochete" || w === "granule" || w.startsWith("brobite")) return true;
  }
  return false;
}

function scoreProductForTextureAndTokens(
  product: ParsedProduct,
  query: string,
  intent: PetFoodTextureIntent | null
): number {
  const title = normalizeForProductSearch(product.title);
  const desc = normalizeForProductSearch(product.description);
  const tokens = tokenizeCatalogQuery(query);
  let s = 0;
  for (const tok of tokens) {
    if (tokenMatchesInHaystack(tok, title)) s += 10;
    else if (tokenMatchesInHaystack(tok, desc)) s += 3;
  }
  if (intent === "dry") {
    if (title.includes("uscat") || title.includes("crochete") || title.includes("granule") || title.includes("brobite")) {
      s += 45;
    }
  } else if (intent === "wet") {
    if (title.includes("umed") || title.includes("conserva") || title.includes("conserve") || title.includes("pate")) {
      s += 45;
    }
  }
  return s;
}

/**
 * Sortare pentru context chat: prioritate tokeni în titlu + bonus dacă titlul reflectă tipul cerut (uscat/umed).
 */
export function compareProductsForChatContext(
  a: ParsedProduct,
  b: ParsedProduct,
  query: string,
  intent: PetFoodTextureIntent | null
): number {
  return (
    scoreProductForTextureAndTokens(b, query, intent) - scoreProductForTextureAndTokens(a, query, intent)
  );
}

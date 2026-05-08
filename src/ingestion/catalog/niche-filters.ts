import type { EssentialProduct } from "@/shared/models/product";

/** Valori `niche_type` / `feed_configs.niche` persistate la import XML. */
export type CatalogNicheOverride = "petshop" | "it" | "tech" | "generic" | "bricolaj";

/**
 * Elimină diacriticele (Unicode NFD) + lowercase — potrivire stabilă pentru
 * `câine` / `caine`, `hrană` / `hrana`, etc.
 */
export function foldAsciiLower(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function hostAndPathForMatch(feedUrl: string): string {
  try {
    const u = new URL(feedUrl);
    return `${u.hostname} ${u.pathname}`;
  } catch {
    return feedUrl;
  }
}

/**
 * Heuristică pe URL-ul feed-ului: dacă pare magazin pet, toate produsele esențiale din acel feed trec filtrul.
 * Folosește același `foldAsciiLower` ca titlurile (fără diacritice, case-insensitive).
 */
export function isLikelyPetshopFeedUrl(feedUrl: string): boolean {
  const f = foldAsciiLower(hostAndPathForMatch(feedUrl));
  if (!f.trim()) return false;
  return (
    /\bpet\b/.test(f) ||
    /petshop|pet\-shop|superpet|maxipet|animax|zooplus|vetshop|vet\-|veterinar|animal|zoo|hrana|man\-care|pisic|dogfood|croquet|croq|labo|furaj|acvariu/.test(f)
  );
}

/**
 * Cuvinte cheie pet (ASCII, după fold). Extins: royal, purina, accesorii, suplimente, etc.
 * Regex fără flag `i` — `hay` e deja lower + fără diacritice.
 */
const PET_KEYWORD_RE =
  /pet|pisic|pisica|pisici|pisi|catei|caine|caini|catel|dog|dogs|hrana|uscata|uscat|mancare|animale|veterinar|\bvet\b|aquarium|acvariu|litiere|scratch|jucarie|feline|canin|reptile|rozatoare|royal|purina|accesorii|suplimente|kitten|advance|puppy|coliv|cusca|cosulet|zgarda|hranitor|bol|furaj|iarba|substrat|vitamin|steril|castrat|antiparazitar|shampoo|sampon|guler|ham|lesa/;

export type CatalogVerticalFilterOpts = {
  /** Din `feed_configs`: URL poate fi generic (2Performant) fără „pet” în host — totuși feed-ul e curat în admin. */
  fromManagedFeedConfig?: boolean;
  /** Nișă explicită din admin → `products.niche_type` la import. */
  catalogNiche?: CatalogNicheOverride;
};

/**
 * Include Samsung (IT) sau verticale pet (titlu/link) sau feed dedicat pet (URL).
 * Pentru feed-uri adăugate în admin (`fromManagedFeedConfig` / `catalogNiche`), nu respinge tot feed-ul
 * doar pentru că URL-ul XML nu conține cuvinte „pet”.
 */
export function passesSamsungOrPetshopFilter(
  p: EssentialProduct,
  feedUrl?: string,
  opts?: CatalogVerticalFilterOpts
): boolean {
  const cn = opts?.catalogNiche;
  if (cn === "petshop" || cn === "it" || cn === "tech" || cn === "generic" || cn === "bricolaj") return true;
  if (opts?.fromManagedFeedConfig) return true;

  if (feedUrl && isLikelyPetshopFeedUrl(feedUrl)) return true;

  const hay = foldAsciiLower(`${p.title} ${p.affiliateLink}`);
  if (hay.includes("samsung")) return true;
  return PET_KEYWORD_RE.test(hay);
}

/** Pentru mapare DB când `feed_configs.niche` = auto. */
export function inferNicheTypeForCatalog(p: EssentialProduct, feedUrl?: string): CatalogNicheOverride {
  if (feedUrl && isLikelyPetshopFeedUrl(feedUrl)) return "petshop";
  const hay = foldAsciiLower(`${p.title} ${p.affiliateLink}`);
  if (PET_KEYWORD_RE.test(hay)) return "petshop";
  return "it";
}

/** Brand simplu extras din titlu (ex. Samsung). Case-insensitive + fără diacritice pe titlu. */
export function inferBrandFromTitle(title: string): string {
  if (foldAsciiLower(title).includes("samsung")) return "Samsung";
  return "";
}

/** Categorie scurtă pentru DB. */
export function inferCategoryHint(title: string, niche: CatalogNicheOverride, feedUrl?: string): string {
  if (niche === "petshop") {
    const t = foldAsciiLower(title);
    if (/pisic|feline|pisica|kitten/.test(t)) return "Pisici";
    if (/caine|caini|catel|dog|puppy|canin/.test(t)) return "Câini";
    if (/hran|hrana|mancare|uscate|umede|royal|purina|suplimente/.test(t)) return "Hrană";
    if (feedUrl && isLikelyPetshopFeedUrl(feedUrl)) return "Petshop";
    return "Petshop";
  }
  if (niche === "tech") return "Tech";
  if (niche === "generic") return "Generic";
  if (niche === "bricolaj") return "Bricolaj";
  const t = foldAsciiLower(title);
  if (/phone|telefon|galaxy|smartphone|mobile/.test(t)) return "Telefoane";
  return "IT";
}

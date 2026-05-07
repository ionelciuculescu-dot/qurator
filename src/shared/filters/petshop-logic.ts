import type { ParsedProduct } from "@/shared/models/product";

import { normalizeSearchText } from "./generic-logic";

function userMessageMentionsDog(message: string): boolean {
  const n = normalizeSearchText(message);
  return /\b(caine|caini|catei|cateii|catele|cateilor|catel|cateli|catelus|catelusi|bobite|bobiti|canin\w*|puppy|puppies|recompens\w*)\b/.test(
    n
  );
}

function userMessageMentionsCat(message: string): boolean {
  const n = normalizeSearchText(message);
  return /pisic|feline|miau/.test(n);
}

/** Mesajul indică hrană / produse pentru seniori (cuvânt întreg, diacritice ignorate). */
export function userMessageSeeksSenior(message: string): boolean {
  return /\bsenior\b/.test(normalizeSearchText(message));
}

/** Titluri incompatibile cu intenția „senior” (hrană de pui / gestație etc.). */
const SENIOR_INCOMPATIBLE_TITLE_MARKERS = /\b(junior|puppy|kitten|starter|mother)\b/;

export function productTitleConflictsWithSeniorUserIntent(p: ParsedProduct): boolean {
  return SENIOR_INCOMPATIBLE_TITLE_MARKERS.test(normalizeSearchText(p.title ?? ""));
}

/**
 * Potrivire strictă pentru intenția „senior”: titlul trebuie să conțină explicit „senior”
 * (nu trimitem Adult / All life stages ca înlocuitori fără clarificare).
 */
export function productTitleSatisfiesStrictSeniorUserIntent(p: ParsedProduct): boolean {
  if (productTitleConflictsWithSeniorUserIntent(p)) return false;
  return /\bsenior\b/.test(normalizeSearchText(p.title ?? ""));
}

/** Cheie stabilă specie petshop din text (null dacă ambiguu sau lipsă). */
export type PetshopSpeciesKey = "caine" | "pisica";

export function inferPetshopSpeciesKey(message: string): PetshopSpeciesKey | null {
  const isDog = userMessageMentionsDog(message);
  const isCat = userMessageMentionsCat(message);
  if (isDog && isCat) return null;
  if (isDog) return "caine";
  if (isCat) return "pisica";
  return null;
}

/**
 * Mesajul indică deja formă concretă (uscat/umed/crochete etc.) — nu mai întrebăm uscat vs conservă.
 * Nu folosim simpla mențiune „câini/căței” (ex. „mâncare de câini”) — încă e ambiguu pentru catalog.
 */
function messageImpliesConcretePetFoodForm(message: string): boolean {
  const n = normalizeSearchText(message);
  const dry =
    /\b(uscat\w*|crochete|granule|kibble|bobite|bobiti)\b/.test(n) ||
    /\bhran\w*\s+uscat/.test(n) ||
    /\buscat\w*\s+hran/.test(n);
  const wet =
    /\b(umed\w*|conserv|conserve|pate|pateu|pouch|pungi?\s+umed|hrana\s+umed)\b/.test(n) ||
    /\bhran\w*\s+umed/.test(n);
  return dry || wet;
}

export function shouldSkipPetFoodFormClarificationForProactiveCatalog(message: string): boolean {
  return messageImpliesConcretePetFoodForm(message);
}

/**
 * Ancoră din rase / indicii fără cuvântul „câine” sau „pisică” (ex. „Labrador” → câine).
 * Folosit la `current_species` și la clasificare PRODUSE.
 */
export function inferSpeciesAnchorFromBreeds(message: string): PetshopSpeciesKey | null {
  if (inferPetshopSpeciesKey(message)) return null;
  const n = normalizeSearchText(message);
  const dogBreed =
    /\b(labrador|retriever|golden|beagle|bulldog|dalmatian|doberman|husky|ciobanesc|collie|cocker|spaniel|terrier|pug|mastiff|rottweiler|rotweiler|pinscher|schnauzer|bichon|yorkshire|vizsla|weimaraner|setter|pointer|shar[\s-]?pei|akita|shiba|malamut|samoyed|canisa)\b/;
  const catBreed =
    /\b(persan|siamez|maine\s*coon|birmanez|ragdoll|british|exotic\s+shorthair|europeana|somaliu|abyssinian|norvegian|devon\s+rex|sphinx)\b/;
  const isDog = dogBreed.test(n);
  const isCat = catBreed.test(n);
  if (isDog && isCat) return null;
  if (isDog) return "caine";
  if (isCat) return "pisica";
  return null;
}

function productTextBlob(p: ParsedProduct): string {
  return normalizeSearchText(`${p.title} ${p.description} ${p.category ?? ""}`);
}

/**
 * Când contextul e câine: eliminăm produse pentru alte familii (pisici, pești, păsări, reptile, acvaristică etc.).
 * Textul e deja normalizat (lower, fără diacritice).
 */
const OTHER_SPECIES_MARKERS_FOR_DOG_CONTEXT =
  /pisic|feline|miau|pesti|pestisor|pestisori|\bpeste\b(?!\s+tot)|acvariu|acvari|papagal|papagali|pasari|pasare|coliv|reptil|broasca|broaste|testoasa|iguana|\bsarpe\b|serpi|tarantula|melc|hamster|iepure|iepuri|gaina|gaini|curcan|rata\b|ratoi/;

/**
 * Un singur produs petshop e „vizibil” pentru mesajul utilizatorului (câine vs pisică).
 * Aliniat la logica validată în `test_picking_real.py`.
 */
export function petshopProductVisibleForUserMessage(p: ParsedProduct, userMessage: string): boolean {
  return filterPetshopProductsBySpeciesIntent([p], userMessage).length === 1;
}

/**
 * Elimină produsele pentru cealaltă specie când mesajul menționează explicit câine sau pisică.
 * La context câine, excludem și pești, păsări (ex. papagal), reptile, acvariu etc.
 */
export function filterPetshopProductsBySpeciesIntent(
  products: ParsedProduct[],
  userMessage: string
): ParsedProduct[] {
  const isDog = userMessageMentionsDog(userMessage);
  const isCat = userMessageMentionsCat(userMessage);
  const seeksSenior = userMessageSeeksSenior(userMessage);
  if (isDog && isCat) {
    if (!seeksSenior) return products;
    return products.filter((p) => productTitleSatisfiesStrictSeniorUserIntent(p));
  }

  return products.filter((p) => {
    if (seeksSenior && !productTitleSatisfiesStrictSeniorUserIntent(p)) {
      return false;
    }
    const blob = productTextBlob(p);
    if (isDog) return !OTHER_SPECIES_MARKERS_FOR_DOG_CONTEXT.test(blob);
    if (isCat) return !/(caine|catel|caini)/.test(blob);
    return true;
  });
}

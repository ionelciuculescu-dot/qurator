const STOP = new Set([
  "caut",
  "caută",
  "cauta",
  "vreau",
  "vrea",
  "un",
  "o",
  "de",
  "la",
  "cu",
  "pentru",
  "sa",
  "să",
  "cel",
  "mai",
  "ce",
  "și",
  "si",
  "din",
  "am",
  "as",
  "aș",
  "căut",
  "cautam",
  "căutam",
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "looking",
  "for",
  "need",
  "want",
  "find",
]);

/**
 * Extrage termenii de căutare din mesaj (ex. „caut VMP vitamine pisici” → „vmp vitamine pisici”).
 * Păstrează toate cuvintele semnificative (nu doar ultimul), ca filtrarea pe catalog să nu piardă prefixe / branduri.
 */
export function extractKeyword(message: string): string {
  const normalized = message
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ");

  const words = normalized.split(/\s+/).filter((w) => w.length > 0);
  const significant = words.filter((w) => w.length > 2 && !STOP.has(w));

  if (significant.length > 0) {
    return significant.join(" ").trim();
  }

  const longer = words.filter((w) => w.length > 1 && !STOP.has(w));
  if (longer.length > 0) {
    return longer.join(" ").trim();
  }

  const fallback = message.trim().slice(0, 120).replace(/\s+/g, " ");
  return fallback.length > 0 ? fallback : "produs";
}

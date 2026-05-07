/**
 * Șiruri pentru `LIKE` în SQL pe `name` / `description` când filtrăm după specie.
 * DB-ul poate folosi diacritice („câine”) iar potrivirea doar cu `caine` exclude tot catalogul.
 */
export function speciesDbLikeNeedles(anchor: "caine" | "pisica"): readonly string[] {
  if (anchor === "pisica") {
    return ["pisic", "pisica", "pisici", "feline", "pisoi", "kitten", "kittens", "cat "];
  }
  return [
    "caine",
    "câine",
    "caini",
    "câini",
    "catel",
    "cățel",
    "câinel",
    "dog",
    "dogs",
    "puppy",
    "puppies",
  ];
}

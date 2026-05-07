import sqlite3
import sys
from pathlib import Path


def sqlite_norm_expr(column: str) -> str:
    """Expresie SQLite: text coloană lower + fără diacritice românești (compară cu termeni normalizați în Python)."""
    expr = f"LOWER(COALESCE({column}, ''))"
    for old, new in (
        ("ă", "a"),
        ("â", "a"),
        ("î", "i"),
        ("ș", "s"),
        ("ş", "s"),
        ("ț", "t"),
        ("ţ", "t"),
    ):
        expr = f"REPLACE({expr}, '{old}', '{new}')"
    return expr


def strip_diacritics(s: str) -> str:
    s = (s or "").lower()
    for old, new in (
        ("ă", "a"),
        ("â", "a"),
        ("î", "i"),
        ("ș", "s"),
        ("ş", "s"),
        ("ț", "t"),
        ("ţ", "t"),
    ):
        s = s.replace(old, new)
    return s


# Grupuri de sinonime (cheie = forma normalizată fără diacritice).
FOOD_QUERY_SYNONYMS = {
    "mancare": ("mancare", "hrana"),
    "hrana": ("mancare", "hrana"),
    "hrană": ("mancare", "hrana"),
}


def expand_token_variants(token: str) -> list[str]:
    """Returnează variantele de căutat în spațiul normalizat (fără diacritice)."""
    base = strip_diacritics(token.strip())
    if not base:
        return []
    if base in FOOD_QUERY_SYNONYMS:
        return list(dict.fromkeys(strip_diacritics(x) for x in FOOD_QUERY_SYNONYMS[base]))
    return [base]


def token_groups(query_term: str) -> list[list[str]]:
    parts = [p for p in query_term.split() if p.strip()]
    return [expand_token_variants(p) for p in parts]


def query_explicit_species(query_term: str) -> bool:
    """True dacă utilizatorul a menționat explicit câine sau pisică."""
    n = strip_diacritics(query_term)
    if "pisic" in n:
        return True
    if "caine" in n or "caini" in n:
        return True
    return False


def category_species_rank(category: str) -> int:
    """
    0 = câini, 1 = neutru / Petshop fără specie, 2 = pisici.
    Folosit la sortare când query-ul nu specifică specia: câinii primii (mai populari).
    """
    c = strip_diacritics(category or "")
    if "pisic" in c:
        return 2
    if "cain" in c or "cini" in c:
        return 0
    return 1


def sort_mixed_species_dogs_first(rows: list[tuple]) -> list[tuple]:
    """Păstrează ordinea relativă în interiorul fiecărei grupe (sort stabil după index)."""
    indexed = list(enumerate(rows))
    indexed.sort(key=lambda p: (category_species_rank(p[1][2]), p[0]))
    return [p[1] for p in indexed]


def test_picking(query_term, niche_filter="petshop"):
    db_path = Path(__file__).resolve().parent / "data" / "catalog.db"
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    exclude_word = "pisic" if "cain" in query_term.lower() else ""
    if "pisic" in query_term.lower():
        exclude_word = "cain"

    print(f"\n--- Cautare: '{query_term}' | Excludem: '{exclude_word}' ---")

    groups = token_groups(query_term)
    if not groups:
        conn.close()
        return []

    norm_name = sqlite_norm_expr("name")
    norm_desc = sqlite_norm_expr("description")

    params: list = []
    and_parts = []
    for variants in groups:
        or_parts = []
        for v in variants:
            like = f"%{v}%"
            or_parts.append(f"({norm_name} LIKE ? OR {norm_desc} LIKE ?)")
            params.extend([like, like])
        and_parts.append("(" + " OR ".join(or_parts) + ")")

    sql = f"""
        SELECT name, price, category, brand
        FROM products
        WHERE ({" AND ".join(and_parts)})
        AND niche_type = ?
    """
    params.append(niche_filter)

    if exclude_word:
        ex = strip_diacritics(exclude_word)
        sql += f"""
        AND {norm_name} NOT LIKE ? AND {norm_desc} NOT LIKE ?
        AND {norm_name} NOT LIKE ? AND {norm_desc} NOT LIKE ?
        """
        params.extend([f"%{ex}%", f"%{ex}%", f"%{exclude_word}%", f"%{exclude_word}%"])

    # Prioritate: titluri care încep cu primul cuvânt (sau sinonimele lui), apoi preț.
    first_variants = groups[0]
    start_cases = " OR ".join(f"{norm_name} LIKE ?" for _ in first_variants)
    for v in first_variants:
        params.append(f"{v}%")

    explicit_species = query_explicit_species(query_term)
    fetch_limit = 8 if explicit_species else 48

    sql += f"""
        ORDER BY (CASE WHEN {start_cases} THEN 0 ELSE 1 END),
                 CAST(price AS FLOAT) ASC
        LIMIT {fetch_limit}
    """

    cursor.execute(sql, params)
    results = list(cursor.fetchall())
    conn.close()

    if results and not explicit_species:
        has_dog = any(category_species_rank(r[2]) == 0 for r in results)
        has_cat = any(category_species_rank(r[2]) == 2 for r in results)
        if has_dog and has_cat:
            print(
                "! Cautare fara 'caine'/'pisica': apar produse pentru caini si pisici. "
                "Afisam intai cainii; adauga 'caine' sau 'pisica' in cautare pentru filtru strict."
            )
            results = sort_mixed_species_dogs_first(results)

    return results[:8]


def safe_console(s: str) -> str:
    """Evita UnicodeEncodeError pe consola Windows (cp1252)."""
    t = s if isinstance(s, str) else str(s)
    enc = sys.stdout.encoding or "utf-8"
    try:
        return t.encode(enc, errors="replace").decode(enc)
    except (LookupError, UnicodeError):
        return t.encode("ascii", errors="replace").decode("ascii")


search_queries = ["mancare caine", "lesa", "hrana junior"]

for q in search_queries:
    hits = test_picking(q)
    if hits:
        for idx, item in enumerate(hits):
            name, price, cat, brand = item[0], item[1], item[2], item[3]
            print(
                f"{idx+1}. [{safe_console(brand)}] {safe_console(name)} - Pret: {safe_console(price)} RON (Cat: {safe_console(cat)})"
            )
    else:
        print("Niciun rezultat gasit.")

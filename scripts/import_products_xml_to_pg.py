#!/usr/bin/env python3
"""
Import produse din XML (ex. feed 2Performant: <item>, title, description, price, aff_code, image_urls)
în PostgreSQL (tabelul `products` din `src/shared/sql/init_db.sql`).

Dependențe:
  pip install lxml psycopg2-binary

Exemplu:
  python scripts/import_products_xml_to_pg.py feed.xml --niche petshop
  set PGDATABASE=postgres
  set PGHOST=localhost

Conexiune implicită: host=localhost, port=5432, user=postgres, password=password123
(nume bază: PGDATABASE sau --dbname, implicit postgres).
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from typing import Any

from lxml import etree, html as lhtml
import psycopg2
from psycopg2 import extras
from psycopg2.extensions import AsIs


DEFAULT_CONN = {
    "host": "localhost",
    "port": 5432,
    "user": "postgres",
    "password": "password123",
}

PRODUCT_CONTAINER_TAGS = frozenset({"item", "product", "entry"})
DESCRIPTION_TAIL_MARKERS = re.compile(
    r"(?is)"
    r"(analiz[aă]|"
    r"compozi[tț]ie|ingrediente?\s+nutri|"
    r"nutri[tț]ional|guaranteed\s+analysis|"
    r"constituen[tț]i\s+anali[tț]ici|"
    r"valori\s+nutri[tț]ionale|"
    r"tab(el)?\s+nutri|"
    r"vitamin[aăe]|"
    r"proteine?\s*crude|"
    r"grasimi?\s*totale)"
)
DOG_RE = re.compile(
    r"\b(c[âa]ine|c[âa]ini|dog|canin|canine|puppy|puppies|pentru\s+c[âa]ini)\b",
    re.IGNORECASE,
)
CAT_RE = re.compile(
    r"\b(pisic[ăa]|pisici|feline|cat|cats|kitten|kittens|pentru\s+pisici)\b",
    re.IGNORECASE,
)
MAX_DESCRIPTION_DB = 32000


def norm_local_tag(tag: str | None) -> str:
    if not tag:
        return ""
    if "}" in tag:
        return tag.rsplit("}", 1)[-1].lower()
    if ":" in tag:
        return tag.rsplit(":", 1)[-1].lower()
    return tag.lower()


def child_text_map(elem: Any) -> dict[str, str]:
    """Chei = nume tag local lower; valoare = tot textul din subarbore (CDATA / HTML ca text)."""
    out: dict[str, str] = {}
    for child in elem:
        key = norm_local_tag(child.tag)
        if not key:
            continue
        val = "".join(child.itertext()).strip()
        if val:
            out[key] = val
    return out


def pick_first(m: dict[str, str], keys: tuple[str, ...]) -> str:
    for k in keys:
        v = m.get(k)
        if v and str(v).strip():
            return str(v).strip()
    return ""


def pick_title(m: dict[str, str]) -> str:
    return pick_first(m, ("title", "name", "product_name", "productname", "g:title"))


def pick_price(m: dict[str, str]) -> str:
    return pick_first(
        m,
        ("price", "sale_price", "current_price", "regular_price", "old_price", "g:price"),
    )


def pick_affiliate(m: dict[str, str]) -> str:
    return pick_first(
        m,
        (
            "aff_code",
            "url",
            "link",
            "g:link",
            "affiliate_url",
            "deeplink",
            "product_url",
            "guid",
        ),
    )


def pick_image(m: dict[str, str]) -> str:
    raw = pick_first(
        m,
        (
            "image_urls",
            "image_url",
            "g:image_link",
            "image_link",
            "images",
            "thumbnail",
            "img",
            "picture",
        ),
    )
    if not raw:
        return ""
    for tok in re.split(r"[,;|\n\r\t\s]+", raw):
        t = tok.strip()
        if not t:
            continue
        if re.match(r"^https?://", t, re.I):
            return t[:2048]
    return raw.strip()[:2048]


def pick_description_raw(m: dict[str, str]) -> str:
    return pick_first(
        m,
        (
            "description",
            "g:description",
            "short_description",
            "long_description",
            "summary",
            "content",
            "body",
        ),
    )


def first_word_brand(title: str) -> str:
    t = (title or "").strip()
    if not t:
        return ""
    return t.split()[0][:100]


def infer_species(title: str, description_plain: str) -> str:
    blob = f"{title}\n{description_plain}"
    has_dog = DOG_RE.search(blob) is not None
    has_cat = CAT_RE.search(blob) is not None
    if has_dog and not has_cat:
        return "câine"
    if has_cat and not has_dog:
        return "pisică"
    if has_dog and has_cat:
        d = DOG_RE.search(blob)
        c = CAT_RE.search(blob)
        if d and c:
            return "câine" if d.start() <= c.start() else "pisică"
    return ""


def remove_tables_and_scripts(fragment: str) -> str:
    if not fragment or not fragment.strip():
        return ""
    wrapped = f"<div>{fragment}</div>"
    try:
        tree = lhtml.fromstring(wrapped)
    except Exception:
        return re.sub(r"<[^>]+>", " ", fragment)
    for bad in tree.xpath("//script|//style|//table"):
        bad.getparent().remove(bad)
    text = tree.text_content() if tree is not None else ""
    text = re.sub(r"\s+", " ", text).strip()
    return text


def cut_after_benefits_section(plain: str) -> str:
    """
    Păstrează începutul + beneficii dacă e clar; taie înainte de analize/tabele nutriționale.
    """
    if not plain:
        return ""
    low = plain.lower()
    ben_idx = low.find("benefici")
    if ben_idx != -1:
        after = plain[ben_idx:]
        m = DESCRIPTION_TAIL_MARKERS.search(after)
        if m:
            cut_local = ben_idx + m.start()
            if cut_local > ben_idx + 40:
                return plain[:cut_local].strip()
    m2 = DESCRIPTION_TAIL_MARKERS.search(plain)
    if m2 and m2.start() > 80:
        return plain[: m2.start()].strip()
    return plain.strip()


def description_clean(plain: str, max_chars: int = 300) -> str:
    plain = cut_after_benefits_section(plain)
    if len(plain) <= max_chars:
        return plain
    return plain[:max_chars].rstrip()


def prepare_description_fields(description_html: str) -> tuple[str, str]:
    plain = remove_tables_and_scripts(description_html)
    short = description_clean(plain, 300)
    full = plain[:MAX_DESCRIPTION_DB] if plain else ""
    return full, short


def iter_product_elements(path: str) -> Any:
    """Streaming parse: randăm elemente item/product/entry."""
    src = os.path.abspath(os.path.expanduser(path))
    context = etree.iterparse(src, events=("end",))
    for _event, elem in context:
        if norm_local_tag(elem.tag) not in PRODUCT_CONTAINER_TAGS:
            continue
        yield elem
        elem.clear()
        parent = elem.getparent()
        if parent is not None:
            while elem.getprevious() is not None:
                del parent[0]


def sql_text_array(tags: list[str]) -> Any:
    """Literal PostgreSQL text[] sigur pentru psycopg2 (inclusiv în execute_values)."""
    if not tags:
        return AsIs("'{}'::text[]")
    parts: list[str] = []
    for t in tags:
        esc = (t or "").replace("\\", "\\\\").replace("'", "''")
        parts.append("'" + esc + "'")
    return AsIs("ARRAY[" + ",".join(parts) + "]::text[]")


def rows_from_xml(path: str, catalog_niche: str) -> list[tuple[Any, ...]]:
    """catalog_niche → coloana `niche_type` (ex. petshop, tech); specia inferată merge în `tags`."""
    niche_col = (catalog_niche or "").strip()[:100]
    rows: list[tuple[Any, ...]] = []
    for elem in iter_product_elements(path):
        m = child_text_map(elem)
        title = pick_title(m)
        aff = pick_affiliate(m)
        if not title or not aff:
            continue
        price = pick_price(m)
        image = pick_image(m)
        desc_html = pick_description_raw(m)
        full_plain, clean = prepare_description_fields(desc_html)
        brand = first_word_brand(title)
        species = infer_species(title, full_plain)
        tags: list[str] = []
        if species:
            tags.append(species)
        rows.append(
            (
                "xml_import",
                title,
                brand,
                price or "",
                "RON",
                niche_col,
                "",
                full_plain,
                clean,
                image or "",
                aff,
                "",
                sql_text_array(tags),
            )
        )
    return rows


def connect(args: argparse.Namespace) -> Any:
    kwargs = {
        "host": args.host or os.environ.get("PGHOST", DEFAULT_CONN["host"]),
        "port": int(args.port or os.environ.get("PGPORT", DEFAULT_CONN["port"])),
        "user": args.user or os.environ.get("PGUSER", DEFAULT_CONN["user"]),
        "password": args.password or os.environ.get("PGPASSWORD", DEFAULT_CONN["password"]),
        "dbname": args.dbname or os.environ.get("PGDATABASE", "postgres"),
    }
    return psycopg2.connect(**kwargs)


INSERT_SQL = """
INSERT INTO products (
  provider_id,
  feed_id,
  name,
  brand,
  price,
  currency,
  niche_type,
  category,
  description,
  description_clean,
  image_url,
  affiliate_url,
  shipping_info,
  tags,
  embedding
) VALUES %s
"""


def main() -> int:
    p = argparse.ArgumentParser(description="XML produse → PostgreSQL (products)")
    p.add_argument("xml_path", help="Cale către fișierul XML")
    p.add_argument(
        "--niche",
        default="",
        help="Valoare pentru products.niche_type (ex. petshop, tech). Goală = string vid.",
    )
    p.add_argument("--dbname", default=None, help="Nume bază (implicit: env PGDATABASE sau postgres)")
    p.add_argument("--host", default=None)
    p.add_argument("--port", default=None)
    p.add_argument("--user", default=None)
    p.add_argument("--password", default=None)
    p.add_argument("--dry-run", action="store_true", help="Doar numără rândurile, fără INSERT")
    args = p.parse_args()

    path = args.xml_path
    if not os.path.isfile(path):
        print(f"Fișier inexistent: {path}", file=sys.stderr)
        return 1

    try:
        rows = rows_from_xml(path, (args.niche or "").strip())
    except etree.XMLSyntaxError as e:
        print(f"XML invalid: {e}", file=sys.stderr)
        return 1

    print(f"Produse parseate (cu titlu + URL afiliat): {len(rows)}")
    if args.dry_run:
        return 0

    conn = connect(args)
    try:
        with conn.cursor() as cur:
            template = "(%s, NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL)"
            extras.execute_values(cur, INSERT_SQL, rows, template=template, page_size=500)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    print("Import finalizat.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

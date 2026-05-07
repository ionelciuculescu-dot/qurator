#!/usr/bin/env python3
"""
Parcurge `products` în PostgreSQL, calculează embedding-uri OpenAI (text-embedding-3-small)
și le salvează în coloana `embedding` folosind adaptorul **pgvector** pentru psycopg2.

Dependențe:
  pip install -r scripts/requirements-embeddings.txt

Variabile de mediu:
  OPENAI_API_KEY   — obligatoriu
  PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE — ca la import (implicit postgres@localhost)

Exemplu:
  set OPENAI_API_KEY=sk-...
  python scripts/embed_products_openai_pgvector.py
  python scripts/embed_products_openai_pgvector.py --dry-run
  python scripts/embed_products_openai_pgvector.py --force --batch-size 32
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Any, Sequence

import psycopg2
from openai import OpenAI
from pgvector.psycopg2 import register_vector

DEFAULT_PG = {
    "host": "localhost",
    "port": 5432,
    "user": "postgres",
    "password": "password123",
    "dbname": "postgres",
}

EMBED_MODEL = "text-embedding-3-small"
EMBED_DIM = 1536
# ~8k tokens; conservator pe caractere fără tiktoken
MAX_INPUT_CHARS = 12000
BATCH_DEFAULT = 64


def pg_connect() -> Any:
    return psycopg2.connect(
        host=os.environ.get("PGHOST", DEFAULT_PG["host"]),
        port=int(os.environ.get("PGPORT", str(DEFAULT_PG["port"]))),
        user=os.environ.get("PGUSER", DEFAULT_PG["user"]),
        password=os.environ.get("PGPASSWORD", DEFAULT_PG["password"]),
        dbname=os.environ.get("PGDATABASE", DEFAULT_PG["dbname"]),
    )


def embed_text_for_row(row: dict[str, Any]) -> str:
    """Text trimis la API: descriere, altfel description_clean, altfel name."""
    desc = (row.get("description") or "").strip()
    if desc:
        t = desc
    else:
        t = (row.get("description_clean") or "").strip() or (row.get("name") or "").strip()
    if len(t) > MAX_INPUT_CHARS:
        t = t[:MAX_INPUT_CHARS]
    return t


def fetch_product_rows(cur: Any, only_null_embedding: bool, limit: int | None) -> list[dict[str, Any]]:
    where = "WHERE TRUE"
    if only_null_embedding:
        where = "WHERE embedding IS NULL"
    lim = f"LIMIT {int(limit)}" if limit is not None and limit > 0 else ""
    cur.execute(
        f"""
        SELECT id, name, description, description_clean
        FROM products
        {where}
        ORDER BY id ASC
        {lim}
        """.strip()
    )
    cols = [d[0] for d in cur.description]
    out: list[dict[str, Any]] = []
    for tup in cur.fetchall():
        out.append(dict(zip(cols, tup)))
    return out


def main() -> int:
    p = argparse.ArgumentParser(description="OpenAI embeddings → products.embedding (pgvector)")
    p.add_argument("--dry-run", action="store_true", help="Doar citește și numără, fără API / UPDATE")
    p.add_argument(
        "--force",
        action="store_true",
        help="Recalculează și pentru rânduri care au deja embedding",
    )
    p.add_argument("--batch-size", type=int, default=BATCH_DEFAULT, help=f"Produse per apel API (implicit {BATCH_DEFAULT})")
    p.add_argument("--limit", type=int, default=0, help="Maxim N produse (0 = toate)")
    args = p.parse_args()

    if not os.environ.get("OPENAI_API_KEY", "").strip():
        print("Lipsește OPENAI_API_KEY.", file=sys.stderr)
        return 1

    batch_size = max(1, min(args.batch_size, 2048))
    limit_n = args.limit if args.limit and args.limit > 0 else None

    conn = pg_connect()
    register_vector(conn)
    client = OpenAI()

    with conn.cursor() as cur:
        rows = fetch_product_rows(cur, only_null_embedding=not args.force, limit=limit_n)

    if not rows:
        print("Niciun rând de procesat.")
        conn.close()
        return 0

    skipped_empty = 0
    work: list[tuple[int, str]] = []
    for r in rows:
        text = embed_text_for_row(r)
        if not text:
            skipped_empty += 1
            continue
        work.append((int(r["id"]), text))

    print(f"Rânduri citite: {len(rows)}, de încărcat: {len(work)}, fără text: {skipped_empty}")
    if args.dry_run:
        conn.close()
        return 0

    updated = 0
    with conn.cursor() as cur:
        for i in range(0, len(work), batch_size):
            chunk = work[i : i + batch_size]
            ids = [c[0] for c in chunk]
            texts = [c[1] for c in chunk]
            try:
                resp = client.embeddings.create(model=EMBED_MODEL, input=texts)
            except Exception as e:
                print(f"Eroare OpenAI la batch începând id={ids[0]}: {e}", file=sys.stderr)
                conn.rollback()
                return 1

            data_list = sorted(resp.data, key=lambda d: d.index)
            if len(data_list) != len(chunk):
                print("Răspuns OpenAI: număr de embedding-uri inegal cu batch-ul.", file=sys.stderr)
                conn.rollback()
                return 1

            for (pid, _t), emb_obj in zip(chunk, data_list):
                vec = emb_obj.embedding
                if len(vec) != EMBED_DIM:
                    print(
                        f"id={pid}: dimensiune {len(vec)} != {EMBED_DIM} (schema DB).",
                        file=sys.stderr,
                    )
                    conn.rollback()
                    return 1
                cur.execute("UPDATE products SET embedding = %s WHERE id = %s", (vec, pid))
                updated += 1

            conn.commit()
            print(f"  … batch {i // batch_size + 1}: {len(chunk)} produse (ultimul id={ids[-1]})")
            time.sleep(0.05)

    conn.close()
    print(f"Finalizat. UPDATE-uri: {updated}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

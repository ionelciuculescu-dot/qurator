"""
Căutare hibridă unică: semantică (pgvector + embedding OpenAI) + filtre SQL (categorie, preț).

Aliniat la schema `products` folosită în repo (vezi `src/shared/sql/catalog-queries.ts`,
`scripts/embed_products_openai_pgvector.py`). Variabile: `DATABASE_URL` sau `PGHOST`…,
`OPENAI_API_KEY` pentru embedding (același model ca în TypeScript: text-embedding-3-small).
"""

from __future__ import annotations

import os
from typing import Any

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
MAX_INPUT_CHARS = 8000

# Expresie SQL: încearcă să extragă primul număr din `price` (text feed) pentru comparări.
# Nu e perfect pentru toate formatele; pentru feed-uri noi merită coloană numerică dedicată.
_PRICE_NUM_SQL = r"""
(
  SELECT NULLIF(
    regexp_replace(
      regexp_replace(
        replace(replace(trim(COALESCE(price, '')), ',', '.'), ' ', ''),
        '[^0-9.]',
        '',
        'g'
      ),
      '^\.+',
      ''
    ),
    ''
  )::double precision
)
"""


def _pg_connect() -> Any:
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if url:
        conn = psycopg2.connect(url)
    else:
        conn = psycopg2.connect(
            host=os.environ.get("PGHOST", DEFAULT_PG["host"]),
            port=int(os.environ.get("PGPORT", str(DEFAULT_PG["port"]))),
            user=os.environ.get("PGUSER", DEFAULT_PG["user"]),
            password=os.environ.get("PGPASSWORD", DEFAULT_PG["password"]),
            dbname=os.environ.get("PGDATABASE", DEFAULT_PG["dbname"]),
        )
    register_vector(conn)
    return conn


def _embedding_client() -> OpenAI:
    key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if not key:
        raise RuntimeError("OPENAI_API_KEY lipsă (necesară pentru căutarea semantică)")
    return OpenAI(api_key=key)


def _vector_literal(vec: list[float]) -> str:
    if len(vec) != EMBED_DIM:
        raise ValueError(f"Embedding dimensiune {len(vec)}, așteptat {EMBED_DIM}")
    parts = [x if isinstance(x, (int, float)) and not (x != x) else 0.0 for x in vec]
    return "[" + ",".join(str(p) for p in parts) + "]"


def _embed_query(text: str) -> list[float]:
    t = (text or "").strip()[:MAX_INPUT_CHARS]
    if not t:
        raise ValueError("semantic_query gol")
    client = _embedding_client()
    r = client.embeddings.create(model=EMBED_MODEL, input=t)
    emb = r.data[0].embedding
    if not isinstance(emb, list) or len(emb) != EMBED_DIM:
        raise RuntimeError("Răspuns embeddings invalid")
    return [float(x) for x in emb]


def _allowed_niches_from_env() -> list[str]:
    raw = (os.environ.get("PG_VECTOR_ALLOWED_NICHES") or "").strip()
    if not raw:
        return ["petshop", "tech", "generic", "it", "auto"]
    return [x.strip().lower() for x in raw.split(",") if x.strip()]


def _vector_limit() -> int:
    raw = (os.environ.get("PG_VECTOR_MATCH_LIMIT") or "").strip()
    try:
        n = int(raw, 10) if raw else 24
    except ValueError:
        n = 24
    return max(5, min(100, n))


def hybrid_search_stock(
    *,
    semantic_query: str,
    category_contains: str | None = None,
    price_min: float | None = None,
    price_max: float | None = None,
    limit: int | None = None,
    conn: Any | None = None,
) -> list[dict[str, Any]]:
    """
    O singură intrare pentru agent: căutare semantică (cosine distance pe `embedding`)
    combinată cu filtre SQL opționale pe categorie (LIKE) și preț (parsare din text).

    Returnează liste de dict-uri serializabile JSON (id, name, brand, price, category,
    niche_type, image_url, affiliate_url, descrieri scurtate, vector_distance).
    """
    own_conn = conn is None
    if own_conn:
        conn = _pg_connect()
    try:
        emb = _embed_query(semantic_query)
        vec_lit = _vector_literal(emb)
        niches = _allowed_niches_from_env()
        k = limit if limit is not None else _vector_limit()
        k = max(1, min(100, int(k)))

        cols = (
            "id, provider_id, feed_id, name, brand, price, category, niche_type, "
            "image_url, affiliate_url, description, shipping_info"
        )

        wheres: list[str] = [
            "embedding IS NOT NULL",
            "LOWER(TRIM(COALESCE(niche_type, ''))) = ANY(%s::text[])",
        ]
        params: list[Any] = [niches]

        if category_contains and category_contains.strip():
            wheres.append("LOWER(COALESCE(category, '')) LIKE %s")
            params.append(f"%{category_contains.strip().lower()}%")

        price_sql = _PRICE_NUM_SQL.strip()
        if price_min is not None:
            wheres.append(f"({price_sql}) >= %s")
            params.append(float(price_min))
        if price_max is not None:
            wheres.append(f"({price_sql}) <= %s")
            params.append(float(price_max))

        # Primul și ultimul %s = același vector (distanță + ORDER BY)
        sql = f"""
SELECT {cols}, (embedding <=> %s::vector) AS vector_distance
FROM products
WHERE {" AND ".join(wheres)}
ORDER BY embedding <=> %s::vector ASC NULLS LAST
LIMIT {k}
""".strip()
        exec_params: list[Any] = [vec_lit, *params, vec_lit]

        with conn.cursor() as cur:
            cur.execute(sql, exec_params)
            colnames = [d[0] for d in cur.description]
            rows = cur.fetchall()

        out: list[dict[str, Any]] = []
        for tup in rows:
            row = dict(zip(colnames, tup))
            vd = row.get("vector_distance")
            if hasattr(vd, "__float__"):
                row["vector_distance"] = float(vd)
            desc = (row.get("description") or "") if isinstance(row.get("description"), str) else ""
            if len(desc) > 800:
                row["description"] = desc[:799] + "…"
            out.append(row)
        return out
    finally:
        if own_conn and conn is not None:
            conn.close()


def dispatch_search_stock_tool(arguments_json: str) -> str:
    """
    Parsare args din tool call DeepSeek/OpenAI → `hybrid_search_stock` → JSON string pentru mesaj tool.
    """
    import json

    try:
        args = json.loads(arguments_json or "{}")
    except json.JSONDecodeError:
        return json.dumps({"error": "invalid_json_arguments", "products": []})

    if not isinstance(args, dict):
        return json.dumps({"error": "arguments_not_object", "products": []})

    q = args.get("semantic_query")
    if not isinstance(q, str) or not q.strip():
        return json.dumps({"error": "missing_semantic_query", "products": []})

    cat = args.get("category_contains")
    pmin = args.get("price_min")
    pmax = args.get("price_max")
    lim = args.get("limit")

    def opt_float(v: Any) -> float | None:
        if v is None:
            return None
        if isinstance(v, (int, float)):
            return float(v)
        return None

    try:
        products = hybrid_search_stock(
            semantic_query=q.strip(),
            category_contains=cat.strip() if isinstance(cat, str) and cat.strip() else None,
            price_min=opt_float(pmin),
            price_max=opt_float(pmax),
            limit=int(lim) if isinstance(lim, int) or (isinstance(lim, float) and lim == int(lim)) else None,
        )
        return json.dumps({"ok": True, "count": len(products), "products": products}, ensure_ascii=False)
    except Exception as e:  # noqa: BLE001 — răspuns tool trebuie să nu rupă bucla
        return json.dumps({"ok": False, "error": str(e), "products": []}, ensure_ascii=False)

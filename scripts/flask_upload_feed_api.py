#!/usr/bin/env python3
"""
API Flask minimal: încarcă XML → `data/uploads/` → rulează `import_products_xml_to_pg.py`.

Dependențe:
  pip install -r requirements-upload-api.txt
  (include flask-cors — CORS pentru orice origine la testare locală)

Pornire (PC remote / local):
  set UPLOAD_FEED_PORT=5050
  python scripts/flask_upload_feed_api.py

POST multipart /admin/upload-feed — câmpuri: `file` sau `xml`, opțional `niche` (slug → `--niche`, implicit petshop).
DELETE /admin/feed/<nisa> — șterge din Postgres: DELETE FROM products WHERE niche_type = <nisa>.

Variabile PG (ca la import): PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import psycopg2
from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.utils import secure_filename

ROOT = Path(__file__).resolve().parent.parent
UPLOAD_DIR = ROOT / "data" / "uploads"
IMPORT_SCRIPT = ROOT / "scripts" / "import_products_xml_to_pg.py"

NICHE_SLUG_RE = re.compile(r"^[a-zA-Z0-9_-]{1,48}$")

DEFAULT_PG = {
    "host": "localhost",
    "port": 5432,
    "user": "postgres",
    "password": "password123",
    "dbname": "postgres",
}

app = Flask(__name__)
CORS(
    app,
    origins="*",
    allow_headers=["Content-Type", "X-Upload-Token"],
    methods=["GET", "POST", "DELETE", "OPTIONS"],
)
app.config["MAX_CONTENT_LENGTH"] = int(
    os.environ.get("UPLOAD_FEED_MAX_BYTES", str(100 * 1024 * 1024))
)


def _check_upload_token() -> bool:
    token = os.environ.get("UPLOAD_FEED_TOKEN", "").strip()
    if not token:
        return True
    got = request.headers.get("X-Upload-Token", "").strip()
    return got == token


def _niche_slug(raw: str) -> str | None:
    t = (raw or "").strip()
    if not NICHE_SLUG_RE.match(t):
        return None
    return t[:48]


def pg_connect() -> Any:
    return psycopg2.connect(
        host=os.environ.get("PGHOST", DEFAULT_PG["host"]),
        port=int(os.environ.get("PGPORT", str(DEFAULT_PG["port"]))),
        user=os.environ.get("PGUSER", DEFAULT_PG["user"]),
        password=os.environ.get("PGPASSWORD", DEFAULT_PG["password"]),
        dbname=os.environ.get("PGDATABASE", DEFAULT_PG["dbname"]),
    )


@app.get("/health")
def health():
    return jsonify(ok=True, service="upload-feed")


@app.route("/admin/feed/<nisa>", methods=["DELETE", "OPTIONS"])
def admin_delete_feed_by_niche(nisa: str):
    if request.method == "OPTIONS":
        return "", 204
    if not _check_upload_token():
        return jsonify(ok=False, message="Neautorizat (token lipsă sau invalid)."), 401

    niche = _niche_slug(nisa)
    if niche is None:
        return jsonify(ok=False, message="Nișă invalidă în URL (1–48 caractere: litere, cifre, _, -)."), 400

    try:
        conn = pg_connect()
    except Exception as e:
        return jsonify(ok=False, message="Nu mă pot conecta la PostgreSQL.", detail=str(e)), 502

    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM products WHERE niche_type = %s", (niche,))
            deleted = cur.rowcount
        conn.commit()
    except Exception as e:
        conn.rollback()
        return jsonify(ok=False, message="Eroare la ștergere.", detail=str(e)), 500
    finally:
        conn.close()

    return jsonify(
        ok=True,
        message=f"Șterse {deleted} produse cu niche_type={niche!r}.",
        niche=niche,
        deleted=deleted,
    )


@app.route("/admin/upload-feed", methods=["POST", "OPTIONS"])
def admin_upload_feed():
    if request.method == "OPTIONS":
        return "", 204
    if not _check_upload_token():
        return jsonify(ok=False, message="Neautorizat (token lipsă sau invalid)."), 401

    if "file" not in request.files and "xml" not in request.files:
        return (
            jsonify(ok=False, message='Lipsește fișierul: folosește câmpul formular «file» sau «xml».'),
            400,
        )

    f = request.files.get("file") or request.files.get("xml")
    if f is None or f.filename == "":
        return jsonify(ok=False, message="Niciun fișier selectat."), 400

    niche_raw = (request.form.get("niche") or "").strip()
    if not niche_raw:
        niche_raw = "petshop"
    niche_ok = _niche_slug(niche_raw)
    if niche_ok is None:
        return jsonify(ok=False, message="Câmpul «niche» invalid (slug 1–48: litere, cifre, _, -)."), 400

    raw_name = secure_filename(f.filename)
    if not raw_name.lower().endswith(".xml"):
        return jsonify(ok=False, message="Se acceptă doar fișiere .xml."), 400

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    dest = UPLOAD_DIR / raw_name
    if dest.exists():
        dest = UPLOAD_DIR / f"{int(time.time())}_{raw_name}"

    f.save(dest)

    if not IMPORT_SCRIPT.is_file():
        return (
            jsonify(
                ok=False,
                message="Feed salvat, dar scriptul de import lipsește.",
                saved_path=str(dest.relative_to(ROOT)),
            ),
            500,
        )

    timeout_s = int(os.environ.get("UPLOAD_FEED_IMPORT_TIMEOUT", str(3600)))
    cmd = [sys.executable, str(IMPORT_SCRIPT), str(dest), "--niche", niche_ok]
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
    except subprocess.TimeoutExpired as e:
        return (
            jsonify(
                {
                    "ok": False,
                    "message": f"Import oprit după timeout ({timeout_s}s).",
                    "saved_path": str(dest.relative_to(ROOT)),
                    "niche": niche_ok,
                    "import": {"returncode": None, "stdout": "", "stderr": str(e)},
                }
            ),
            504,
        )

    ok = proc.returncode == 0
    tail = 8000
    body = {
        "ok": ok,
        "niche": niche_ok,
        "message": (
            "Feed salvat și importul în PostgreSQL s-a încheiat cu succes."
            if ok
            else "Feed salvat; importul a returnat cod de eroare (vezi «import»)."
        ),
        "saved_path": str(dest.relative_to(ROOT)).replace("\\", "/"),
        "import": {
            "returncode": proc.returncode,
            "stdout": (proc.stdout or "")[-tail:],
            "stderr": (proc.stderr or "")[-tail:],
        },
    }
    return jsonify(body), 200 if ok else 502


def main() -> None:
    host = os.environ.get("UPLOAD_FEED_HOST", "0.0.0.0")
    port = int(os.environ.get("UPLOAD_FEED_PORT", "5050"))
    debug = os.environ.get("UPLOAD_FEED_DEBUG", "").lower() in ("1", "true", "yes")
    app.run(host=host, port=port, debug=debug, use_reloader=False)


if __name__ == "__main__":
    main()

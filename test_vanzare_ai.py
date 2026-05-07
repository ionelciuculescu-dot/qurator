import os
import sys
from pathlib import Path

import openai


def safe_print(text: str) -> None:
    enc = sys.stdout.encoding or "utf-8"
    try:
        sys.stdout.write(text.encode(enc, errors="replace").decode(enc) + "\n")
    except (LookupError, UnicodeError):
        sys.stdout.write(text.encode("ascii", errors="replace").decode("ascii") + "\n")

_ROOT = Path(__file__).resolve().parent


def load_env_local() -> None:
    """Încarcă variabile din `.env.local` (aceleași nume ca la Next.js), fără a suprascrie env deja setat."""
    path = _ROOT / ".env.local"
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
            val = val[1:-1]
        if key and key not in os.environ:
            os.environ[key] = val


load_env_local()

# Simulam datele "furate" de DuckDuckGo la testul anterior
snippets_test = [
    "Reddit: I'm needing some advice and opinions regarding Purina Dog Chow. Many owners say it's a solid budget option.",
    "DogFoodAdvisor: Purina Puppy Chow Dry - independent review, star rating and recall history. It's a complete and balanced diet.",
    "Dogcaress: Its proven track record and affordability give you excellent value, matching high-quality ingredients with competitive pricing.",
]


def genereaza_recenzie_ai(nume_produs, snippets):
    api_key = (os.environ.get("DEEPSEEK_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError(
            "Lipseste DEEPSEEK_API_KEY. Adauga-o in .env.local (la fel ca pentru aplicatia Next.js)."
        )

    client = openai.OpenAI(
        api_key=api_key,
        base_url="https://api.deepseek.com",
    )

    snippets_text = "\n".join(f"- {s}" for s in snippets)
    prompt = f"""
    Ești un asistent expert în vânzări de produse pentru animale (Petshop).
    Produsul analizat: {nume_produs}

    Iată datele extrase de pe forumuri și site-uri internaționale:
    {snippets_text}

    Sarcina ta:
    1. Tradu și sintetizează informațiile în limba română.
    2. Creează un text de vânzare convingător, dar onest.
    3. Scoate în evidență raportul calitate-preț (affordability).
    4. Menționează că este o alegere validată la nivel global.

    Stil: Prietenos, informativ, maxim 3 paragrafe.
    """

    response = client.chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "user", "content": prompt}],
    )

    return response.choices[0].message.content


if __name__ == "__main__":
    print("--- GENERARE RECENZIE AI ---")
    out = genereaza_recenzie_ai("Purina Dog Chow Junior Miel", snippets_test)
    if out:
        safe_print(out)

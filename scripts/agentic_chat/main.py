#!/usr/bin/env python3
"""
Buclă REPL: DeepSeek cu tool calling; `search_stock` → `db_manager.hybrid_search_stock` doar când modelul cere.

Variabile de mediu:
  DEEPSEEK_API_KEY — obligatoriu (sau OPENAI_API_KEY dacă setezi doar una; vezi cod)
  OPENAI_API_KEY — pentru embedding la căutare semantică
  DATABASE_URL sau PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE

Dependențe: vezi `scripts/requirements-agentic-chat.txt`

Pornire (manual):
  set DEEPSEEK_API_KEY=sk-...
  set OPENAI_API_KEY=sk-...
  python scripts/agentic_chat/main.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from openai import OpenAI

# Rulare: `python scripts/agentic_chat/main.py` din rădăcina repo — adaugă `scripts/` pe path.
_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from agentic_chat.agent_config import DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, SEARCH_STOCK_TOOL, SYSTEM_PROMPT
from agentic_chat.db_manager import dispatch_search_stock_tool


def _deepseek_client() -> OpenAI:
    key = (os.environ.get("DEEPSEEK_API_KEY") or "").strip()
    if not key:
        print("Lipsește DEEPSEEK_API_KEY pentru chat completions.", file=sys.stderr)
        sys.exit(1)
    return OpenAI(api_key=key, base_url=DEEPSEEK_BASE_URL)


def _assistant_message_dict(msg: Any) -> dict[str, Any]:
    """Transformă mesajul din răspunsul SDK într-un dict compatibil `messages` pentru tură următoare."""
    d: dict[str, Any] = {"role": "assistant", "content": msg.content or ""}
    tcs = getattr(msg, "tool_calls", None)
    if tcs:
        d["tool_calls"] = []
        for tc in tcs:
            fn = getattr(tc, "function", None)
            d["tool_calls"].append(
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": fn.name if fn else "",
                        "arguments": fn.arguments if fn else "{}",
                    },
                }
            )
    return d


def run_turn(client: OpenAI, messages: list[dict[str, Any]], max_tool_rounds: int = 6) -> str:
    """
    Apelează modelul până la final text sau până se epuizează runde de tool (siguranță).
    """
    rounds = 0
    while rounds < max_tool_rounds:
        rounds += 1
        resp = client.chat.completions.create(
            model=DEEPSEEK_MODEL,
            messages=messages,
            tools=[SEARCH_STOCK_TOOL],
            tool_choice="auto",
        )
        msg = resp.choices[0].message
        tcs = getattr(msg, "tool_calls", None) or []

        if not tcs:
            text = (msg.content or "").strip()
            messages.append({"role": "assistant", "content": text})
            return text

        messages.append(_assistant_message_dict(msg))
        for tc in tcs:
            fn = getattr(tc, "function", None)
            name = fn.name if fn else ""
            raw_args = fn.arguments if fn else "{}"
            if name == "search_stock":
                payload = dispatch_search_stock_tool(raw_args)
            else:
                payload = json.dumps({"ok": False, "error": f"unknown_tool:{name}", "products": []})
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": payload})

    return "Am oprit după prea multe apeluri de tool-uri; reformulează te rog cererea."


def main() -> int:
    client = _deepseek_client()
    messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    print("Agent catalog (DeepSeek + search_stock). Ctrl+C sau linie goală = ieșire.\n")
    while True:
        try:
            line = input("Tu> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not line:
            break
        messages.append({"role": "user", "content": line})
        reply = run_turn(client, messages)
        print(f"Agent> {reply}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

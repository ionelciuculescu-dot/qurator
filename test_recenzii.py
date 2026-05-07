from duckduckgo_search import DDGS

_JUNK_URL_SUBSTRINGS = ("dictionary", "wiki", "translate")


def url_is_filtered_out(href: str) -> bool:
    """True dacă URL-ul e considerat nefolositor (wiki, dicționare, translate)."""
    if not href:
        return True
    h = href.lower()
    return any(s in h for s in _JUNK_URL_SUBSTRINGS)


def test_enrichment(product_name):
    print(f"--- Căutăm recenzii pentru: {product_name} ---")
    
    # 1. Definim căutările: RO simplu + brand fix + echivalent EN (Puppy ~ Junior)
    queries = [
        f"{product_name} pareri",  # Mai simplu, fara forum
        "Purina Dog Chow Junior review reddit",  # Folosim brandul, e mai sigur
        "Dog Chow Puppy food reviews",  # Puppy e echivalentul global pentru Junior
    ]
    
    all_snippets = []
    
    with DDGS() as ddgs:
        for q in queries:
            print(f"Executăm căutarea: {q}...")
            # Luăm primele 4 rezultate pentru fiecare interogare
            results = ddgs.text(q, region='wt-wt', safesearch='off', max_results=4)
            
            for r in results:
                href = r.get("href") or ""
                if url_is_filtered_out(href):
                    continue
                # Curățăm puțin snippet-ul (scoatem spații inutile)
                clean_snippet = " ".join(r["body"].split())
                all_snippets.append(
                    {
                        "title": r["title"],
                        "text": clean_snippet,
                        "source": href,
                    }
                )

    # 2. Afișăm ce am găsit (materia primă pentru DeepSeek)
    if all_snippets:
        print(f"\nAm găsit {len(all_snippets)} fragmente relevante:")
        for idx, s in enumerate(all_snippets):
            print(f"\n[{idx+1}] SURSA: {s['source']}")
            print(f"TEXT: {s['text'][:200]}...") # Afișăm doar începutul pentru claritate
    else:
        print("Nu am găsit nicio informație externă.")
    
    return all_snippets

# Rulăm testul pentru un produs din magazia ta
produs_test = "Dog Chow Junior Miel"
date_brute = test_enrichment(produs_test)

# 3. Simulare pentru ce va vedea DeepSeek (Echilibrul de tokeni)
context_ai = "\n".join([f"- {item['text']}" for item in date_brute])
print(f"\n--- TOTAL CARACTERE PENTRU AI: {len(context_ai)} ---")

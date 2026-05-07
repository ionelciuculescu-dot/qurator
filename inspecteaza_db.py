import sqlite3
from pathlib import Path


def cale_db():
    return Path(__file__).resolve().parent / "data" / "catalog.db"


def inspecteaza():
    db_path = cale_db()
    if not db_path.is_file():
        print(f"Nu exista fisierul: {db_path}")
        return

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        print(f"Baza de date: {db_path}\n")

        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
        )
        tabele = [r[0] for r in cursor.fetchall()]

        if not tabele:
            print("Nu exista tabele user-defined.")
            conn.close()
            return

        for nume_tabel in tabele:
            cursor.execute(f'PRAGMA table_info("{nume_tabel}")')
            randuri = cursor.fetchall()
            # PRAGMA table_info: cid, name, type, notnull, dflt_value, pk
            print(f"Tabel: {nume_tabel}")
            for cid, nume, tip, notnull, dflt, pk in randuri:
                pk_txt = " [PK]" if pk else ""
                null_txt = " NOT NULL" if notnull else ""
                print(f"  - {nume} ({tip}){pk_txt}{null_txt}")
            print()

        conn.close()
    except Exception as e:
        print(f"Eroare: {e}")


if __name__ == "__main__":
    inspecteaza()

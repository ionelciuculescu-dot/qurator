import { readFile } from "node:fs/promises";
import path from "node:path";

import { applyNicheFiltersToParsedProducts } from "@/shared/filters/catalog-niche-filter-factory";
import { normalizeSearchText } from "@/shared/filters/generic-logic";
import type { ParsedProduct } from "@/shared/models/product";
import type { CatalogListOptions, CatalogReader } from "@/shared/ports/catalog-reader";

export const ESSENTIALS_JSON_RELATIVE = "data/produse_esentiale.json";

export function essentialsJsonAbsolutePath(): string {
  return path.join(process.cwd(), ESSENTIALS_JSON_RELATIVE);
}

type EssentialsJsonRow = {
  title?: string;
  price?: string;
  affiliateLink?: string;
};

/** Structura fișierului `produse_esentiale.json` (obiect cu cheia `products`). */
type EssentialsJsonFile = {
  products?: unknown;
  updatedAt?: string;
  sourceUrl?: string;
};

function rowToParsedProduct(row: EssentialsJsonRow): ParsedProduct | null {
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const affiliateLink = typeof row.affiliateLink === "string" ? row.affiliateLink.trim() : "";
  if (!title || !affiliateLink) return null;
  const price = typeof row.price === "string" ? row.price.trim() : "";
  return {
    title,
    price,
    affiliateLink,
    image: "",
    description: "",
  };
}

/**
 * Citește catalogul din `data/produse_esentiale.json` (scris de pipeline-ul de ingestiune).
 * Implementare a portului `CatalogReader` — fără XML.
 */
export class JsonCatalogReader implements CatalogReader {
  async listProducts(options?: CatalogListOptions): Promise<ParsedProduct[]> {
    const filePath = essentialsJsonAbsolutePath();
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? (e as NodeJS.ErrnoException).code : "";
      if (code === "ENOENT") return [];
      throw e;
    }
    if (!raw.trim()) return [];

    let jsonData: EssentialsJsonFile;
    try {
      jsonData = JSON.parse(raw) as EssentialsJsonFile;
    } catch {
      return [];
    }

    if (!jsonData || typeof jsonData !== "object") return [];

    const rawList = jsonData.products || [];
    const allProducts = Array.isArray(rawList) ? rawList : [];

    const out: ParsedProduct[] = [];
    for (const row of allProducts) {
      if (!row || typeof row !== "object") continue;
      const p = rowToParsedProduct(row as EssentialsJsonRow);
      if (p) out.push(p);
    }
    let filtered = applyNicheFiltersToParsedProducts(out, {
      userMessage: options?.refineForUserMessage,
    });
    const restrict = options?.restrictToCategoryContains?.trim();
    if (restrict) {
      const needle = normalizeSearchText(restrict);
      filtered = filtered.filter((p) =>
        needle.length > 0 ? normalizeSearchText(`${p.category ?? ""} ${p.title}`).includes(needle) : true
      );
    }
    const anchor = options?.speciesSqlAnchor;
    if (anchor === "caine") {
      filtered = filtered.filter((p) =>
        normalizeSearchText(`${p.title} ${p.description}`).includes("caine")
      );
    } else if (anchor === "pisica") {
      filtered = filtered.filter((p) =>
        normalizeSearchText(`${p.title} ${p.description}`).includes("pisic")
      );
    }
    return filtered;
  }
}

import type { PostgresCatalogReader } from "@/sales/adapters/postgres-catalog-reader";
import { cleanParsedProductForLLM } from "@/sales/lib/cleanProductForLLM";
import type { ParsedProduct } from "@/shared/models/product";

export type SearchStockToolResult = {
  ok: boolean;
  count: number;
  products: ReturnType<typeof cleanParsedProductForLLM>[];
  /** Pentru carduri UI — aceeași ordine ca `products`. */
  rawProducts?: ParsedProduct[];
  error?: string;
};

export type SearchStockRequestContext = {
  /** Din corpul `POST /api/chat` (mall raion) — restrânge `niche_type` în Postgres. */
  activeMallNiche?: string | null;
};

/**
 * Execută tool-ul `search_stock`: parsează JSON-ul din `function.arguments` și apelează căutarea hibridă.
 */
export async function executeSearchStockTool(
  reader: PostgresCatalogReader,
  argumentsJson: string,
  requestContext?: SearchStockRequestContext
): Promise<SearchStockToolResult> {
  let args: unknown;
  try {
    args = JSON.parse(argumentsJson || "{}");
  } catch {
    return { ok: false, count: 0, products: [], error: "invalid_json_arguments" };
  }
  if (!args || typeof args !== "object") {
    return { ok: false, count: 0, products: [], error: "arguments_not_object" };
  }
  const o = args as Record<string, unknown>;
  const q = o.semantic_query;
  if (typeof q !== "string" || !q.trim()) {
    return { ok: false, count: 0, products: [], error: "missing_semantic_query" };
  }

  const category = o.category_contains;
  const lim = o.limit;
  const parsedLimit =
    typeof lim === "number" && Number.isFinite(lim) ? Math.floor(lim) : undefined;

  const priceMin = typeof o.price_min === "number" && Number.isFinite(o.price_min) ? o.price_min : undefined;
  const priceMax = typeof o.price_max === "number" && Number.isFinite(o.price_max) ? o.price_max : undefined;

  try {
    const raw: ParsedProduct[] = await reader.hybridAgentSearch({
      semanticQuery: q.trim(),
      categoryContains: typeof category === "string" && category.trim() ? category.trim() : undefined,
      priceMin,
      priceMax,
      limit: parsedLimit,
      activeMallNiche: requestContext?.activeMallNiche?.trim() || undefined,
    });
    const products = raw.map(cleanParsedProductForLLM);
    return { ok: true, count: products.length, products, rawProducts: raw };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, count: 0, products: [], error: msg };
  }
}

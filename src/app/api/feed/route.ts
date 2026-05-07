import { JsonCatalogReader } from "@/ingestion/catalog/json-catalog-reader";
import { buildChatProductContext } from "@/sales/chat/build-context";
import { STORE_FEED_AI_LIMIT } from "@/shared/constants/limits";
import { NextResponse } from "next/server";

/**
 * Returnează produse din `produse_esentiale.json` (deja generate de refresh-ul de feed).
 * Nu descarcă sau parsează XML — doar citire de pe disc.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const query = typeof body?.query === "string" ? body.query : undefined;

    const reader = new JsonCatalogReader();
    const all = await reader.listProducts();
    const products = buildChatProductContext(all, query, STORE_FEED_AI_LIMIT);
    return NextResponse.json({ products });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Eroare feed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

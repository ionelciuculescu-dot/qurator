import { verifyAdminRequest } from "@/lib/adminAuth";
import { recordFeedRefresh } from "@/lib/adminStore";
import { fetchFeed } from "@/ingestion/feed/fetchFeed";
import { JsonCatalogReader } from "@/ingestion/catalog/json-catalog-reader";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Actualizare XML (streaming) + rescriere `produse_esentiale.json` — nu e declanșată de chatul public. */
export async function POST(req: NextRequest) {
  if (!verifyAdminRequest(req.headers.get("cookie"))) {
    return NextResponse.json({ error: "Neautorizat" }, { status: 401 });
  }
  try {
    await fetchFeed();
    const catalogSize = (await new JsonCatalogReader().listProducts()).length;
    await recordFeedRefresh({ ok: true, productCount: catalogSize });
    return NextResponse.json({
      ok: true,
      productCount: catalogSize,
      at: new Date().toISOString(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordFeedRefresh({ ok: false, error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

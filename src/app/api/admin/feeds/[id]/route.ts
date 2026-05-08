import { verifyAdminRequest } from "@/lib/adminAuth";
import { deleteFeedConfig, getFeedConfigById } from "@/lib/feedConfigsDb";
import { buildAppPgPoolConfig } from "@/lib/pgPoolConfig";
import { Pool } from "pg";
import { NextRequest, NextResponse } from "next/server";

import { CATALOG_PRODUCTS_TABLE } from "@/shared/sql/catalog-queries";

export const dynamic = "force-dynamic";

/**
 * DELETE: implicit doar rândul din `public.feed_configs` (Supabase).
 * `?cascade=true`: mai întâi șterge din Postgres `products` după `provider_id` al feed-ului, apoi feed-ul.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!verifyAdminRequest(req.headers.get("cookie"))) {
    return NextResponse.json({ error: "Neautorizat" }, { status: 401 });
  }
  const { id: idStr } = await ctx.params;
  const id = parseInt(String(idStr).trim(), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "ID invalid" }, { status: 400 });
  }
  const cascade = ["1", "true", "yes"].includes(req.nextUrl.searchParams.get("cascade")?.trim().toLowerCase() ?? "");

  try {
    if (cascade) {
      const row = await getFeedConfigById(id);
      if (!row) {
        return NextResponse.json({ error: "Feed inexistent" }, { status: 404 });
      }
      const providerId = (row.provider_id || "generic").trim() || "generic";
      const pool = new Pool(buildAppPgPoolConfig({ max: 2 }));
      let deleted = 0;
      try {
        const r = await pool.query(`DELETE FROM ${CATALOG_PRODUCTS_TABLE} WHERE provider_id = $1`, [providerId]);
        deleted = r.rowCount ?? 0;
      } finally {
        await pool.end().catch(() => {});
      }
      const ok = await deleteFeedConfig(id);
      if (!ok) return NextResponse.json({ error: "Feed inexistent după ștergere produse" }, { status: 404 });
      return NextResponse.json({ ok: true, cascade: true, deletedProducts: deleted });
    }

    const ok = await deleteFeedConfig(id);
    if (!ok) return NextResponse.json({ error: "Feed inexistent" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Eroare ștergere";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

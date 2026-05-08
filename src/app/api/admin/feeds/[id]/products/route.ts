import { verifyAdminRequest } from "@/lib/adminAuth";
import { getFeedConfigById } from "@/lib/feedConfigsDb";
import { buildAppPgPoolConfig } from "@/lib/pgPoolConfig";
import { Pool } from "pg";
import { NextRequest, NextResponse } from "next/server";

import { CATALOG_PRODUCTS_TABLE } from "@/shared/sql/catalog-queries";

export const dynamic = "force-dynamic";

/**
 * DELETE: șterge din Postgres/Supabase (`products`) toate rândurile cu `provider_id` egal cu cel al feed-ului din config.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!verifyAdminRequest(_req.headers.get("cookie"))) {
    return NextResponse.json({ error: "Neautorizat" }, { status: 401 });
  }
  const { id: idStr } = await ctx.params;
  const id = parseInt(String(idStr).trim(), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "ID invalid" }, { status: 400 });
  }
  const row = await getFeedConfigById(id);
  if (!row) {
    return NextResponse.json({ error: "Feed inexistent" }, { status: 404 });
  }
  const providerId = (row.provider_id || "generic").trim() || "generic";

  const pool = new Pool(buildAppPgPoolConfig({ max: 2 }));
  try {
    const r = await pool.query(`DELETE FROM ${CATALOG_PRODUCTS_TABLE} WHERE provider_id = $1`, [providerId]);
    const deleted = r.rowCount ?? 0;
    return NextResponse.json({ ok: true, deleted, provider_id: providerId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Eroare Postgres";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}

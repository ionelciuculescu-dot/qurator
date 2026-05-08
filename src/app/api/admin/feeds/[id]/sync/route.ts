import { verifyAdminRequest } from "@/lib/adminAuth";
import { recordFeedRefresh } from "@/lib/adminStore";
import { getFeedConfigById } from "@/lib/feedConfigsDb";
import { buildAppPgPoolConfig } from "@/lib/pgPoolConfig";
import { streamFeedFromFeedConfig } from "@/ingestion/catalog/sync-feed-from-config";
import { Pool } from "pg";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function totalProductCountPostgres(): Promise<number> {
  const pool = new Pool(buildAppPgPoolConfig({ max: 2 }));
  try {
    const r = await pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM public.products`);
    return parseInt(r.rows[0]?.c ?? "0", 10) || 0;
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!verifyAdminRequest(req.headers.get("cookie"))) {
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
  /** Sync manual din admin: permis și pentru feed inactiv (CLI rămâne doar cu `is_active=1`). */
  try {
    const result = await streamFeedFromFeedConfig(row);
    const total = await totalProductCountPostgres();
    await recordFeedRefresh({
      ok: true,
      productCount: total,
    });
    return NextResponse.json({
      ok: true,
      result,
      catalogTotalProducts: total,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordFeedRefresh({ ok: false, error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

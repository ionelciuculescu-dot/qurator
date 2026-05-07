import { verifyAdminRequest } from "@/lib/adminAuth";
import { recordFeedRefresh } from "@/lib/adminStore";
import { getFeedConfigById } from "@/lib/feedConfigsDb";
import { streamFeedFromFeedConfig } from "@/ingestion/catalog/sync-feed-from-config";
import Database from "better-sqlite3";
import { NextRequest, NextResponse } from "next/server";

import { catalogSqliteFilePath } from "@/shared/db/catalog-sqlite-path";
import { CATALOG_PRODUCTS_TABLE } from "@/shared/sql/catalog-queries";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function totalProductCount(): number {
  const db = new Database(catalogSqliteFilePath(), { readonly: true });
  db.pragma("busy_timeout = 15000");
  try {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${CATALOG_PRODUCTS_TABLE}`).get() as { c: number };
    return Number(row.c);
  } finally {
    db.close();
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
  const row = getFeedConfigById(id);
  if (!row) {
    return NextResponse.json({ error: "Feed inexistent" }, { status: 404 });
  }
  /** Sync manual din admin: permis și pentru feed inactiv (CLI rămâne doar cu `is_active=1`). */
  try {
    const result = await streamFeedFromFeedConfig(row);
    const total = totalProductCount();
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

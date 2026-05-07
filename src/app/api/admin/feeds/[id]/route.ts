import { verifyAdminRequest } from "@/lib/adminAuth";
import { deleteFeedConfig } from "@/lib/feedConfigsDb";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!verifyAdminRequest(_req.headers.get("cookie"))) {
    return NextResponse.json({ error: "Neautorizat" }, { status: 401 });
  }
  const { id: idStr } = await ctx.params;
  const id = parseInt(String(idStr).trim(), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "ID invalid" }, { status: 400 });
  }
  try {
    const ok = deleteFeedConfig(id);
    if (!ok) return NextResponse.json({ error: "Feed inexistent" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Eroare ștergere";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

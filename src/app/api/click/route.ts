import { appendClick } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Redirect 302 către URL-ul afiliat din `url`.
 * `NextRequest.nextUrl.searchParams` decodifică deja o dată valorile — nu apelăm `decodeURIComponent`
 * pe întregul `url` (poate conține `%` valizi în query-ul țintă și ar strica linkul).
 */
export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url");
  if (!rawUrl || !rawUrl.trim()) {
    return NextResponse.json({ error: "Parametrul url lipsește" }, { status: 400 });
  }

  const trimmed = rawUrl.trim();

  let target: URL;
  try {
    target = new URL(trimmed);
  } catch {
    try {
      target = new URL(decodeURIComponent(trimmed));
    } catch {
      return NextResponse.json({ error: "URL invalid" }, { status: 400 });
    }
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json({ error: "Protocol nepermis" }, { status: 400 });
  }

  const cid = req.nextUrl.searchParams.get("cid");
  let produs = "";
  const pRaw = req.nextUrl.searchParams.get("produs");
  if (pRaw) {
    produs = pRaw.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 600);
  }

  await appendClick({
    conversationId: cid && cid.trim() ? cid.trim() : null,
    produs,
    url: target.href,
  }).catch(() => {});

  return NextResponse.redirect(target.href, 302);
}

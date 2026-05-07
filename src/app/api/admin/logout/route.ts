import { buildAdminSessionClearCookie } from "@/lib/adminAuth";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", buildAdminSessionClearCookie());
  return res;
}

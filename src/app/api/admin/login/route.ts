import { buildAdminSessionSetCookie, createAdminSessionToken } from "@/lib/adminAuth";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const configured = process.env.ADMIN_PASSWORD?.trim();
  if (!configured) {
    return NextResponse.json(
      { error: "Setează ADMIN_PASSWORD în .env.local pentru a activa accesul admin." },
      { status: 503 }
    );
  }

  const body = (await req.json().catch(() => null)) as { password?: string } | null;
  if (typeof body?.password !== "string" || body.password !== configured) {
    return NextResponse.json({ error: "Parolă incorectă" }, { status: 401 });
  }

  const token = createAdminSessionToken();
  if (!token) {
    return NextResponse.json({ error: "Nu s-a putut crea sesiunea" }, { status: 500 });
  }

  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", buildAdminSessionSetCookie(token));
  return res;
}

import { verifyAdminRequest } from "@/lib/adminAuth";
import { getDashboardPayload } from "@/lib/adminStore";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!verifyAdminRequest(req.headers.get("cookie"))) {
    return NextResponse.json({ error: "Neautorizat" }, { status: 401 });
  }
  try {
    const payload = await getDashboardPayload();
    return NextResponse.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Eroare citire dashboard";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
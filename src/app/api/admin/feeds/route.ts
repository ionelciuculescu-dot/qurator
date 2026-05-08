import { verifyAdminRequest } from "@/lib/adminAuth";
import { insertFeedConfig, listFeedConfigsWithProductCounts } from "@/lib/feedConfigsDb";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ALLOWED_NICHES = new Set(["auto", "petshop", "it", "tech", "generic", "bricolaj"]);
const ALLOWED_PROVIDERS = new Set(["generic", "bravapet"]);

export async function GET(_req: NextRequest) {
  if (!verifyAdminRequest(_req.headers.get("cookie"))) {
    return NextResponse.json({ error: "Neautorizat" }, { status: 401 });
  }
  try {
    const feeds = await listFeedConfigsWithProductCounts();
    return NextResponse.json({ feeds });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Eroare citire feed-uri";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!verifyAdminRequest(req.headers.get("cookie"))) {
    return NextResponse.json({ error: "Neautorizat" }, { status: 401 });
  }
  try {
    const body = (await req.json().catch(() => null)) as {
      name?: string;
      url?: string;
      niche?: string;
      provider_id?: string;
      is_active?: boolean | number;
    } | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!name || !url) {
      return NextResponse.json({ error: "Nume și URL sunt obligatorii." }, { status: 400 });
    }
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return NextResponse.json({ error: "URL trebuie să fie http(s)." }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "URL invalid." }, { status: 400 });
    }
    const nicheRaw = typeof body?.niche === "string" ? body.niche.trim().toLowerCase() : "auto";
    const niche = ALLOWED_NICHES.has(nicheRaw) ? nicheRaw : "auto";
    const provRaw = typeof body?.provider_id === "string" ? body.provider_id.trim().toLowerCase() : "generic";
    const provider_id = ALLOWED_PROVIDERS.has(provRaw) ? provRaw : "generic";
    const is_active =
      body?.is_active === false || body?.is_active === 0 ? 0 : 1;

    const row = await insertFeedConfig({ name, url, niche, provider_id, is_active });
    return NextResponse.json({ feed: row });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Eroare salvare";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

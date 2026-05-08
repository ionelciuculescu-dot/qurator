import { verifyAdminRequest } from "@/lib/adminAuth";
import type { CatalogNicheOverride } from "@/ingestion/catalog/niche-filters";
import { streamFeedUrlToSupabase } from "@/ingestion/catalog/stream-to-supabase";
import { essentialFromBravapetProductFlat } from "@/ingestion/providers/bravapet-provider";
import { essentialFromFlat } from "@/ingestion/xml/twoPerformantXmlStream";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
/** Feed-uri mari: embedding + HTTP feed — crește limita pe platforme care o suportă. */
export const maxDuration = 600;

const ALLOWED_NICHES = new Set(["auto", "petshop", "it", "tech", "generic", "bricolaj"]);
const ALLOWED_PROVIDERS = new Set(["generic", "bravapet"]);

function catalogNicheFromBody(niche: string): CatalogNicheOverride | undefined {
  const n = niche.trim().toLowerCase();
  if (!ALLOWED_NICHES.has(n) || n === "auto") return undefined;
  if (n === "petshop" || n === "it" || n === "tech" || n === "generic" || n === "bricolaj") return n;
  return undefined;
}

/**
 * POST: import XML → Supabase/Postgres (streaming + progres NDJSON).
 * Body: `{ url: string, niche: string, provider_id?: "generic"|"bravapet", feed_id?: number|null }`
 */
export async function POST(req: NextRequest) {
  if (!verifyAdminRequest(req.headers.get("cookie"))) {
    return new Response(JSON.stringify({ type: "error", message: "Neautorizat" }) + "\n", {
      status: 401,
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
    });
  }

  const body = (await req.json().catch(() => null)) as {
    url?: string;
    niche?: string;
    provider_id?: string;
    feed_id?: number | null;
  } | null;

  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url) {
    return new Response(JSON.stringify({ type: "error", message: "URL feed obligatoriu." }) + "\n", {
      status: 400,
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
    });
  }
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return new Response(JSON.stringify({ type: "error", message: "URL trebuie să fie http(s)." }) + "\n", {
        status: 400,
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
      });
    }
  } catch {
    return new Response(JSON.stringify({ type: "error", message: "URL invalid." }) + "\n", {
      status: 400,
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
    });
  }

  console.log("API Sync apelat cu URL:", url);

  const nicheRaw = typeof body?.niche === "string" ? body.niche.trim().toLowerCase() : "auto";
  const niche = ALLOWED_NICHES.has(nicheRaw) ? nicheRaw : "auto";
  const catalogNiche = catalogNicheFromBody(niche);

  const provRaw = typeof body?.provider_id === "string" ? body.provider_id.trim().toLowerCase() : "generic";
  const providerId = ALLOWED_PROVIDERS.has(provRaw) ? provRaw : "generic";
  const mapFlat = providerId === "bravapet" ? essentialFromBravapetProductFlat : essentialFromFlat;

  const feedIdRaw = body?.feed_id;
  const feedId =
    feedIdRaw === null || feedIdRaw === undefined
      ? null
      : typeof feedIdRaw === "number" && Number.isFinite(feedIdRaw) && feedIdRaw > 0
        ? Math.floor(feedIdRaw)
        : null;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let streamClosed = false;
      const send = (obj: Record<string, unknown>) => {
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch (err) {
          streamClosed = true;
          console.warn("[sync-supabase] enqueue după închiderea streamului (client Stop / disconnect):", err);
        }
      };
      send({ type: "start", url, niche, providerId, feedId });
      try {
        const result = await streamFeedUrlToSupabase(url, undefined, {
          providerId,
          flatToEssential: mapFlat,
          feedId,
          catalogNiche,
          onProgress: (p) => {
            send({
              type: "progress",
              phase: p.phase,
              totalEssentialMatched: p.totalEssentialMatched,
              queuedForImport: p.queuedForImport,
              skippedByFilter: p.skippedByFilter,
              upserted: p.upserted,
              openaiEmbeddingsCompleted: p.openaiEmbeddingsCompleted,
              skippedContentUnchanged: p.skippedContentUnchanged,
              errors: p.errors,
              errorSamples: p.errorSamples,
            });
          },
        });
        send({ type: "complete", ok: true, result });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        send({ type: "error", message });
      } finally {
        streamClosed = true;
        try {
          controller.close();
        } catch {
          /* */
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

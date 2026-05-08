"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";

const MALL_NICHES = [
  { value: "auto", label: "Auto (inferență din conținut)" },
  { value: "petshop", label: "Petshop" },
  { value: "tech", label: "Tech" },
  { value: "it", label: "IT / electronice" },
  { value: "generic", label: "Generic" },
  { value: "bricolaj", label: "Bricolaj" },
] as const;

const PROVIDERS = [
  { value: "generic", label: "Generic (2Performant / standard)" },
  { value: "bravapet", label: "Bravapet" },
] as const;

type FeedRow = {
  id: number;
  name: string;
  url: string;
  niche: string;
  provider_id: string;
  is_active: number;
  product_count: number;
};

type FeedsPayload = { feeds: FeedRow[] };

type GranularStats = {
  scanEssentials: number;
  filterSkipped: number;
  hashSkipped: number;
  /** Răspunsuri OpenAI embeddings reușite (actualizat imediat după fiecare apel API). */
  embeddingsLive: number;
  /** Rânduri Postgres upsert-uite cu succes după embedding. */
  vectorized: number;
  errors: number;
  errorSamples: string[];
};

type LogEntry = { id: string; text: string };

const emptyGranular = (): GranularStats => ({
  scanEssentials: 0,
  filterSkipped: 0,
  hashSkipped: 0,
  embeddingsLive: 0,
  vectorized: 0,
  errors: 0,
  errorSamples: [],
});

function glassCardClass(): string {
  return [
    "rounded-2xl border border-white/[0.12]",
    "bg-white/[0.06] backdrop-blur-xl backdrop-saturate-150",
    "shadow-[0_8px_32px_rgba(0,0,0,0.45)]",
  ].join(" ");
}

function inputClass(): string {
  return [
    "mt-1.5 w-full rounded-xl border border-white/[0.14]",
    "bg-black/25 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600",
    "outline-none transition",
    "focus:border-violet-400/40 focus:ring-2 focus:ring-violet-500/20",
  ].join(" ");
}

async function feedsFetcher(url: string): Promise<FeedsPayload> {
  const res = await fetch(url, { credentials: "include", cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as FeedsPayload & { error?: string };
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error(data.error ?? "Eroare feed-uri");
  return { feeds: Array.isArray(data.feeds) ? data.feeds : [] };
}

export default function AdminFeedsPage() {
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  const [storeName, setStoreName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [niche, setNiche] = useState<string>("petshop");
  const [providerId, setProviderId] = useState<string>("generic");
  const [formActive, setFormActive] = useState(true);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [granular, setGranular] = useState<GranularStats>(() => emptyGranular());
  const logSeq = useRef(0);
  /** După „Delete Products” reușit, permite „Șterge magazin” (flux: mai întâi PG, apoi config). */
  const [feedsReadyToRemoveStore, setFeedsReadyToRemoveStore] = useState<Set<number>>(() => new Set());
  const syncAbortRef = useRef<AbortController | null>(null);

  const [rowBusy, setRowBusy] = useState<{ id: number; action: "delete" | "deleteStore" } | null>(null);

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/feeds", { credentials: "include", cache: "no-store" });
      setAuthorized(res.ok);
    } catch {
      setAuthorized(false);
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const {
    data: feedsData,
    error: feedsError,
    mutate: mutateFeeds,
  } = useSWR<FeedsPayload>(authorized === true ? "/api/admin/feeds" : null, feedsFetcher, {
    revalidateOnFocus: true,
    shouldRetryOnError: false,
    errorRetryCount: 0,
  });

  useEffect(() => {
    if (feedsError instanceof Error && feedsError.message === "UNAUTHORIZED") {
      setAuthorized(false);
    }
  }, [feedsError]);

  useEffect(() => {
    const list = feedsData?.feeds;
    if (!list) return;
    const valid = new Set(list.map((f) => f.id));
    setFeedsReadyToRemoveStore((prev) => {
      const next = new Set<number>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
      }
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
      return next;
    });
  }, [feedsData?.feeds]);

  const appendLog = useCallback((text: string) => {
    logSeq.current += 1;
    const id = `${Date.now()}-${logSeq.current}`;
    setLogs((prev) => [...prev.slice(-400), { id, text: `[${new Date().toLocaleTimeString("ro-RO")}] ${text}` }]);
  }, []);

  const applyProgressToGranular = useCallback((msg: Record<string, unknown>) => {
    setGranular({
      scanEssentials: Number(msg.totalEssentialMatched ?? 0),
      filterSkipped: Number(msg.skippedByFilter ?? 0),
      hashSkipped: Number(msg.skippedContentUnchanged ?? 0),
      embeddingsLive: Number(msg.openaiEmbeddingsCompleted ?? 0),
      vectorized: Number(msg.upserted ?? 0),
      errors: Number(msg.errors ?? 0),
      errorSamples: Array.isArray(msg.errorSamples)
        ? (msg.errorSamples as string[]).slice(-20)
        : [],
    });
  }, []);

  const stopSync = useCallback(() => {
    syncAbortRef.current?.abort();
  }, []);

  const runSyncNdjson = useCallback(
    async (payload: { url: string; niche: string; provider_id: string; feed_id?: number | null }) => {
      const ac = new AbortController();
      syncAbortRef.current = ac;
      setSyncing(true);
      setLogs([]);
      setGranular(emptyGranular());
      appendLog("Pornire sync către Supabase / Postgres…");
      try {
        const res = await fetch("/api/admin/feeds/sync-supabase", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: ac.signal,
        });
        if (res.status === 401) {
          appendLog("Sesiune expirată — reconectează-te.");
          setAuthorized(false);
          return;
        }
        if (!res.ok || !res.body) {
          const t = await res.text().catch(() => "");
          appendLog(`Eroare HTTP ${res.status}: ${t.slice(0, 400)}`);
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n");
          buf = parts.pop() ?? "";
          for (const line of parts) {
            const s = line.trim();
            if (!s) continue;
            let msg: Record<string, unknown>;
            try {
              msg = JSON.parse(s) as Record<string, unknown>;
            } catch {
              appendLog(s);
              continue;
            }
            const typ = msg.type;
            if (typ === "start") {
              appendLog(
                `Start — ${String(msg.url ?? "").slice(0, 72)}${String(msg.url ?? "").length > 72 ? "…" : ""} | nișă: ${String(msg.niche)} | provider: ${String(msg.providerId)} | feed_id: ${String(msg.feedId ?? "—")}`
              );
            } else if (typ === "progress") {
              applyProgressToGranular(msg);
            } else if (typ === "complete" && msg.ok) {
              const r = msg.result as
                | {
                    totalEssentialMatched?: number;
                    afterFilterWritten?: number;
                    openaiEmbeddingsCompleted?: number;
                    skippedByFilter?: number;
                    skippedContentUnchanged?: number;
                    errors?: number;
                    errorSamples?: string[];
                  }
                | undefined;
              setGranular({
                scanEssentials: r?.totalEssentialMatched ?? 0,
                filterSkipped: r?.skippedByFilter ?? 0,
                hashSkipped: r?.skippedContentUnchanged ?? 0,
                embeddingsLive: r?.openaiEmbeddingsCompleted ?? 0,
                vectorized: r?.afterFilterWritten ?? 0,
                errors: r?.errors ?? 0,
                errorSamples: Array.isArray(r?.errorSamples) ? r!.errorSamples!.slice(-20) : [],
              });
              appendLog(
                `Final — esențiale: ${r?.totalEssentialMatched ?? "—"} | [Filtru vertical]: ${r?.skippedByFilter ?? "—"} | [Sărite/Hash]: ${r?.skippedContentUnchanged ?? "—"} | [OpenAI embeddings]: ${r?.openaiEmbeddingsCompleted ?? "—"} | [Postgres upsert]: ${r?.afterFilterWritten ?? "—"} | [Erori]: ${r?.errors ?? 0}`
              );
              void mutateFeeds();
            } else if (typ === "error") {
              const errText = String(msg.message ?? "necunoscută");
              appendLog(`Eroare: ${errText}`);
              setGranular((g) => ({
                ...g,
                errors: g.errors + 1,
                errorSamples: [...g.errorSamples, errText].slice(-20),
              }));
            }
          }
        }
      } catch (e) {
        const aborted =
          (e instanceof DOMException && e.name === "AbortError") ||
          (e instanceof Error && e.name === "AbortError");
        if (aborted) {
          appendLog("Sincronizare oprită (Stop).");
        } else {
          appendLog(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (syncAbortRef.current === ac) {
          syncAbortRef.current = null;
        }
        setSyncing(false);
      }
    },
    [appendLog, applyProgressToGranular, mutateFeeds]
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoggingIn(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Autentificare eșuată");
      setPassword("");
      setAuthorized(true);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Eroare");
    } finally {
      setLoggingIn(false);
    }
  };

  const saveFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveMessage(null);
    const name = storeName.trim();
    const url = feedUrl.trim();
    if (!name || !url) {
      setSaveMessage("Completează Nume magazin și URL.");
      return;
    }
    setSaveBusy(true);
    try {
      const res = await fetch("/api/admin/feeds", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          url,
          niche,
          provider_id: providerId,
          is_active: formActive,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 401) {
        setSaveMessage("Sesiune expirată.");
        setAuthorized(false);
        return;
      }
      if (!res.ok) throw new Error(body.error ?? "Nu s-a putut salva");
      setSaveMessage("Magazin salvat în listă.");
      void mutateFeeds();
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : "Eroare");
    } finally {
      setSaveBusy(false);
    }
  };

  const syncFromForm = () => {
    const u = feedUrl.trim();
    if (!u) {
      appendLog("Completează URL-ul feed-ului XML.");
      return;
    }
    void runSyncNdjson({ url: u, niche, provider_id: providerId });
  };

  const syncFeedRow = (row: FeedRow) => {
    void runSyncNdjson({
      url: row.url,
      niche: row.niche,
      provider_id: row.provider_id,
      feed_id: row.id,
    });
  };

  const deleteProductsForRow = async (row: FeedRow) => {
    const pid = (row.provider_id || "generic").trim() || "generic";
    if (
      !confirm(
        `Ștergi din Supabase/Postgres toate produsele cu provider_id = „${pid}”?\n\nAtenție: dacă mai multe magazine folosesc același provider, vor fi șterse toate.`
      )
    ) {
      return;
    }
    setRowBusy({ id: row.id, action: "delete" });
    try {
      const res = await fetch(`/api/admin/feeds/${encodeURIComponent(String(row.id))}/products`, {
        method: "DELETE",
        credentials: "include",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; deleted?: number; ok?: boolean };
      if (!res.ok) throw new Error(body.error ?? "Eroare la ștergere");
      appendLog(`Șterse ${body.deleted ?? 0} produse (provider_id = ${pid}).`);
      setFeedsReadyToRemoveStore((prev) => new Set(prev).add(row.id));
      void mutateFeeds();
    } catch (e) {
      appendLog(e instanceof Error ? e.message : String(e));
    } finally {
      setRowBusy(null);
    }
  };

  const deleteStoreForRow = async (row: FeedRow) => {
    if (!feedsReadyToRemoveStore.has(row.id)) {
      appendLog("Mai întâi rulează „Delete Products” pentru acest magazin.");
      return;
    }
    if (
      !confirm(
        `Ștergi magazinul „${row.name || row.url}” din listă?\n\nSe vor șterge din nou produsele Postgres pentru provider-ul acestui feed (siguranță), apoi rândul din public.feed_configs.`
      )
    ) {
      return;
    }
    setRowBusy({ id: row.id, action: "deleteStore" });
    try {
      const res = await fetch(
        `/api/admin/feeds/${encodeURIComponent(String(row.id))}?cascade=true`,
        { method: "DELETE", credentials: "include" }
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        deletedProducts?: number;
        ok?: boolean;
      };
      if (!res.ok) throw new Error(body.error ?? "Eroare la ștergerea magazinului");
      appendLog(
        `Magazin șters. Produse Postgres eliminate în pasul cascade: ${body.deletedProducts ?? "—"}.`
      );
      setFeedsReadyToRemoveStore((prev) => {
        const n = new Set(prev);
        n.delete(row.id);
        return n;
      });
      void mutateFeeds();
    } catch (e) {
      appendLog(e instanceof Error ? e.message : String(e));
    } finally {
      setRowBusy(null);
    }
  };

  const feeds = feedsData?.feeds ?? [];

  if (authorized === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-zinc-100">
        <p className="text-sm text-zinc-500">Se verifică sesiunea…</p>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-zinc-950 px-4 text-zinc-100">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(139,92,246,0.25),transparent)]" />
        <div className={`relative z-10 w-full max-w-md p-8 ${glassCardClass()}`}>
          <p className="text-center text-[10px] font-semibold uppercase tracking-[0.25em] text-violet-300/80">Mall</p>
          <h1 className="mt-2 text-center text-2xl font-semibold tracking-tight text-white">Import feed</h1>
          <p className="mt-2 text-center text-sm text-zinc-400">Autentificare admin pentru Supabase.</p>
          <form onSubmit={(e) => void handleLogin(e)} className="mt-8 space-y-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Parolă ADMIN_PASSWORD"
              className={inputClass().replace("mt-1.5", "mt-0")}
              autoComplete="current-password"
            />
            {loginError && <p className="text-center text-sm text-red-400">{loginError}</p>}
            <button
              type="submit"
              disabled={loggingIn || !password.trim()}
              className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-900/40 transition hover:opacity-95 disabled:opacity-40"
            >
              {loggingIn ? "Se verifică…" : "Intră"}
            </button>
          </form>
          <Link href="/admin" className="mt-8 block text-center text-xs text-zinc-500 hover:text-zinc-300">
            ← Dashboard admin
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-100 antialiased">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_100%_60%_at_50%_-10%,rgba(99,102,241,0.18),transparent)]" />
      <div className="pointer-events-none absolute bottom-0 left-1/2 h-96 w-[120%] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,rgba(244,63,94,0.08),transparent_70%)]" />

      <header className="relative z-10 border-b border-white/[0.08] bg-black/20 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300/90">Admin · Mall</p>
            <h1 className="text-lg font-semibold tracking-tight text-white">Magazine & import Supabase</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void mutateFeeds()}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-zinc-300 backdrop-blur-sm transition hover:bg-white/10"
            >
              Reîmprospătează lista
            </button>
            <Link
              href="/admin"
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-zinc-300 backdrop-blur-sm transition hover:bg-white/10"
            >
              ← Dashboard
            </Link>
            <Link
              href="/"
              className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-zinc-400 transition hover:text-zinc-200"
            >
              Chat
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl space-y-6 px-5 py-10">
        {feedsError && !(feedsError instanceof Error && feedsError.message === "UNAUTHORIZED") && (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {feedsError instanceof Error ? feedsError.message : "Eroare listă feed-uri"}
          </p>
        )}

        <section className={`p-6 sm:p-8 ${glassCardClass()}`}>
          <h2 className="text-base font-semibold text-white">Adaugă magazin & feed</h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            <strong className="text-zinc-300">Nume magazin</strong> apare în listă; URL-ul rămâne sursa tehnică pentru sync.
            Salvează în Supabase (<code className="text-zinc-500">public.feed_configs</code>), apoi folosește „Sync to Supabase” sau
            acțiunile din tabel.
          </p>

          <form onSubmit={(e) => void saveFeed(e)} className="mt-6 space-y-5">
            <label className="block text-xs font-medium uppercase tracking-wider text-zinc-500">
              Nume magazin
              <input
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="ex. Bravapet Mall"
                className={inputClass()}
              />
            </label>
            <label className="block text-xs font-medium uppercase tracking-wider text-zinc-500">
              URL feed XML
              <input
                type="url"
                value={feedUrl}
                onChange={(e) => setFeedUrl(e.target.value)}
                placeholder="https://…/feed.xml"
                className={inputClass()}
              />
            </label>
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block text-xs font-medium uppercase tracking-wider text-zinc-500">
                Nișă (mall)
                <select value={niche} onChange={(e) => setNiche(e.target.value)} className={inputClass()}>
                  {MALL_NICHES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium uppercase tracking-wider text-zinc-500">
                Provider mapare
                <select value={providerId} onChange={(e) => setProviderId(e.target.value)} className={inputClass()}>
                  {PROVIDERS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />
              Activ (inclus în fluxuri CLI care filtrează după feed activ)
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={saveBusy || syncing}
                className="rounded-xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/15 disabled:opacity-40"
              >
                {saveBusy ? "Se salvează…" : "Salvează magazinul"}
              </button>
              <button
                type="button"
                disabled={syncing || !feedUrl.trim()}
                onClick={() => void syncFromForm()}
                className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition hover:opacity-95 disabled:opacity-40"
              >
                {syncing ? "Se sincronizează…" : "Sync to Supabase"}
              </button>
              <button
                type="button"
                disabled={!syncing}
                onClick={() => stopSync()}
                className="rounded-xl border border-amber-500/50 bg-amber-500/15 px-5 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/25 disabled:opacity-30"
              >
                Stop
              </button>
            </div>
            <p className="text-[11px] text-zinc-500">
              Stop întrerupe cererea curentă (stream NDJSON); pe server procesarea se poate opri după câteva momente.
            </p>
            {saveMessage && (
              <p className={`text-sm ${saveMessage.includes("salvat") ? "text-emerald-300/90" : "text-amber-200"}`}>
                {saveMessage}
              </p>
            )}
          </form>
        </section>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className={`rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] p-4 backdrop-blur-md`}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-200/90">Sărite / hash</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{granular.hashSkipped}</p>
            <p className="mt-1 text-[11px] leading-snug text-amber-100/70">
              Produse neschimbate (MD5 conținut) — fără apel OpenAI.
            </p>
          </div>
          <div className={`rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07] p-4 backdrop-blur-md`}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-200/90">
                OpenAI · live
              </p>
              {syncing && granular.embeddingsLive > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-100">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-200" />
                  </span>
                  stream
                </span>
              )}
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{granular.embeddingsLive}</p>
            <p className="mt-1 text-[11px] leading-snug text-emerald-100/70">
              Răspunsuri embeddings de la OpenAI (în timp real, înainte de scrierea în DB).
            </p>
            <p className="mt-2 border-t border-emerald-500/15 pt-2 text-[10px] uppercase tracking-wider text-emerald-200/60">
              Postgres salvate
            </p>
            <p className="text-lg font-semibold tabular-nums text-emerald-50/95">{granular.vectorized}</p>
          </div>
          <div className={`rounded-2xl border border-zinc-500/25 bg-zinc-500/[0.08] p-4 backdrop-blur-md`}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-300">Filtru vertical</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{granular.filterSkipped}</p>
            <p className="mt-1 text-[11px] leading-snug text-zinc-400">Respinse înainte de coadă (nișă / reguli feed).</p>
          </div>
          <div className={`rounded-2xl border border-red-500/25 bg-red-500/[0.08] p-4 backdrop-blur-md`}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-red-200/90">Erori</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{granular.errors}</p>
            <p className="mt-1 text-[11px] leading-snug text-red-100/70">La embedding sau scriere rând.</p>
          </div>
        </div>

        <p className="text-center text-xs text-zinc-500">
          Noduri XML după comision/stoc:{" "}
          <strong className="tabular-nums text-zinc-200">{granular.scanEssentials}</strong>
        </p>

        {granular.errorSamples.length > 0 && (
          <div className={`rounded-xl border border-red-500/20 bg-red-950/30 p-4 text-xs text-red-100/90 ${glassCardClass()}`}>
            <p className="font-semibold text-red-200">Ultimele erori</p>
            <ul className="mt-2 list-inside list-disc space-y-1 font-mono text-[11px] text-red-100/80">
              {granular.errorSamples.map((s, i) => (
                <li key={`${i}-${s.slice(0, 40)}`} className="break-words">
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        <section className={`overflow-hidden ${glassCardClass()}`}>
          <div className="border-b border-white/[0.08] px-5 py-4">
            <h2 className="text-sm font-semibold text-white">Magazine configurate</h2>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              „Delete Products” șterge din <strong>Postgres</strong> după <code className="text-zinc-600">provider_id</code>.
              După aceea se activează <strong>Șterge magazin</strong> (produse din nou în siguranță, apoi rândul din listă
              locală). Coloana <strong>Postgres</strong> = număr de rânduri în <code className="text-zinc-600">public.products</code>{" "}
              cu același <code className="text-zinc-600">provider_id</code> ca magazinul (ca la „Delete Products” — dacă
              două magazine împart provider-ul, cifra e comună).
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                  <th className="px-4 py-3">Magazin</th>
                  <th className="px-4 py-3">URL</th>
                  <th className="px-4 py-3">Nișă</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Activ</th>
                  <th className="px-4 py-3 text-right">Postgres</th>
                  <th className="min-w-[280px] px-4 py-3 text-right">Acțiuni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {feeds.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-zinc-500">
                      Niciun magazin salvat. Completează formularul de mai sus.
                    </td>
                  </tr>
                ) : (
                  feeds.map((f) => {
                    const deleteProductsBusy = rowBusy?.id === f.id && rowBusy?.action === "delete";
                    const deleteStoreBusy = rowBusy?.id === f.id && rowBusy?.action === "deleteStore";
                    const rowActionBusy = deleteProductsBusy || deleteStoreBusy;
                    const canDeleteStore = feedsReadyToRemoveStore.has(f.id);
                    return (
                      <tr key={f.id} className="transition hover:bg-white/[0.03]">
                        <td className="max-w-[160px] px-4 py-3 font-medium text-zinc-100" title={f.name}>
                          <span className="line-clamp-2">{f.name || "—"}</span>
                        </td>
                        <td className="max-w-[220px] px-4 py-3 font-mono text-xs text-zinc-400" title={f.url}>
                          <span className="line-clamp-2">{f.url}</span>
                        </td>
                        <td className="px-4 py-3 text-zinc-400">{f.niche}</td>
                        <td className="px-4 py-3 font-mono text-xs text-zinc-400">{f.provider_id}</td>
                        <td className="px-4 py-3 text-zinc-400">{Number(f.is_active) === 1 ? "da" : "nu"}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-zinc-300">{f.product_count}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              disabled={syncing || rowActionBusy}
                              onClick={() => void syncFeedRow(f)}
                              className="rounded-lg bg-emerald-600/90 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                            >
                              Sync Now
                            </button>
                            <button
                              type="button"
                              disabled={syncing || rowActionBusy}
                              onClick={() => void deleteProductsForRow(f)}
                              className="rounded-lg border border-red-500/50 px-2.5 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                            >
                              Delete Products
                            </button>
                            <button
                              type="button"
                              disabled={syncing || rowActionBusy || !canDeleteStore}
                              title={
                                canDeleteStore
                                  ? "Șterge magazinul (după ce ai golit produsele Postgres)"
                                  : "Mai întâi „Delete Products” pentru acest magazin."
                              }
                              onClick={() => void deleteStoreForRow(f)}
                              className="rounded-lg border border-zinc-500/60 bg-zinc-800/50 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700/60 disabled:opacity-35"
                            >
                              Șterge magazin
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className={`flex min-h-[200px] flex-col ${glassCardClass()}`}>
          <div className="border-b border-white/[0.08] px-5 py-3">
            <h2 className="text-sm font-semibold text-white">Live logs</h2>
            <p className="text-[11px] text-zinc-500">Flux NDJSON de la server.</p>
          </div>
          <div className="min-h-[160px] flex-1 overflow-auto p-4 font-mono text-[11px] leading-relaxed text-zinc-300">
            {logs.length === 0 ? (
              <p className="text-zinc-600">Niciun eveniment încă.</p>
            ) : (
              <ul className="space-y-1">
                {logs.map((line) => (
                  <li key={line.id} className="break-words">
                    {line.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

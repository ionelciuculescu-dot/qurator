"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";

type AdminInteraction = {
  id: string;
  at: string;
  question: string;
  recommendationGenerated: boolean;
  productsInContext: number;
  recommendedProductTitle: string;
  status: "CLICKED" | "SENT" | "—";
};

type DashboardStats = {
  totalConversations: number;
  totalClicks: number;
  ctrPercent: number | null;
  lastFeedRefreshAt: string | null;
  lastFeedProductCount: number | null;
  lastFeedError: string | null;
};

type DashboardPayload = {
  stats: DashboardStats;
  interactions: AdminInteraction[];
  topProducts: { title: string; clicks: number }[];
};

const POLL_MS = 5000;

async function adminFetcher(url: string): Promise<DashboardPayload> {
  const res = await fetch(url, { credentials: "include", cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as DashboardPayload & { error?: string };
  if (res.status === 401) {
    const e = new Error("UNAUTHORIZED");
    throw e;
  }
  if (!res.ok) throw new Error(data.error ?? "Eroare la încărcare");
  return {
    stats: data.stats,
    interactions: Array.isArray(data.interactions) ? data.interactions : [],
    topProducts: Array.isArray(data.topProducts) ? data.topProducts : [],
  };
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ro-RO", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function toCsv(rows: AdminInteraction[]): string {
  const header = ["Data", "Mesaj utilizator", "Produs recomandat", "Stare", "Produse context"];
  const lines = rows.map((r) =>
    [
      r.at,
      `"${r.question.replace(/"/g, '""')}"`,
      `"${(r.recommendedProductTitle || "").replace(/"/g, '""')}"`,
      r.status,
      String(r.productsInContext),
    ].join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

export default function AdminDashboardPage() {
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  const { data, error, isLoading, mutate, isValidating } = useSWR<DashboardPayload>(
    "/api/admin/dashboard",
    adminFetcher,
    {
      refreshInterval: POLL_MS,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
      errorRetryCount: 0,
    }
  );

  const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";

  async function handleLogin(e: React.FormEvent) {
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
      if (!res.ok) {
        throw new Error(body.error ?? "Autentificare eșuată");
      }
      setPassword("");
      await mutate();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Eroare");
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    await mutate(undefined, { revalidate: false });
    window.location.reload();
  }

  const exportCsv = useCallback(() => {
    if (!data?.interactions?.length) return;
    const blob = new Blob([toCsv(data.interactions)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `admin-activitate-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [data?.interactions]);

  const stats = data?.stats;
  const interactions = data?.interactions ?? [];
  const topProducts = data?.topProducts ?? [];

  const headerBusy = isLoading || isValidating;

  async function forceRefreshFeed() {
    setRefreshing(true);
    setRefreshMessage(null);
    try {
      const res = await fetch("/api/admin/refresh-feed", { method: "POST", credentials: "include" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; productCount?: number; error?: string };
      if (res.status === 401) {
        setRefreshMessage("Sesiune expirată — autentifică-te din nou.");
        await mutate();
        return;
      }
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Refresh eșuat");
      setRefreshMessage(`Feed parsat: ${body.productCount ?? 0} produse.`);
      await mutate();
    } catch (e) {
      setRefreshMessage(e instanceof Error ? e.message : "Eroare refresh");
    } finally {
      setRefreshing(false);
    }
  }

  const ctrDisplay = useMemo(() => {
    if (headerBusy && !stats) return "—";
    if (stats?.ctrPercent == null) return "—";
    return `${stats.ctrPercent}%`;
  }, [headerBusy, stats]);

  if (unauthorized || (!data && !isLoading && error)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#09090b] px-4 text-zinc-100">
        <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#0c0c0e] p-8 shadow-2xl shadow-black/50">
          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Securitate</p>
          <h1 className="mt-2 text-center text-xl font-semibold tracking-tight text-zinc-50">Acces admin</h1>
          <p className="mt-2 text-center text-sm text-zinc-500">
            Introdu parola din <span className="font-mono text-zinc-400">ADMIN_PASSWORD</span> (.env.local).
          </p>
          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Parolă"
              className="w-full rounded-lg border border-white/[0.1] bg-black/40 px-4 py-3 text-sm text-zinc-100 outline-none ring-0 placeholder:text-zinc-600 focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
              autoComplete="current-password"
            />
            {loginError && <p className="text-center text-sm text-red-400">{loginError}</p>}
            <button
              type="submit"
              disabled={loggingIn || !password.trim()}
              className="w-full rounded-lg bg-indigo-500 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-400 disabled:opacity-40"
            >
              {loggingIn ? "Se verifică…" : "Intră"}
            </button>
          </form>
          <Link href="/" className="mt-6 block text-center text-xs text-zinc-500 hover:text-zinc-300">
            ← Înapoi la chat
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 antialiased">
      <header className="border-b border-white/[0.06] bg-[#09090b]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-widest text-zinc-500">Admin</p>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-50">Dashboard</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={exportCsv}
              disabled={!interactions.length}
              className="rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-white/[0.08] disabled:opacity-40"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => void mutate()}
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs font-medium text-zinc-300 transition hover:border-white/[0.12] hover:bg-white/[0.07]"
            >
              {isValidating ? "Actualizare…" : "Reîmprospătează"}
            </button>
            <button
              type="button"
              onClick={() => void forceRefreshFeed()}
              disabled={refreshing}
              className="rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400 disabled:opacity-50"
            >
              {refreshing ? "Parsare…" : "Force Refresh Feed"}
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-lg border border-white/[0.08] px-3 py-2 text-xs font-medium text-zinc-400 transition hover:text-zinc-200"
            >
              Ieșire
            </button>
            <Link
              href="/admin/feeds"
              className="rounded-lg border border-white/[0.08] px-3 py-2 text-xs font-medium text-zinc-300 transition hover:border-white/[0.12] hover:bg-white/[0.07]"
            >
              Feed-uri catalog
            </Link>
            <Link
              href="/"
              className="rounded-lg border border-white/[0.08] px-3 py-2 text-xs font-medium text-zinc-400 transition hover:text-zinc-200"
            >
              ← Chat
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        {refreshMessage && (
          <p
            className={`rounded-lg border px-4 py-2 text-sm ${
              refreshMessage.includes("Eroare") || refreshMessage.includes("eșuat") || refreshMessage.includes("expirat")
                ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                : "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
            }`}
          >
            {refreshMessage}
          </p>
        )}

        {error && !unauthorized && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error instanceof Error ? error.message : "Eroare"}
          </p>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          <StatCard
            label="Total conversații"
            value={headerBusy && !stats ? "—" : String(stats?.totalConversations ?? 0)}
            hint="Înregistrări în conversations.json"
          />
          <StatCard
            label="Total click-uri"
            value={headerBusy && !stats ? "—" : String(stats?.totalClicks ?? 0)}
            hint="Tracking /api/click"
          />
          <StatCard label="CTR" value={ctrDisplay} hint="Click / conversații cu recomandare" />
        </section>

        <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
          <section className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#0c0c0e] shadow-xl shadow-black/40">
            <div className="border-b border-white/[0.06] px-5 py-4">
              <h2 className="text-sm font-semibold text-zinc-200">Live feed</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Ultimele 20 interacțiuni · actualizare la {POLL_MS / 1000}s
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                    <th className="px-5 py-3">Data / ora</th>
                    <th className="px-5 py-3">Mesaj utilizator</th>
                    <th className="px-5 py-3">Produs recomandat</th>
                    <th className="px-5 py-3 text-center">Stare</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {isLoading && !data ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-12 text-center text-zinc-500">
                        Se încarcă…
                      </td>
                    </tr>
                  ) : interactions.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-12 text-center text-zinc-500">
                        Nu există încă date. Folosește chat-ul cu recomandări.
                      </td>
                    </tr>
                  ) : (
                    interactions.map((row) => (
                      <tr key={row.id} className="transition hover:bg-white/[0.02]">
                        <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-zinc-400">
                          {formatDate(row.at)}
                        </td>
                        <td className="max-w-xs px-5 py-3 text-zinc-200">
                          <span className="line-clamp-2" title={row.question}>
                            {row.question}
                          </span>
                        </td>
                        <td className="max-w-[200px] px-5 py-3 text-zinc-300">
                          <span className="line-clamp-2" title={row.recommendedProductTitle}>
                            {row.recommendedProductTitle || "—"}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-center">
                          {row.status === "CLICKED" && (
                            <span className="inline-flex rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                              CLICKED
                            </span>
                          )}
                          {row.status === "SENT" && (
                            <span className="inline-flex rounded-full bg-zinc-600/30 px-2.5 py-0.5 text-xs font-medium text-zinc-400 ring-1 ring-zinc-500/25">
                              SENT
                            </span>
                          )}
                          {row.status === "—" && (
                            <span className="text-xs text-zinc-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="h-fit rounded-xl border border-white/[0.06] bg-[#0c0c0e] p-5 shadow-lg shadow-black/30">
            <h2 className="text-sm font-semibold text-zinc-200">Top produse</h2>
            <p className="mt-1 text-xs text-zinc-500">După click-uri (parametrul produs)</p>
            <ol className="mt-4 space-y-3">
              {topProducts.length === 0 ? (
                <li className="text-sm text-zinc-600">Niciun click încă.</li>
              ) : (
                topProducts.map((p, i) => (
                  <li
                    key={`${p.title}-${i}`}
                    className="flex items-start justify-between gap-2 rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2"
                  >
                    <span className="text-xs font-medium text-zinc-400">{i + 1}.</span>
                    <span className="flex-1 text-xs leading-snug text-zinc-200 line-clamp-2" title={p.title}>
                      {p.title}
                    </span>
                    <span className="font-mono text-xs font-semibold text-indigo-300">{p.clicks}</span>
                  </li>
                ))
              )}
            </ol>
          </aside>
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/[0.06] bg-gradient-to-b from-white/[0.05] to-transparent p-5 transition hover:border-white/[0.1]">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-500/[0.08] via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
      <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-2 font-mono text-2xl font-semibold tracking-tight text-zinc-50">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500">{hint}</p>
    </div>
  );
}

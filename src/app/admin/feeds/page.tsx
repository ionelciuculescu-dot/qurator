"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import useSWR from "swr";

/** Mesaj unic când serverul Flask / rețeaua nu răspund (fără detalii tehnice). */
const PROCESSING_SERVER_DOWN = "Serverul de procesare nu este activ";

function feedApiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_FEED_API_URL ?? "").trim().replace(/\/$/, "");
}

function feedApiToken(): string {
  return (process.env.NEXT_PUBLIC_FEED_API_TOKEN ?? "").trim();
}

function feedApiHeaders(): HeadersInit {
  const t = feedApiToken();
  if (!t) return {};
  return { "X-Upload-Token": t };
}

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

async function feedsFetcher(url: string): Promise<FeedsPayload> {
  const res = await fetch(url, { credentials: "include", cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as FeedsPayload & { error?: string };
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error(data.error ?? "Eroare");
  return { feeds: Array.isArray(data.feeds) ? data.feeds : [] };
}

export default function AdminFeedsPage() {
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formNiche, setFormNiche] = useState("auto");
  const [formProvider, setFormProvider] = useState("generic");
  const [formActive, setFormActive] = useState(true);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [pgNiche, setPgNiche] = useState("petshop");
  const [pgXmlFile, setPgXmlFile] = useState<File | null>(null);
  const [pgBusy, setPgBusy] = useState(false);
  const [pgMessage, setPgMessage] = useState<string | null>(null);

  const { data, error, isLoading, mutate, isValidating } = useSWR<FeedsPayload>("/api/admin/feeds", feedsFetcher, {
    revalidateOnFocus: true,
    shouldRetryOnError: false,
    errorRetryCount: 0,
  });

  const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";
  const feeds = data?.feeds ?? [];

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
      if (!res.ok) throw new Error(body.error ?? "Autentificare eșuată");
      setPassword("");
      await mutate();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Eroare");
    } finally {
      setLoggingIn(false);
    }
  }

  const addFeed = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setFormMessage(null);
      try {
        const res = await fetch("/api/admin/feeds", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName,
            url: formUrl,
            niche: formNiche,
            provider_id: formProvider,
            is_active: formActive,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 401) {
          setFormMessage("Sesiune expirată.");
          await mutate();
          return;
        }
        if (!res.ok) throw new Error(body.error ?? "Nu s-a putut salva");
        setFormName("");
        setFormUrl("");
        setFormNiche("auto");
        setFormProvider("generic");
        setFormActive(true);
        setFormMessage("Feed salvat.");
        await mutate();
      } catch (err) {
        setFormMessage(err instanceof Error ? err.message : "Eroare");
      }
    },
    [formActive, formName, formNiche, formProvider, formUrl, mutate]
  );

  const deleteFeed = useCallback(
    async (rawId: number | string) => {
      const id = Number(rawId);
      if (!Number.isFinite(id) || id <= 0) return;
      if (!confirm("Ștergi acest feed din listă? (Produsele din catalog nu se șterg automat.)")) return;
      setBusyId(id);
      try {
        const res = await fetch(`/api/admin/feeds/${encodeURIComponent(String(id))}`, {
          method: "DELETE",
          credentials: "include",
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? "Ștergere eșuată");
        await mutate();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Eroare");
      } finally {
        setBusyId(null);
      }
    },
    [mutate]
  );

  const uploadXmlToPostgres = useCallback(async () => {
    const base = feedApiBaseUrl();
    if (!base) {
      setPgMessage(PROCESSING_SERVER_DOWN);
      return;
    }
    if (!pgXmlFile) {
      setPgMessage("Alege un fișier .xml.");
      return;
    }
    setPgMessage(null);
    setPgBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", pgXmlFile);
      fd.append("niche", pgNiche);
      const res = await fetch(`${base}/admin/upload-feed`, {
        method: "POST",
        body: fd,
        headers: feedApiHeaders(),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        niche?: string;
        import?: { stderr?: string; stdout?: string; returncode?: number | null };
      };
      if (!res.ok || !body.ok) {
        setPgMessage(PROCESSING_SERVER_DOWN);
        return;
      }
      setPgMessage(body.message ?? "Import reușit.");
    } catch {
      setPgMessage(PROCESSING_SERVER_DOWN);
    } finally {
      setPgBusy(false);
    }
  }, [pgNiche, pgXmlFile]);

  const deletePostgresByNiche = useCallback(async () => {
    const base = feedApiBaseUrl();
    if (!base) {
      setPgMessage(PROCESSING_SERVER_DOWN);
      return;
    }
    if (!confirm(`Ștergi din PostgreSQL toate produsele cu niche_type = „${pgNiche}”?`)) return;
    setPgMessage(null);
    setPgBusy(true);
    try {
      const res = await fetch(`${base}/admin/feed/${encodeURIComponent(pgNiche)}`, {
        method: "DELETE",
        headers: feedApiHeaders(),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; deleted?: number };
      if (!res.ok || body.ok === false) {
        setPgMessage(PROCESSING_SERVER_DOWN);
        return;
      }
      setPgMessage(body.message ?? `Șterse ${body.deleted ?? 0} rânduri.`);
    } catch {
      setPgMessage(PROCESSING_SERVER_DOWN);
    } finally {
      setPgBusy(false);
    }
  }, [pgNiche]);

  const syncFeed = useCallback(
    async (rawId: number | string) => {
      const id = Number(rawId);
      if (!Number.isFinite(id) || id <= 0) {
        alert("ID feed invalid.");
        return;
      }
      setBusyId(id);
      try {
        const res = await fetch(`/api/admin/feeds/${encodeURIComponent(String(id))}/sync`, {
          method: "POST",
          credentials: "include",
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          result?: { afterFilterWritten?: number };
          catalogTotalProducts?: number;
        };
        if (!res.ok || !body.ok) throw new Error(body.error ?? "Sync eșuat");
        alert(
          `Sincronizare OK. Înscrise acum: ${body.result?.afterFilterWritten ?? 0} (după filtru). Total produse în catalog: ${body.catalogTotalProducts ?? "—"}.`
        );
        await mutate();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Eroare");
      } finally {
        setBusyId(null);
      }
    },
    [mutate]
  );

  if (unauthorized || (!data && !isLoading && error)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#09090b] px-4 text-zinc-100">
        <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#0c0c0e] p-8 shadow-2xl shadow-black/50">
          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Admin</p>
          <h1 className="mt-2 text-center text-xl font-semibold tracking-tight text-zinc-50">Feed-uri catalog</h1>
          <p className="mt-2 text-center text-sm text-zinc-500">Autentificare necesară.</p>
          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Parolă ADMIN_PASSWORD"
              className="w-full rounded-lg border border-white/[0.1] bg-black/40 px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
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
          <Link href="/admin" className="mt-6 block text-center text-xs text-zinc-500 hover:text-zinc-300">
            ← Dashboard admin
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 antialiased">
      <header className="border-b border-white/[0.06] bg-[#09090b]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-widest text-zinc-500">Admin</p>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-50">Feed-uri catalog</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void mutate()}
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-white/[0.07]"
            >
              {isValidating ? "Actualizare…" : "Reîmprospătează"}
            </button>
            <Link
              href="/admin"
              className="rounded-lg border border-white/[0.08] px-3 py-2 text-xs font-medium text-zinc-400 transition hover:text-zinc-200"
            >
              ← Dashboard
            </Link>
            <Link href="/" className="rounded-lg border border-white/[0.08] px-3 py-2 text-xs font-medium text-zinc-400 transition hover:text-zinc-200">
              Chat
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-6 py-8">
        {error && !unauthorized && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error instanceof Error ? error.message : "Eroare"}
          </p>
        )}

        <section className="rounded-xl border border-white/[0.06] bg-[#0c0c0e] p-6 shadow-xl shadow-black/40">
          <h2 className="text-sm font-semibold text-zinc-200">Adaugă feed</h2>
          <p className="mt-1 text-xs text-zinc-500">
            URL XML, provider de mapare și nișă pentru <code className="text-zinc-400">products.niche_type</code> la
            import (auto = inferență din titlu/URL).
          </p>
          <form onSubmit={addFeed} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-xs text-zinc-400">
              Nume
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-white/[0.1] bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500/40"
                placeholder="ex. Bravapet principal"
              />
            </label>
            <label className="block text-xs text-zinc-400 sm:col-span-2">
              URL feed
              <input
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                required
                type="url"
                className="mt-1 w-full rounded-lg border border-white/[0.1] bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500/40"
                placeholder="https://…"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              Nișă (niche_type)
              <select
                value={formNiche}
                onChange={(e) => setFormNiche(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/[0.1] bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500/40"
              >
                <option value="auto">Auto (inferență)</option>
                <option value="petshop">Petshop</option>
                <option value="tech">Tech</option>
                <option value="generic">Generic</option>
                <option value="it">IT (legacy Samsung / electronice)</option>
              </select>
            </label>
            <label className="block text-xs text-zinc-400">
              Provider
              <select
                value={formProvider}
                onChange={(e) => setFormProvider(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/[0.1] bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500/40"
              >
                <option value="generic">generic</option>
                <option value="bravapet">bravapet</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-zinc-400 sm:col-span-2">
              <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />
              Activ (inclus în sync global din CLI dacă e activ)
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 hover:bg-indigo-400"
              >
                Salvează feed
              </button>
              {formMessage && <p className="mt-2 text-sm text-emerald-300/90">{formMessage}</p>}
            </div>
          </form>
        </section>

        <section className="rounded-xl border border-white/[0.06] bg-[#0c0c0e] p-6 shadow-xl shadow-black/40">
          <h2 className="text-sm font-semibold text-zinc-200">Procesare feed (PostgreSQL)</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Încărcare XML pe serverul de procesare (adresa e setată în build cu{" "}
            <code className="text-zinc-400">NEXT_PUBLIC_FEED_API_URL</code>). Nișa selectată devine{" "}
            <code className="text-zinc-400">niche_type</code> în baza de date.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-xs text-zinc-400">
              Nișă (<code className="text-zinc-500">niche_type</code>)
              <select
                value={pgNiche}
                onChange={(e) => setPgNiche(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/[0.1] bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500/40"
              >
                <option value="auto">auto</option>
                <option value="petshop">petshop</option>
                <option value="tech">tech</option>
                <option value="generic">generic</option>
                <option value="it">it</option>
              </select>
            </label>
            <label className="block text-xs text-zinc-400">
              Fișier XML
              <input
                type="file"
                accept=".xml,text/xml,application/xml"
                className="mt-1 w-full text-sm text-zinc-300 file:mr-2 file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
                onChange={(e) => setPgXmlFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button
                type="button"
                disabled={pgBusy}
                onClick={() => void uploadXmlToPostgres()}
                className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 hover:bg-indigo-400 disabled:opacity-40"
              >
                {pgBusy ? "Se procesează…" : "Trimite feed"}
              </button>
              <button
                type="button"
                disabled={pgBusy}
                onClick={() => void deletePostgresByNiche()}
                className="rounded-lg border border-red-500/50 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-40"
              >
                Golește produsele (nișa selectată)
              </button>
            </div>
            {pgMessage && (
              <p className="rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-sm text-zinc-300 sm:col-span-2">
                {pgMessage}
              </p>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#0c0c0e] shadow-xl shadow-black/40">
          <div className="border-b border-white/[0.06] px-5 py-4">
            <h2 className="text-sm font-semibold text-zinc-200">Feed-uri configurate</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Coloana „Produse” = număr rânduri în `products` cu `feed_id` egal cu acest feed.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Nume</th>
                  <th className="px-4 py-3">URL</th>
                  <th className="px-4 py-3">Nișă</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Activ</th>
                  <th className="px-4 py-3 text-right">Produse</th>
                  <th className="px-4 py-3 text-right">Acțiuni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {isLoading && !data ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-zinc-500">
                      Se încarcă…
                    </td>
                  </tr>
                ) : feeds.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-zinc-500">
                      Niciun feed. Adaugă unul mai sus sau rulează migrarea (deschide catalog DB o dată).
                    </td>
                  </tr>
                ) : (
                  feeds.map((f) => (
                    <tr key={f.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-mono text-xs text-zinc-400">{f.id}</td>
                      <td className="max-w-[140px] truncate px-4 py-3 text-zinc-200" title={f.name}>
                        {f.name}
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-3 font-mono text-xs text-zinc-400" title={f.url}>
                        {f.url}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">{f.niche}</td>
                      <td className="px-4 py-3 text-zinc-400">{f.provider_id}</td>
                      <td className="px-4 py-3">{f.is_active ? "da" : "nu"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-200">{f.product_count}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={busyId !== null && busyId === Number(f.id)}
                            title={
                              Number(f.is_active) !== 1
                                ? "Feed marcat inactiv (CLI îl omite); sync manual merge oricum."
                                : "Sincronizează acest feed în catalog"
                            }
                            onClick={() => void syncFeed(f.id)}
                            className="rounded-md bg-emerald-600/90 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
                          >
                            Sync acum
                          </button>
                          <button
                            type="button"
                            disabled={busyId !== null && busyId === Number(f.id)}
                            onClick={() => void deleteFeed(Number(f.id))}
                            className="rounded-md border border-red-500/40 px-2 py-1 text-xs font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                          >
                            Șterge
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

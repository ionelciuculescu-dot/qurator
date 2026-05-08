import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Înregistrare în `data/conversations.json`. */
export type ConversationLogEntry = {
  id: string;
  at: string;
  question: string;
  replySnippet: string;
  recommendationGenerated: boolean;
  productsInContext: number;
  recommendedProductTitle: string;
};

export type ClickLogEntry = {
  id: string;
  at: string;
  conversationId: string | null;
  produs: string;
  url: string;
};

type ConversationsFile = {
  entries: ConversationLogEntry[];
};

type ClicksFile = {
  clicks: ClickLogEntry[];
};

const MAX_ENTRIES = 500;
const MAX_CLICKS = 5000;
const SNIPPET_LEN = 400;

function dbPath(): string {
  return path.join(process.cwd(), "data", "conversations.json");
}

function clicksPath(): string {
  return path.join(process.cwd(), "data", "clicks.json");
}

function defaultConversations(): ConversationsFile {
  return { entries: [] };
}

function defaultClicks(): ClicksFile {
  return { clicks: [] };
}

async function readConversations(): Promise<ConversationsFile> {
  try {
    const raw = await readFile(dbPath(), "utf-8");
    const parsed = JSON.parse(raw) as ConversationsFile;
    if (!Array.isArray(parsed.entries)) parsed.entries = [];
    for (const e of parsed.entries) {
      if (typeof e.recommendedProductTitle !== "string") e.recommendedProductTitle = "";
    }
    return parsed;
  } catch {
    return defaultConversations();
  }
}

async function writeConversations(state: ConversationsFile): Promise<void> {
  const file = dbPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2), "utf-8");
}

async function readClicksFile(): Promise<ClicksFile> {
  try {
    const raw = await readFile(clicksPath(), "utf-8");
    const parsed = JSON.parse(raw) as ClicksFile;
    if (!Array.isArray(parsed.clicks)) parsed.clicks = [];
    return parsed;
  } catch {
    return defaultClicks();
  }
}

async function writeClicksFile(state: ClicksFile): Promise<void> {
  const file = clicksPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2), "utf-8");
}

/** Euristică: răspuns conține CTA de ofertă sau linie de preț. */
export function inferRecommendationGenerated(reply: string): boolean {
  const hasOfferLink =
    /\[[^\]]*(OFERTA|CUMPARA)[^\]]*\]\(\s*(?:https?:\/\/|\/api\/click\?)/i.test(reply);
  const hasPriceLine = /(?:💰\s*)?(?:Preț|Pret):\s*[^\n]+/i.test(reply);
  return hasOfferLink || hasPriceLine;
}

/**
 * Salvează o conversație. `id` = identificator stabil (ex. pentru corelare cu click-uri).
 */
export async function logConversation(input: {
  id: string;
  question: string;
  reply: string;
  productsInContext: number;
  recommendedProductTitle?: string;
}): Promise<void> {
  const state = await readConversations();
  const replySnippet = input.reply.slice(0, SNIPPET_LEN);
  const row: ConversationLogEntry = {
    id: input.id,
    at: new Date().toISOString(),
    question: input.question.slice(0, 4000),
    replySnippet,
    recommendationGenerated: inferRecommendationGenerated(input.reply),
    productsInContext: input.productsInContext,
    recommendedProductTitle: (input.recommendedProductTitle ?? "").slice(0, 500),
  };
  state.entries.push(row);
  if (state.entries.length > MAX_ENTRIES) {
    state.entries = state.entries.slice(-MAX_ENTRIES);
  }
  await writeConversations(state);
}

export async function appendClick(input: {
  conversationId: string | null;
  produs: string;
  url: string;
}): Promise<void> {
  const state = await readClicksFile();
  const row: ClickLogEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    conversationId: input.conversationId,
    produs: input.produs.slice(0, 500),
    url: input.url.slice(0, 4000),
  };
  state.clicks.push(row);
  if (state.clicks.length > MAX_CLICKS) {
    state.clicks = state.clicks.slice(-MAX_CLICKS);
  }
  await writeClicksFile(state);
}

export async function getRecentConversations(limit = 20): Promise<ConversationLogEntry[]> {
  const state = await readConversations();
  return [...state.entries].reverse().slice(0, limit);
}

export async function getConversationStats(): Promise<{
  totalInteractions: number;
  last24h: number;
  recommendationRate: number | null;
}> {
  const all = (await readConversations()).entries;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const last24h = all.filter((r) => now - new Date(r.at).getTime() <= day).length;
  const withReco = all.filter((r) => r.recommendationGenerated).length;
  const recommendationRate =
    all.length === 0 ? null : Math.round((withReco / all.length) * 1000) / 10;
  return {
    totalInteractions: all.length,
    last24h,
    recommendationRate,
  };
}

export async function getTotalClicks(): Promise<number> {
  return (await readClicksFile()).clicks.length;
}

/** Top N produse după număr de click-uri (după câmpul `produs` decodat). */
export async function getTopProductsByClicks(limit = 5): Promise<{ title: string; clicks: number }[]> {
  const { clicks } = await readClicksFile();
  const counts = new Map<string, number>();
  for (const c of clicks) {
    const key = c.produs.trim() || "(fără nume)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([title, n]) => ({ title, clicks: n }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, limit);
}

export type AdminFeedRow = ConversationLogEntry & {
  status: "CLICKED" | "SENT" | "—";
};

export async function getAdminLiveFeed(limit = 20): Promise<AdminFeedRow[]> {
  const conv = await readConversations();
  const { clicks } = await readClicksFile();
  const clickedConv = new Set(
    clicks.map((c) => c.conversationId).filter((id): id is string => typeof id === "string" && id.length > 0)
  );
  const newestFirst = [...conv.entries].reverse();
  const seenIds = new Set<string>();
  const rows: typeof conv.entries = [];
  for (const r of newestFirst) {
    if (seenIds.has(r.id)) continue;
    seenIds.add(r.id);
    rows.push(r);
    if (rows.length >= limit) break;
  }
  return rows.map((r) => {
    let status: AdminFeedRow["status"] = "—";
    if (r.recommendationGenerated) {
      status = clickedConv.has(r.id) ? "CLICKED" : "SENT";
    }
    return { ...r, status };
  });
}

/**
 * CTR (%): conversații cu recomandare care au primit cel puțin un click /
 * numărul de conversații cu recomandare (oportunități).
 */
export async function getCtrPercent(): Promise<number | null> {
  const conv = (await readConversations()).entries;
  const { clicks } = await readClicksFile();
  const clickedIds = new Set(
    clicks.map((c) => c.conversationId).filter((id): id is string => typeof id === "string" && id.length > 0)
  );
  const withReco = conv.filter((c) => c.recommendationGenerated);
  const opportunities = withReco.length;
  if (opportunities === 0) return null;
  const converted = withReco.filter((c) => clickedIds.has(c.id)).length;
  return Math.round((converted / opportunities) * 1000) / 10;
}

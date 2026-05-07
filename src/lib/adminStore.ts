import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  getAdminLiveFeed,
  getConversationStats,
  getCtrPercent,
  getTopProductsByClicks,
  getTotalClicks,
  type AdminFeedRow,
} from "@/lib/db";

/** Rând în feed-ul admin (conversație + stare click). */
export type AdminInteraction = AdminFeedRow;

export type AdminFeedMeta = {
  lastRefreshAt: string | null;
  lastProductCount: number | null;
  lastError: string | null;
};

type AdminStateFile = {
  feed: AdminFeedMeta;
};

function statePath(): string {
  return path.join(process.cwd(), "data", "admin-state.json");
}

function defaultState(): AdminStateFile {
  return {
    feed: {
      lastRefreshAt: null,
      lastProductCount: null,
      lastError: null,
    },
  };
}

async function readState(): Promise<AdminStateFile> {
  const file = statePath();
  try {
    const raw = await readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as AdminStateFile & { interactions?: unknown };
    if (!parsed.feed || typeof parsed.feed !== "object") parsed.feed = defaultState().feed;
    return { feed: parsed.feed };
  } catch {
    return defaultState();
  }
}

async function writeState(state: AdminStateFile): Promise<void> {
  const file = statePath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2), "utf-8");
}

export async function recordFeedRefresh(input: {
  ok: boolean;
  productCount?: number;
  error?: string;
}): Promise<void> {
  const state = await readState();
  state.feed = {
    lastRefreshAt: new Date().toISOString(),
    lastProductCount: input.ok ? (input.productCount ?? null) : state.feed.lastProductCount,
    lastError: input.ok ? null : (input.error ?? "Eroare necunoscută"),
  };
  await writeState(state);
}

export async function getDashboardPayload(): Promise<{
  interactions: AdminInteraction[];
  topProducts: { title: string; clicks: number }[];
  stats: {
    totalConversations: number;
    totalClicks: number;
    ctrPercent: number | null;
    lastFeedRefreshAt: string | null;
    lastFeedProductCount: number | null;
    lastFeedError: string | null;
  };
}> {
  const state = await readState();
  const convStats = await getConversationStats();
  const totalClicks = await getTotalClicks();
  const ctrPercent = await getCtrPercent();
  const interactions = await getAdminLiveFeed(20);
  const topProducts = await getTopProductsByClicks(5);

  return {
    interactions,
    topProducts,
    stats: {
      totalConversations: convStats.totalInteractions,
      totalClicks,
      ctrPercent,
      lastFeedRefreshAt: state.feed.lastRefreshAt,
      lastFeedProductCount: state.feed.lastProductCount,
      lastFeedError: state.feed.lastError,
    },
  };
}

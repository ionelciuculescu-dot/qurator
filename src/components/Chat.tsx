"use client";

import { AssistantMessageContent } from "@/components/AssistantMessageContent";
import { DashboardHeader } from "@/components/DashboardHeader";
import { ProductRecommendationCards } from "@/components/ProductRecommendationCards";
import { assignUniqueProductShortIds } from "@/sales/lib/productShortId";
import { extractKeyword } from "@/sales/lib/extractKeyword";
import type { ChatProductCard } from "@/sales/chat/types";
import { useCallback, useEffect, useRef, useState } from "react";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  requiresEmailCapture?: boolean;
  contextProducts?: ChatProductCard[];
  debugLlmProductsJson?: string;
};

export type ChatProps = {
  /**
   * Când AI returnează `contextProducts`, notifică părintele (vitrină dashboard).
   * Dacă e setat, cardurile nu mai sunt randate în bule — doar în vitrina din pagină.
   */
  onProductsChange?: (products: ChatProductCard[]) => void;
  /** Pe mobil: deschide sertarul istoric ca scroll la `prod-*` să găsească cardul. */
  onOpenHistoryDrawer?: () => void;
  /** Fără header propriu — folosit când pagina furnizează chrome-ul. */
  hideChrome?: boolean;
};

function normalizeContextProducts(raw: unknown): ChatProductCard[] {
  if (!Array.isArray(raw)) return [];
  const rows = raw
    .filter((x): x is Record<string, unknown> => x != null && typeof x === "object")
    .map((c) => {
      const d = c.description;
      return {
        title: String(c.title ?? ""),
        imageUrl: String(c.imageUrl ?? ""),
        price: String(c.price ?? ""),
        currency: String(c.currency ?? "RON"),
        affiliateUrl: String(c.affiliateUrl ?? ""),
        productShortId: typeof c.productShortId === "string" ? c.productShortId : undefined,
        ...(typeof d === "string" && d.trim() ? { description: d.trim() } : {}),
      };
    });
  return assignUniqueProductShortIds(rows);
}

const QUICK_START_PROMPTS = [
  "Hrană pentru pisici pretențioase",
  "Jucării interactive pentru câini",
  "Produse de îngrijire pentru blană",
] as const;

function formatDebugProductsJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function TypingIndicator() {
  return (
    <div className="flex justify-start" aria-live="polite" aria-busy="true">
      <div className="flex max-w-[90%] items-center gap-3 rounded-2xl rounded-bl-md border border-neutral-100/90 bg-white/95 px-4 py-2.5 shadow-sm backdrop-blur-sm">
        <span className="inline-flex gap-1 py-0.5" aria-hidden>
          <span className="size-1.5 animate-bounce rounded-full bg-emerald-500/85 [animation-duration:0.55s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-emerald-500/85 [animation-duration:0.55s] [animation-delay:120ms]" />
          <span className="size-1.5 animate-bounce rounded-full bg-emerald-500/85 [animation-duration:0.55s] [animation-delay:240ms]" />
        </span>
        <p className="text-[13px] leading-snug text-neutral-500">Agentul analizează oferta…</p>
      </div>
    </div>
  );
}

function EmptyChatPanel({
  onPick,
  disabled,
}: {
  onPick: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-3 py-10 text-center">
      <div className="max-w-md space-y-3">
        <h2 className="text-lg font-semibold tracking-tight text-neutral-900">Bun venit la Qurator</h2>
        <p className="text-[14px] leading-relaxed text-neutral-600">
          Spune-mi ce cauți pentru animalul tău sau alege o sugestie — verific ofertele din catalog și îți arăt
          variante potrivite, cu prețuri reale.
        </p>
      </div>
      <div className="flex w-full max-w-lg flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
        {QUICK_START_PROMPTS.map((label) => (
          <button
            key={label}
            type="button"
            disabled={disabled}
            onClick={() => onPick(label)}
            className="rounded-full border border-neutral-200/90 bg-white px-4 py-2.5 text-left text-[13px] font-medium text-neutral-700 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 hover:text-emerald-950 disabled:cursor-not-allowed disabled:opacity-50 sm:text-center"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Chat({ onProductsChange, onOpenHistoryDrawer, hideChrome = false }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [conversationId, setConversationId] = useState(() => crypto.randomUUID());
  const dashboardMode = Boolean(onProductsChange);

  const resetChat = useCallback(() => {
    setMessages([]);
    setInput("");
    setLoading(false);
    setConversationId(crypto.randomUUID());
  }, []);

  const sendUserMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || loading) return;

      const priorMessageCount = messages.length;
      setInput("");

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      try {
        const keyword = extractKeyword(text);
        const historyPayload =
          messages.length > 0
            ? messages.map((m) => ({ role: m.role, content: m.content }))
            : undefined;

        const chatRes = await fetch("/api/chat", {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            query: keyword,
            ...(historyPayload ? { history: historyPayload } : {}),
            priorMessageCount,
            conversationId,
          }),
        });
        const chatData = (await chatRes.json()) as {
          reply?: string;
          error?: string;
          requiresEmailCapture?: boolean;
          debugLlmProductsJson?: string;
          contextProducts?: ChatProductCard[];
        };
        if (!chatRes.ok) {
          throw new Error(chatData.error ?? "Răspunsul expertului nu este disponibil.");
        }

        const reply =
          typeof chatData.reply === "string" && chatData.reply.length > 0
            ? chatData.reply
            : "Nu am primit un răspuns text.";

        const products = normalizeContextProducts(chatData.contextProducts);
        const assistantId = crypto.randomUUID();
        if (dashboardMode && products.length > 0) {
          onProductsChange?.(products);
        }
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: "assistant",
            content: reply,
            requiresEmailCapture: chatData.requiresEmailCapture === true,
            ...(products.length > 0 ? { contextProducts: products } : {}),
            ...(typeof chatData.debugLlmProductsJson === "string" && chatData.debugLlmProductsJson.length > 0
              ? { debugLlmProductsJson: chatData.debugLlmProductsJson }
              : {}),
          },
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "A apărut o eroare.";
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: msg,
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [conversationId, dashboardMode, loading, messages, onOpenHistoryDrawer, onProductsChange]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void sendUserMessage(input);
  }

  const messageList = (
    <div className="flex flex-col gap-3">
      {messages.map((m) => (
        <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
          <div
            className={
              m.role === "user"
                ? "max-w-[85%] rounded-[1.25rem] rounded-br-md bg-neutral-900 px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-sm"
                : "w-full max-w-3xl rounded-[1.25rem] rounded-bl-md bg-white px-4 py-2.5 text-[15px] leading-relaxed text-neutral-800 shadow-sm ring-1 ring-black/[0.06]"
            }
          >
            {m.role === "assistant" ? (
              <div className="w-full space-y-2">
                <AssistantMessageContent
                  content={m.content}
                  messageContextProducts={m.contextProducts}
                  onOpenHistoryDrawer={dashboardMode ? onOpenHistoryDrawer : null}
                />
                {!dashboardMode && m.contextProducts && m.contextProducts.length > 0 ? (
                  <ProductRecommendationCards products={m.contextProducts} variant="thread" />
                ) : null}
                {m.debugLlmProductsJson ? (
                  <details className="rounded-lg border border-amber-200/80 bg-amber-50/90 text-left ring-1 ring-amber-100">
                    <summary className="cursor-pointer select-none px-3 py-2 text-[12px] font-medium text-amber-950">
                      Debug: JSON produse → DeepSeek (înainte de apel)
                    </summary>
                    <pre className="max-h-72 overflow-auto border-t border-amber-200/60 px-3 py-2 text-[11px] leading-snug text-neutral-800 [font-variant-ligatures:none]">
                      {formatDebugProductsJson(m.debugLlmProductsJson)}
                    </pre>
                  </details>
                ) : null}
              </div>
            ) : (
              <p className="whitespace-pre-wrap">{m.content}</p>
            )}
          </div>
        </div>
      ))}
      {loading ? <TypingIndicator /> : null}
      <div ref={bottomRef} />
    </div>
  );

  const scrollAreaClass = hideChrome
    ? "flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 lg:px-2"
    : "flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6";

  const scrollInner =
    messages.length === 0 && !loading ? (
      <EmptyChatPanel onPick={(q) => void sendUserMessage(q)} disabled={loading} />
    ) : (
      messageList
    );

  const formBlock = (
    <form
      onSubmit={handleSubmit}
      className="shrink-0 border-t border-black/[0.06] bg-white/90 px-3 py-3 backdrop-blur-xl pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:border-black/[0.04] lg:bg-white/80"
    >
      <div className="mx-auto flex max-w-3xl gap-2 lg:max-w-none">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ex.: hrană uscată pentru pisici sterilizate"
          disabled={loading}
          className="min-h-[44px] flex-1 rounded-full border border-black/[0.08] bg-white px-4 text-[15px] text-neutral-900 outline-none ring-0 placeholder:text-neutral-400 focus:border-neutral-300 focus:ring-2 focus:ring-neutral-900/10 disabled:opacity-60"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-neutral-900 px-5 text-[14px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          Trimite
        </button>
      </div>
    </form>
  );

  if (hideChrome) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className={scrollAreaClass}>{scrollInner}</div>
        {formBlock}
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-[#f5f5f7] text-neutral-900 antialiased">
      <DashboardHeader onNewChat={resetChat} />

      <div className={scrollAreaClass}>{scrollInner}</div>

      {formBlock}
    </div>
  );
}

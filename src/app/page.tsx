"use client";

import { Chat } from "@/components/Chat";
import { DashboardHeader } from "@/components/DashboardHeader";
import { ProductRecommendationCards } from "@/components/ProductRecommendationCards";
import { chatProductKey, mergeMainAndHistory } from "@/lib/chatProductSession";
import type { ChatProductCard } from "@/sales/chat/types";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

function VitrinaEmptyState() {
  return (
    <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-4 px-6 py-10 text-center">
      <div className="text-neutral-300" aria-hidden>
        <svg className="mx-auto h-24 w-24" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="18" y="28" width="84" height="64" rx="10" className="stroke-current" strokeWidth="2" />
          <path
            d="M38 48h44M38 60h28M38 72h36"
            className="stroke-current"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="88" cy="42" r="8" className="fill-emerald-100 stroke-emerald-400" strokeWidth="1.5" />
          <path
            d="M85 42l2 2 5-5"
            className="stroke-emerald-600"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <p className="max-w-sm text-[15px] font-medium leading-relaxed text-neutral-600">
        Spune-i asistentului ce cauți, iar produsele vor apărea aici!
      </p>
      <p className="max-w-xs text-[13px] text-neutral-400">
        Poți cere categorii, buget sau stil — vitrina se actualizează după fiecare răspuns cu recomandări.
      </p>
    </div>
  );
}

export default function Home() {
  const [currentProducts, setCurrentProducts] = useState<ChatProductCard[]>([]);
  const [sessionHistory, setSessionHistory] = useState<ChatProductCard[]>([]);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [chatSessionKey, setChatSessionKey] = useState(0);
  /** Evită două seturi de carduri cu același `id` (aside ascuns + modal) — rupe scroll/glow la click din chat. */
  const [isDesktopVitrina, setIsDesktopVitrina] = useState(false);

  const currentProductsRef = useRef<ChatProductCard[]>([]);

  useLayoutEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setIsDesktopVitrina(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  currentProductsRef.current = currentProducts;

  const handleProductsChange = useCallback((products: ChatProductCard[]) => {
    const prevMain = currentProductsRef.current;
    setSessionHistory((prevHist) => mergeMainAndHistory(prevMain, prevHist, products).history);
    setCurrentProducts(products);
  }, []);

  const handleNewChat = useCallback(() => {
    setChatSessionKey((k) => k + 1);
    setCurrentProducts([]);
    setSessionHistory([]);
    setHistoryDrawerOpen(false);
  }, []);

  return (
    <>
        <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-[#f5f5f7] text-neutral-900 antialiased">
          <DashboardHeader onNewChat={handleNewChat} />

          <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-3 overflow-hidden px-3 pb-3 pt-2 lg:grid lg:grid-cols-10 lg:gap-4 lg:px-4 lg:pb-4">
            <section className="flex min-h-0 shrink-0 flex-col max-lg:h-[min(52dvh,480px)] lg:col-span-4 lg:h-[calc(100dvh-4rem)] lg:max-h-[calc(100dvh-4rem)]">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white ring-1 ring-black/[0.04]">
                <Chat
                  key={chatSessionKey}
                  hideChrome
                  onProductsChange={handleProductsChange}
                  onOpenHistoryDrawer={() => setHistoryDrawerOpen(true)}
                />
              </div>
            </section>

            <aside className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white ring-1 ring-black/[0.04] lg:col-span-6 lg:h-[calc(100dvh-4rem)] lg:max-h-[calc(100dvh-4rem)] lg:flex-none">
              <div className="shrink-0 border-b border-black/[0.05] px-4 py-3">
                <h2 className="text-[13px] font-semibold uppercase tracking-wide text-neutral-500">Vitrină</h2>
              </div>

              <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain px-4 py-4 [-webkit-overflow-scrolling:touch] lg:overflow-y-auto">
                {currentProducts.length === 0 ? (
                  <VitrinaEmptyState />
                ) : (
                  <div className="space-y-6">
                    <div>
                      <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-neutral-400">
                        Rezultate curente
                      </h3>
                      <ProductRecommendationCards products={currentProducts} variant="showcase-responsive" />
                    </div>

                    {isDesktopVitrina && sessionHistory.length > 0 ? (
                      <div className="border-t border-black/[0.06] pt-6">
                        <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-neutral-400">
                          Văzute anterior
                        </h3>
                        <ProductRecommendationCards
                          products={sessionHistory}
                          variant="showcase-responsive"
                          getItemKey={(p) => chatProductKey(p)}
                        />
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {!isDesktopVitrina && sessionHistory.length > 0 ? (
                <div className="shrink-0 border-t border-black/[0.06] p-3">
                  <button
                    type="button"
                    onClick={() => setHistoryDrawerOpen(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-[14px] font-semibold text-neutral-800 shadow-sm transition hover:bg-neutral-100"
                    aria-expanded={historyDrawerOpen}
                  >
                    Văzute anterior
                    <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[12px] font-bold text-neutral-700">
                      {sessionHistory.length}
                    </span>
                  </button>
                </div>
              ) : null}
            </aside>
          </main>

          {!isDesktopVitrina && historyDrawerOpen && sessionHistory.length > 0 ? (
            <div
              className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
              role="presentation"
              onClick={() => setHistoryDrawerOpen(false)}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="history-drawer-title"
                className="max-h-[min(78dvh,560px)] rounded-t-2xl border border-black/[0.08] bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-black/[0.06] px-4 py-3">
                  <h2 id="history-drawer-title" className="text-[15px] font-semibold text-neutral-900">
                    Văzute anterior
                  </h2>
                  <button
                    type="button"
                    onClick={() => setHistoryDrawerOpen(false)}
                    className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-neutral-600 transition hover:bg-neutral-100"
                  >
                    Închide
                  </button>
                </div>
                <div className="overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                  <ProductRecommendationCards
                    products={sessionHistory}
                    variant="showcase-responsive"
                    getItemKey={(p) => chatProductKey(p)}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>
    </>
  );
}

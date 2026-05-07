"use client";

import type { ChatProductCard } from "@/sales/chat/types";

import { productDomIdFromChatCard } from "@/sales/lib/productShortId";

import { ProductCard } from "./ProductCard";

function formatPriceDisplay(price: string, currency: string): string {
  const p = price.trim();
  if (!p) return `— ${currency}`;
  if (/ron|lei|€|eur|\$|usd|gbp/i.test(p)) return p;
  return `${p} ${currency}`;
}

function toProductCardProps(p: ChatProductCard) {
  return {
    title: p.title,
    price: formatPriceDisplay(p.price, p.currency),
    image_url: p.imageUrl,
    url: p.affiliateUrl,
    ...(p.description?.trim() ? { description: p.description.trim() } : {}),
  };
}

export type ProductRecommendationVariant = "thread" | "showcase" | "row-scroll" | "showcase-responsive";

type ProductRecommendationCardsProps = {
  products: ChatProductCard[];
  /** thread: în bule chat; showcase: grid 2–3; row-scroll: bandă orizontală; showcase-responsive: același set carduri, mobil scroll orizontal / desktop grid. */
  variant?: ProductRecommendationVariant;
  className?: string;
  /** Cheie React stabilă (ex. dedupe după link). */
  getItemKey?: (product: ChatProductCard, index: number) => string;
};

export function ProductRecommendationCards({
  products,
  variant = "thread",
  className = "",
  getItemKey,
}: ProductRecommendationCardsProps) {
  if (products.length === 0) return null;

  const renderProductCell = (p: ChatProductCard, idx: number, cellClass: string) => {
    const rowKey = getItemKey?.(p, idx) ?? `${p.title}-${idx}`;
    const domAnchorId = productDomIdFromChatCard(p);
    const card = <ProductCard product={toProductCardProps(p)} domAnchorId={domAnchorId} />;
    return (
      <div key={rowKey} className={cellClass}>
        {card}
      </div>
    );
  };

  if (variant === "row-scroll") {
    return (
      <div
        className={`flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-neutral-300 ${className}`.trim()}
      >
        {products.map((p, idx) =>
          renderProductCell(p, idx, "flex h-full w-[min(280px,85vw)] shrink-0 snap-start")
        )}
      </div>
    );
  }

  if (variant === "showcase-responsive") {
    return (
      <div
        className={`flex flex-nowrap gap-3 overflow-x-auto overscroll-x-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:thin] max-lg:snap-x max-lg:snap-mandatory lg:grid lg:grid-cols-2 lg:overflow-x-visible lg:pb-0 xl:grid-cols-3 ${className}`.trim()}
      >
        {products.map((p, idx) =>
          renderProductCell(p, idx, "flex h-full w-[min(280px,85vw)] shrink-0 snap-start lg:w-auto lg:min-w-0 lg:shrink")
        )}
      </div>
    );
  }

  const gridClass =
    variant === "showcase"
      ? "grid grid-cols-2 gap-3 xl:grid-cols-3"
      : "mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2";

  return (
    <div className={`${gridClass} ${className}`.trim()}>
      {products.map((p, idx) => renderProductCell(p, idx, "flex h-full min-h-0"))}
    </div>
  );
}

"use client";

import Image from "next/image";
import { useCallback, useState } from "react";

const PLACEHOLDER_SRC = "/product-placeholder-petshop.svg";

export type ProductCardProduct = {
  title: string;
  price: string;
  image_url: string;
  url: string;
  description?: string;
};

type ProductCardProps = {
  product: ProductCardProduct;
  /** `id` pe card pentru scroll din chat (`prod-*`). */
  domAnchorId?: string;
};

function isRemoteOrAbsolute(src: string): boolean {
  return /^https?:\/\//i.test(src.trim());
}

export function ProductCard({ product, domAnchorId }: ProductCardProps) {
  const rawUrl = product.image_url?.trim() ?? "";
  const [imgSrc, setImgSrc] = useState(rawUrl || PLACEHOLDER_SRC);

  const onImgError = useCallback(() => {
    setImgSrc(PLACEHOLDER_SRC);
  }, []);

  const href = product.url?.trim() ?? "";
  const hasLink = href.length > 0;
  const description = product.description?.trim() ?? "";

  const trimmedAnchor = domAnchorId?.trim();
  const anchorId = trimmedAnchor && trimmedAnchor.length > 0 ? trimmedAnchor : undefined;

  return (
    <article
      id={anchorId}
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-black/[0.06] transition-[transform,box-shadow] duration-200 ease-out hover:scale-105 hover:shadow-lg scroll-mt-4"
    >
      <div className="relative aspect-square w-full shrink-0 bg-neutral-50">
        <Image
          src={imgSrc}
          alt={product.title || "Produs"}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className="object-contain p-3"
          unoptimized={isRemoteOrAbsolute(imgSrc)}
          onError={onImgError}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 min-h-[3rem] text-left text-[15px] font-semibold leading-snug text-neutral-900">
          {product.title || "Produs"}
        </h3>
        <div className="min-h-[2.75rem] shrink-0">
          {description ? (
            <p className="line-clamp-2 text-[13px] leading-snug text-neutral-600">{description}</p>
          ) : null}
        </div>
        <p className="shrink-0 text-2xl font-bold tracking-tight text-orange-600 tabular-nums">
          {product.price?.trim() ? product.price : "—"}
        </p>
        {hasLink ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="mt-auto flex w-full shrink-0 items-center justify-center rounded-xl bg-neutral-900 px-4 py-2.5 text-center text-sm font-semibold text-white no-underline shadow-sm transition hover:bg-neutral-800 active:scale-[0.98]"
          >
            Vezi Detalii
          </a>
        ) : (
          <p className="mt-auto shrink-0 text-center text-xs text-neutral-400">Link indisponibil</p>
        )}
      </div>
    </article>
  );
}

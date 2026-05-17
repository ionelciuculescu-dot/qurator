import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getProductByIdOrExternalId,
  type PublicProductPage,
} from "@/lib/feedConfigsDb";

export const revalidate = 86_400;


type PageProps = {
  params: Promise<{ id: string }>;
};

function formatPrice(price: string, currency: string): string {
  const p = price.trim();
  const c = currency.trim() || "RON";
  if (!p) return `— ${c}`;
  if (/ron|lei|€|eur|\$|usd|gbp/i.test(p)) return p;
  return `${p} ${c}`;
}

function semanticDescription(product: PublicProductPage): string {
  const clean = product.description_clean?.trim();
  if (clean) return clean;
  return product.description?.trim() ?? "";
}

function metaDescription(product: PublicProductPage): string {
  const raw = semanticDescription(product).replace(/\s+/g, " ");
  if (!raw) {
    const name = product.name.trim() || "Produs";
    return `Descoperă ${name} pe Qurator — recomandări inteligente și ofertă afiliată.`;
  }
  return raw.length > 160 ? `${raw.slice(0, 157)}…` : raw;
}

function metaTitle(product: PublicProductPage): string {
  const name = product.name.trim() || "Produs";
  const brand = product.brand.trim();
  return brand ? `${name} | ${brand} | Qurator` : `${name} | Qurator`;
}

async function loadProduct(idParam: string): Promise<PublicProductPage | null> {
  return getProductByIdOrExternalId(idParam);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const product = await loadProduct(id);
  if (!product) {
    return { title: "Produs negăsit | Qurator" };
  }

  const title = metaTitle(product);
  const description = metaDescription(product);
  const image = product.image_url?.trim();

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      ...(image ? { images: [{ url: image, alt: product.name }] } : {}),
    },
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { id } = await params;
  const product = await loadProduct(id);
  if (!product) notFound();

  const title = product.name.trim() || "Produs";
  const body = semanticDescription(product);
  const affiliateUrl = product.affiliate_url?.trim() ?? "";
  const imageUrl = product.image_url?.trim() ?? "";
  const niche = product.niche_type.trim();
  const category = product.category.trim();
  const metaLine = [niche, category].filter(Boolean).join(" · ");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    ...(imageUrl ? { image: imageUrl } : {}),
    description: body.slice(0, 200),
    brand: {
      "@type": "Brand",
      name: product.brand.trim() || "Qurator",
    },
    offers: {
      "@type": "Offer",
      price: product.price,
      priceCurrency: product.currency.trim() || "RON",
      availability: "https://schema.org/InStock",
      url: affiliateUrl,
    },
  };

  return (
    <div className="min-h-dvh bg-[#f5f5f7] text-neutral-900 antialiased">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="border-b border-black/[0.06] bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="text-sm font-medium text-violet-700 transition hover:text-violet-900"
          >
            ← Înapoi la Qurator
          </Link>
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-400">
            Produs
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <article className="overflow-hidden rounded-3xl bg-white shadow-lg ring-1 ring-black/[0.06]">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={title}
              className="w-full h-auto object-cover"
              referrerPolicy="no-referrer"
            />
          ) : null}

          <div className="space-y-6 p-6 sm:p-10">
            {metaLine ? (
              <p className="text-xs font-semibold uppercase tracking-wider text-violet-600">
                {metaLine}
              </p>
            ) : null}

            <div>
              {product.brand.trim() ? (
                <p className="text-sm font-medium text-neutral-500">{product.brand.trim()}</p>
              ) : null}
              <h1 className="mt-1 text-2xl font-semibold leading-tight tracking-tight text-neutral-900 sm:text-3xl">
                {title}
              </h1>
              <p className="mt-3 text-xl font-semibold text-emerald-700">
                {formatPrice(product.price, product.currency)}
              </p>
            </div>

            {body ? (
              <section className="prose prose-neutral max-w-none">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">
                  Descriere
                </h2>
                <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-700">
                  {body}
                </p>
              </section>
            ) : null}

            {affiliateUrl ? (
              <a
                href={affiliateUrl}
                target="_blank"
                rel="noopener noreferrer sponsored"
                className="flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-4 text-center text-base font-semibold text-white shadow-lg shadow-emerald-900/20 transition hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                Vezi Oferta / Cumpără
              </a>
            ) : (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Link-ul de ofertă nu este disponibil momentan.
              </p>
            )}
          </div>
        </article>
      </main>
    </div>
  );
}

import type { MetadataRoute } from "next";

import { listProductsForSitemap } from "@/lib/feedConfigsDb";

const BASE_URL = "https://qurator.expert";

/** Revalidare la 24h — evită COUNT/listă la fiecare crawl Google. */
export const revalidate = 86_400;

function productSegment(row: { id: string; external_id: string | null }): string {
  const external = row.external_id?.trim();
  return external && external.length > 0 ? external : row.id;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
  ];

  const rows = await listProductsForSitemap();

  const productPages: MetadataRoute.Sitemap = rows.map((row) => ({
    url: `${BASE_URL}/${encodeURIComponent(productSegment(row))}`,
    lastModified: row.updated_at ?? now,
    changeFrequency: "daily",
    priority: 0.8,
  }));

  return [...staticPages, ...productPages];
}

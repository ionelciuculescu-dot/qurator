/** Produs normalizat pentru UI / chat (fără XML). */
export type ParsedProduct = {
  title: string;
  price: string;
  affiliateLink: string;
  image: string;
  description: string;
  /** Opțional — folosit la curățarea pentru LLM (`categorie`). */
  category?: string;
  /** Rezumat livrare (din `shipping_info` + descriere), pentru LLM / scoring. */
  deliveryPerks?: string;
  /** Din `products.niche_type` (ex. petshop) — folosit la filtre pe nișă. */
  nicheType?: string;
  /**
   * Distanță cosinus pgvector (`embedding <=> query`), doar după căutare vectorială.
   * Valori mai mici = mai apropiat semantic (ex. sub 0.6 = potrivire puternică).
   */
  vectorDistance?: number;
};

/** Rând „esențial” din feed (comision, stoc) înainte de mapare la `ParsedProduct`. */
export type EssentialProduct = {
  title: string;
  price: string;
  affiliateLink: string;
  commissionPct: number;
  inStock: boolean;
  /** Din `<image_urls>` etc., dacă există în feed. */
  image?: string;
  /** Din `<description>` etc. */
  description?: string;
  /** Opțional — text livrare din feed (mapare viitoare în `shipping_info`). */
  shippingNote?: string;
};

export type StreamEssentialsResult = {
  products: EssentialProduct[];
  /** Câte produse au trecut filtrul (comision, stoc), inclusiv cele nereturnate din cauza plafonului. */
  totalMatched: number;
  returnListTruncated: boolean;
};

/** Formă intermediară după `essentialsToParsedProducts`. */
export type EssentialAsParsedProduct = {
  title: string;
  price: string;
  affiliateLink: string;
  image: string;
  description: string;
};

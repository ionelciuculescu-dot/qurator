/** Opțiuni pentru handler-ul chat (cookie sesiune etc.). */
export type HandleChatOptions = {
  requestCookieHeader?: string | null;
};

/** Mesaj din istoricul conversației (fără mesajul curent al userului — acela e în `message`). */
export type ChatHistoryTurn = {
  role: "user" | "assistant";
  content: string;
};

/** Body JSON așteptat de la `POST /api/chat`. */
export type ChatRequestBody = {
  message: string;
  /** Opțional — filtrare pe titlu/descriere în interiorul catalogului deja încărcat. */
  query?: string;
  /**
   * Istoric user/asistent din sesiunea curentă (înainte de `message`).
   * Serverul păstrează ultimele turări ca să nu depășească contextul modelului.
   */
  history?: ChatHistoryTurn[];
  /**
   * Număr de mesaje deja în thread înainte de mesajul curent (user + asistent).
   * Dacă > 1, sesiunea a început deja — serverul poate evita saluturi repetate și poate trimite instrucțiuni LLM de continuitate.
   */
  priorMessageCount?: number;
  /** Identificator stabil per thread UI (rezervat; opțional pentru viitoare persistență server). */
  sessionId?: string;
  /** Identificator stabil per conversație pentru loguri și `appendConversationIdToClickLinks`. */
  conversationId?: string;
};

/** Produs pentru carduri în UI (chat) — aliniat la `ParsedProduct` / PG (`image` ← image_url, `affiliateLink` ← affiliate_url). */
export type ChatProductCard = {
  title: string;
  imageUrl: string;
  price: string;
  currency: string;
  affiliateUrl: string;
  /** Id scurt stabil (6 [a-z0-9]) — unic în sesiunea de răspuns; DOM `id="prod-{productShortId}"`. */
  productShortId: string;
  /** Opțional — scurtătură din descrierea catalogului pentru vitrină. */
  description?: string;
};

/** Payload de succes serializat în răspunsul JSON. */
export type ChatSuccessPayload = {
  reply: string;
  productsInContext: number;
  recommendedProductTitle: string;
  /** `true` dacă UI afișează CTA captură email (ex. după conținut extern). */
  requiresEmailCapture: boolean;
  /** Produse din ultimul `search_stock` — carduri în chat. */
  contextProducts?: ChatProductCard[];
  /** Opțional: JSON produse trimise la model (debug). */
  debugLlmProductsJson?: string;
};

/**
 * Catalog gol: răspuns fără LLM.
 * Ton politicos — ofertele sunt actualizate de sistem, nu de chat.
 */
export const CATALOG_STALE_MESSAGE =
  "Îți mulțumesc pentru mesaj. Momentan ofertele sunt în curs de actualizare, iar nu am încă o listă de produse la care să mă raportez. Te rog să revii peste câteva minute — atunci voi putea recomanda din catalogul actualizat.";

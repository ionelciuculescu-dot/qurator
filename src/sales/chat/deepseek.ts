import type { CatalogReader } from "@/shared/ports/catalog-reader";

import { handleChatAgenticFromParsed } from "./agentic/run-agentic-chat-turn";
import type { HandleChatOptions } from "./types";

export type { ChatRequestBody, ChatSuccessPayload, HandleChatOptions } from "./types";
export { CATALOG_STALE_MESSAGE } from "./types";

/**
 * Chat: DeepSeek + function calling (`search_stock`) și catalog prin `CatalogReader` (Postgres vector).
 */
export async function handleChatFromParsed(
  raw: unknown,
  getCatalogReader: () => CatalogReader,
  options?: HandleChatOptions
): Promise<Response> {
  return handleChatAgenticFromParsed(raw, getCatalogReader, options);
}

export async function handleChatRequest(req: Request, getCatalogReader: () => CatalogReader): Promise<Response> {
  const raw = await req.json().catch(() => null);
  return handleChatFromParsed(raw, getCatalogReader, { requestCookieHeader: req.headers.get("cookie") });
}

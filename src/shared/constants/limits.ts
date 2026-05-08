/** Limită implicită feed „full parse” (chunk-uri / listă). */
export const MAX_PRODUCTS = 20;

/** Limită implicită între 15–20 produse (balans tokeni AI / DeepSeek). */
export const STORE_FEED_AI_LIMIT = 18;

/** `PostgresCatalogReader.listProducts`: maxim după grupare pe titlu similar. */
export const LIST_PRODUCTS_MAX = 8;

/** Rânduri citite din DB înainte de grupare (trebuie suficiente pentru `LIST_PRODUCTS_MAX` familii). */
export const LIST_PRODUCTS_PREFETCH_ROWS = 250;

/** Descriere tăiată în contextul chat înainte de serializare / LLM. */
export const CHAT_PRODUCT_DESCRIPTION_MAX = 300;

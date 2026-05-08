import { createHash } from "node:crypto";

export function generateContentHash(
  title: string,
  description: string,
  price: string | number,
): string {
  const payload = JSON.stringify({ title, description, price });
  return createHash("md5").update(payload, "utf8").digest("hex");
}

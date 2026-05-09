import { VITRINA_UNIFIED_USER_TAG } from "./agent-config";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bodyLooksLikeVitrinaCanoniceJson(fenceBody: string): boolean {
  const b = fenceBody.replace(/^[a-z]*\s*/i, "").trimStart();
  return (
    /["']produse_vitrina_canonice["']\s*:/.test(b) ||
    /^produse_vitrina_canonice\s*:/m.test(b) ||
    (b.includes("product_short_id") && b.includes("produs_slot"))
  );
}

/** Elimină blocuri ``` … ``` care conțin JSON-ul vitrinei canonice (modelul le recopiază uneori). */
function stripFencedVitrinaBlocks(text: string): string {
  const parts = text.split("```");
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i] ?? "";
    if (i % 2 === 0) {
      out += seg;
      continue;
    }
    if (bodyLooksLikeVitrinaCanoniceJson(seg)) {
      continue;
    }
    out += "```" + seg + "```";
  }
  return out;
}

/**
 * DeepSeek poate recopia mesajul sintetic cu tag + JSON. Nu trebuie afișat în UI.
 */
export function stripVitrinaUnifiedLeakFromReply(reply: string): string {
  const tagEscaped = escapeRe(VITRINA_UNIFIED_USER_TAG);
  let out = reply.replace(new RegExp(`${tagEscaped}\\s*[\\s\\S]*`, "g"), "");
  out = stripFencedVitrinaBlocks(out);
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

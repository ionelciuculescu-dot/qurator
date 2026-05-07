import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE = "admin_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 zile

function secret(): string {
  return process.env.ADMIN_PASSWORD ?? "";
}

/** Creează token HMAC: payload.exp în ms + nonce */
export function createAdminSessionToken(): string | null {
  const s = secret();
  if (!s) return null;
  const exp = Date.now() + MAX_AGE_SEC * 1000;
  const nonce = randomBytes(16).toString("hex");
  const payload = `${exp}.${nonce}`;
  const sig = createHmac("sha256", s).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export function verifyAdminSessionToken(token: string): boolean {
  const s = secret();
  if (!s || !token.includes(".")) return false;
  const lastDot = token.lastIndexOf(".");
  const encPayload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  let payload: string;
  try {
    payload = Buffer.from(encPayload, "base64url").toString("utf-8");
  } catch {
    return false;
  }
  const expected = createHmac("sha256", s).update(payload).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    if (!timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }
  const expStr = payload.split(".")[0];
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  return true;
}

export function getAdminSessionCookieName(): string {
  return COOKIE;
}

export function parseAdminCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((c) => c.trim());
  for (const p of parts) {
    if (p.startsWith(`${COOKIE}=`)) {
      return decodeURIComponent(p.slice(COOKIE.length + 1));
    }
  }
  return null;
}

export function verifyAdminRequest(cookieHeader: string | null): boolean {
  const token = parseAdminCookieHeader(cookieHeader);
  if (!token) return false;
  return verifyAdminSessionToken(token);
}

export function buildAdminSessionSetCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure}`;
}

export function buildAdminSessionClearCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

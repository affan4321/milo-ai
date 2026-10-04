import { createHash, timingSafeEqual } from "node:crypto";

/** Bearer-token check for the meeting bot. Compares digests so length and timing leak nothing. */
export function botAuthorized(req: Request): boolean {
  const expected = process.env.BOT_TOKEN;
  if (!expected || expected.length < 16) return false; // no usable token configured -> bot API is closed
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = createHash("sha256").update(given).digest(), b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
export const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });

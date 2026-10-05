import http from "node:http";
import crypto from "node:crypto";
import type { EmbedTask } from "@milo/providers";

type Embed = (texts: string[], task?: EmbedTask) => Promise<number[][]>;
const MAX_TEXTS = 64, MAX_BODY = 256 * 1024;
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * POST /embed {texts, task} -> {vectors}. Lets the web app on serverless hosting use this machine's local embedding model.
 * Requires the shared bearer token; small bodies only (search queries), so it can't be used to burn CPU on big jobs.
 */
export function createEmbedServer(embed: Embed, token: string) {
  return http.createServer(async (req, res) => {
    const send = (code: number, body: object) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.method === "GET" && req.url === "/health") return send(200, { ok: true });
    if (req.method !== "POST" || req.url !== "/embed") return send(404, { error: "not found" });
    const auth = req.headers.authorization ?? "";
    if (!token || !same(auth, `Bearer ${token}`)) return send(401, { error: "unauthorized" });
    let body = ""; let size = 0;
    for await (const c of req) { size += (c as Buffer).length; if (size > MAX_BODY) return send(413, { error: "too large" }); body += c; }
    try {
      const j = JSON.parse(body) as { texts?: unknown; task?: unknown };
      if (!Array.isArray(j.texts) || !j.texts.length || j.texts.length > MAX_TEXTS || !j.texts.every((t) => typeof t === "string")) return send(400, { error: "texts must be 1-64 strings" });
      const task: EmbedTask = j.task === "query" ? "query" : "document";
      send(200, { vectors: await embed(j.texts as string[], task) });
    } catch (e) { send(e instanceof SyntaxError ? 400 : 500, { error: e instanceof SyntaxError ? "invalid json" : "embedding failed" }); }
  });
}

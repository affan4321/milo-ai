import fs from "node:fs";
import { Readable } from "node:stream";
import type { BotFailReason, Sidecar } from "@milo/core";
import { config } from "./config";

const headers = () => ({ authorization: `Bearer ${config.botToken}` });
const url = (id: string, p = "") => `${config.webUrl}/api/bot/sessions/${id}${p}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry transient failures (network, 5xx); give up immediately on 4xx, which retrying can't fix. */
async function withRetry<T>(label: string, fn: () => Promise<T>, delays = [1000, 4000, 15000]): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      const permanent = e instanceof HttpError && e.status < 500;
      if (permanent || i >= delays.length) throw e;
      console.warn(`[api] ${label} failed (${e instanceof Error ? e.message : e}); retrying in ${delays[i]}ms`);
      await sleep(delays[i]!);
    }
  }
}
export class HttpError extends Error { constructor(readonly status: number, msg: string) { super(msg); } }
/**
 * Our API answers real errors with JSON. A 404 that is NOT JSON is the framework's HTML error page, which Next.js serves for a few
 * seconds while it recompiles (or a proxy serves during a deploy). That is an outage, not "no such session", so it is treated as
 * a 503 and retried instead of being believed.
 */
async function check(res: Response) {
  if (res.ok) return res;
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  const status = res.status === 404 && !isJson ? 503 : res.status;
  throw new HttpError(status, `HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 120)}`);
}

export const api = {
  /** Tell the web app this bot exists and whether it is busy. Best-effort: a missed beat just looks like a short silence. */
  async workerBeat(id: string, busy: boolean, sessionId?: string): Promise<void> {
    try { await check(await fetch(`${config.webUrl}/api/bot/workers`, { method: "POST", headers: { ...headers(), "content-type": "application/json" }, body: JSON.stringify({ id, busy, sessionId: sessionId ?? null }), signal: AbortSignal.timeout(10_000) })); }
    catch (e) { console.warn(`[api] worker beat failed: ${e instanceof Error ? e.message : e}`); }
  },
  /** Retries through a short outage of the web app. Returns {state:"unknown"} only when the app really says there is no such session. */
  async getState(id: string): Promise<{ state: string } | null> {
    try {
      return await withRetry("getState", async () => (await check(await fetch(url(id), { headers: headers(), signal: AbortSignal.timeout(15_000) }))).json() as Promise<{ state: string }>, [1000, 2000, 4000, 8000, 15000, 30000]);
    } catch (e) { return e instanceof HttpError && e.status === 404 ? { state: "unknown" } : null; }
  },
  /** Reporting is best-effort: a hiccup must never kill a recording in progress. */
  async report(id: string, state: string, reason?: BotFailReason, extra?: { recordingStartedAtMs?: number; participants?: number }): Promise<void> {
    try {
      await withRetry("state", async () => { await check(await fetch(url(id), { method: "POST", headers: { ...headers(), "content-type": "application/json" }, body: JSON.stringify({ state, reason, ...extra }), signal: AbortSignal.timeout(15_000) })); }, [500, 2000]);
    } catch (e) { console.warn(`[api] could not report ${state}: ${e instanceof Error ? e.message : e}`); }
  },
  /** `/milo highlight` was typed in the meeting chat. Returns whether a NEW highlight was saved (repeats are de-duplicated server-side). */
  async highlight(id: string, h: { atMs: number; by: string; note: string | null }): Promise<{ created: boolean } | null> {
    try {
      const res = await withRetry("highlight", async () => check(await fetch(url(id, "/highlights"), { method: "POST", headers: { ...headers(), "content-type": "application/json" }, body: JSON.stringify(h), signal: AbortSignal.timeout(15_000) })), [500, 2000]);
      return (await res.json()) as { created: boolean };
    } catch (e) { console.warn(`[api] highlight not saved: ${e instanceof Error ? e.message : e}`); return null; }
  },
  /** Ask the web app where files go: "direct" = a presigned bucket URL (hosted storage), "proxy" = send through the web app (local disk). */
  async uploadTarget(id: string, kind: "recording" | "sidecar", ext = "mp4"): Promise<{ mode: "direct"; url: string; contentType: string } | { mode: "proxy" }> {
    return withRetry("upload-url", async () => (await check(await fetch(url(id, "/upload-url"), { method: "POST", headers: { ...headers(), "content-type": "application/json" }, body: JSON.stringify({ kind, ext }), signal: AbortSignal.timeout(15_000) }))).json() as Promise<{ mode: "direct"; url: string; contentType: string } | { mode: "proxy" }>);
  },
  async uploadSidecar(id: string, sidecar: Sidecar) {
    const target = await api.uploadTarget(id, "sidecar");
    const body = JSON.stringify(sidecar);
    await withRetry("sidecar", async () => {
      if (target.mode === "direct") await check(await fetch(target.url, { method: "PUT", headers: { "content-type": target.contentType }, body, signal: AbortSignal.timeout(60_000) }));
      else await check(await fetch(url(id, "/sidecar"), { method: "PUT", headers: { ...headers(), "content-type": "application/json" }, body, signal: AbortSignal.timeout(60_000) }));
    });
  },
  async uploadRecording(id: string, file: string, ext = "mp4") {
    const target = await api.uploadTarget(id, "recording", ext);
    await withRetry("recording", async () => {
      // duplex:'half' lets fetch stream a request body from disk, so a 300 MB recording is never held in memory.
      const stream = Readable.toWeb(fs.createReadStream(file)) as never;
      if (target.mode === "direct") {
        // Straight to the bucket; hosted storage needs the exact length up front (a chunked body is refused). Then tell the web app to start processing.
        await check(await fetch(target.url, { method: "PUT", headers: { "content-type": target.contentType, "content-length": String(fs.statSync(file).size) }, body: stream, duplex: "half", signal: AbortSignal.timeout(30 * 60_000) } as RequestInit));
        await check(await fetch(url(id, `/recording/complete?ext=${ext}`), { method: "POST", headers: headers(), signal: AbortSignal.timeout(30_000) }));
      } else {
        await check(await fetch(url(id, `/recording?ext=${ext}`), { method: "PUT", headers: { ...headers(), "content-type": "application/octet-stream" }, body: stream, duplex: "half", signal: AbortSignal.timeout(30 * 60_000) } as RequestInit));
      }
    }, [5000, 20000, 60000]);
  },
};

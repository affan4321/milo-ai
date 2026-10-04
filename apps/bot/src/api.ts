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
async function check(res: Response) { if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`); return res; }

export const api = {
  /** Tell the web app this bot exists and whether it is busy. Best-effort: a missed beat just looks like a short silence. */
  async workerBeat(id: string, busy: boolean, sessionId?: string): Promise<void> {
    try { await check(await fetch(`${config.webUrl}/api/bot/workers`, { method: "POST", headers: { ...headers(), "content-type": "application/json" }, body: JSON.stringify({ id, busy, sessionId: sessionId ?? null }), signal: AbortSignal.timeout(10_000) })); }
    catch (e) { console.warn(`[api] worker beat failed: ${e instanceof Error ? e.message : e}`); }
  },
  async getState(id: string): Promise<{ state: string } | null> {
    try { return await (await check(await fetch(url(id), { headers: headers(), signal: AbortSignal.timeout(15_000) }))).json() as { state: string }; }
    catch { return null; }
  },
  /** Reporting is best-effort: a hiccup must never kill a recording in progress. */
  async report(id: string, state: string, reason?: BotFailReason): Promise<void> {
    try {
      await withRetry("state", async () => { await check(await fetch(url(id), { method: "POST", headers: { ...headers(), "content-type": "application/json" }, body: JSON.stringify({ state, reason }), signal: AbortSignal.timeout(15_000) })); }, [500, 2000]);
    } catch (e) { console.warn(`[api] could not report ${state}: ${e instanceof Error ? e.message : e}`); }
  },
  async uploadSidecar(id: string, sidecar: Sidecar) {
    await withRetry("sidecar", async () => { await check(await fetch(url(id, "/sidecar"), { method: "PUT", headers: { ...headers(), "content-type": "application/json" }, body: JSON.stringify(sidecar), signal: AbortSignal.timeout(60_000) })); });
  },
  async uploadRecording(id: string, file: string, ext = "mp4") {
    await withRetry("recording", async () => {
      // duplex:'half' lets fetch stream a request body from disk, so a 300 MB recording is never held in memory.
      await check(await fetch(url(id, `/recording?ext=${ext}`), { method: "PUT", headers: { ...headers(), "content-type": "application/octet-stream" }, body: Readable.toWeb(fs.createReadStream(file)) as never, duplex: "half", signal: AbortSignal.timeout(30 * 60_000) } as RequestInit));
    }, [5000, 20000, 60000]);
  },
};

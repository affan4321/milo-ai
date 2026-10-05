import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DailyQuotaError, PermanentError } from "@milo/core";
import type { SttInput, SttProvider, StorageProvider, TranscriptSegmentOut } from "../types";

export interface WhisperOptions { apiKey: string; baseUrl: string; model: string; fetch?: typeof fetch; chunkSeconds?: number; cut?: (file: string, startSec: number, lenSec: number, out: string) => Promise<void> }

function ffmpegCut(file: string, startSec: number, lenSec: number, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(startSec), "-t", String(lenSec), "-i", file, "-c", "copy", out], { stdio: ["ignore", "ignore", "pipe"] });
    let err = ""; p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => reject(e.message.includes("ENOENT") ? new Error("ffmpeg is not installed") : e));
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg failed to cut audio: ${err.slice(-200)}`))));
  });
}

/** Whisper emits phantom sentences ("Thanks for watching") over silence. Its own confidence numbers identify them. */
export const looksLikeNoise = (s: { no_speech_prob?: number; avg_logprob?: number; compression_ratio?: number }) =>
  ((s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -1) || (s.compression_ratio ?? 0) > 2.4;

/**
 * Speech-to-text with Whisper through an OpenAI-compatible endpoint (Groq). Used as a FALLBACK for Gemini audio.
 * Gives accurate text with REAL word timestamps, but Whisper does not tell speakers apart: every line is "Speaker 1".
 * (When the meeting came from the bot, speaker names are still applied afterwards from the live captions.)
 */
export class WhisperStt implements SttProvider {
  constructor(private o: WhisperOptions) {}

  async transcribe(input: SttInput, storage: StorageProvider): Promise<TranscriptSegmentOut[]> {
    if (!this.o.apiKey) throw new PermanentError("Whisper: API key is not set.");
    const file = await storage.toLocalFile(input.key);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "milo-whisper-"));
    const chunk = this.o.chunkSeconds ?? 1800, cut = this.o.cut ?? ffmpegCut;
    const out: TranscriptSegmentOut[] = [];
    try {
      for (let startSec = 0, n = 0; startSec * 1000 < input.durationMs; startSec += chunk, n++) {
        const lenSec = Math.min(chunk, Math.ceil(input.durationMs / 1000) - startSec);
        const part = path.join(tmp, `c${n}.m4a`);
        await cut(file, startSec, lenSec, part);
        out.push(...(await this.chunk(part, startSec * 1000)));
      }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    return out;
  }

  private async chunk(file: string, offsetMs: number): Promise<TranscriptSegmentOut[]> {
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(file)], { type: "audio/mp4" }), "audio.m4a");
    form.append("model", this.o.model); form.append("response_format", "verbose_json"); form.append("temperature", "0");
    form.append("timestamp_granularities[]", "word"); form.append("timestamp_granularities[]", "segment");
    const res = await (this.o.fetch ?? fetch)(`${this.o.baseUrl.replace(/\/$/, "")}/audio/transcriptions`, { method: "POST", headers: { authorization: `Bearer ${this.o.apiKey}` }, body: form, signal: AbortSignal.timeout(300_000) });
    if (!res.ok) {
      const body: any = await res.json().catch(() => ({}));
      const msg: string = body?.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 429) {
        if (/per day|\(ASD\)|\(RPD\)/i.test(msg)) throw new DailyQuotaError("Whisper's daily audio allowance is used up.", this.o.model, Number(res.headers.get("retry-after")) || undefined);
        throw new Error(`Whisper rate limit reached; retrying. ${msg.slice(0, 120)}`);   // hourly audio-seconds cap: clears on its own
      }
      if (res.status >= 500) throw new Error(`Whisper is temporarily unavailable (${res.status}).`);
      if (res.status === 401 || res.status === 403) throw new PermanentError("Whisper rejected the API key.");
      throw new PermanentError(`Whisper request failed: ${msg.slice(0, 200)}`);
    }
    const j: any = await res.json();
    const words: { word: string; start: number; end: number }[] = Array.isArray(j.words) ? j.words : [];
    return (Array.isArray(j.segments) ? j.segments : []).flatMap((s: any) => {
      const text = String(s.text ?? "").trim();
      if (!text || looksLikeNoise(s)) return [];
      const ws = words.filter((w) => w.start >= s.start - 0.05 && w.end <= s.end + 0.05);
      return [{
        speakerLabel: "Speaker 1", startMs: offsetMs + Math.round(s.start * 1000), endMs: offsetMs + Math.round(s.end * 1000), text,
        words: ws.length ? ws.map((w) => ({ w: w.word.trim(), s: offsetMs + Math.round(w.start * 1000), e: offsetMs + Math.round(w.end * 1000) })) : text.split(/\s+/).map((w, i, a) => ({ w, s: offsetMs + Math.round((s.start + ((s.end - s.start) * i) / a.length) * 1000), e: offsetMs + Math.round((s.start + ((s.end - s.start) * (i + 1)) / a.length) * 1000) })),
      }];
    });
  }
}

/** Gemini first; Whisper only when Gemini's daily audio allowance is used up. Everything else propagates (and is retried by the queue). */
export class FallbackStt implements SttProvider {
  constructor(private primary: SttProvider, private backup: SttProvider, private onFallback?: (why: string) => void) {}
  async transcribe(input: SttInput, storage: StorageProvider) {
    try { return await this.primary.transcribe(input, storage); }
    catch (e) { if (!(e instanceof DailyQuotaError)) throw e; this.onFallback?.(e.message); return this.backup.transcribe(input, storage); }
  }
}

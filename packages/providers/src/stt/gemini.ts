import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isPermanent } from "@milo/core";
import type { SttInput, SttProvider, StorageProvider, TranscriptSegmentOut } from "../types";
import { geminiJsonFallback, type GeminiClientOptions } from "../llm/client";
import { normalizeChunk } from "./normalize";

const SCHEMA = {
  type: "OBJECT", required: ["segments"],
  properties: { segments: { type: "ARRAY", items: { type: "OBJECT", required: ["speaker", "start", "text"],
    properties: { speaker: { type: "STRING" }, start: { type: "STRING" }, text: { type: "STRING" } } } } },
};

const SYSTEM = `You are a meticulous meeting transcriber. Transcribe the audio verbatim, in the language spoken.
Split it into utterances, one per speaker turn or long pause. For each give: "speaker", "start" and "text".
- "start" is MM:SS from the START OF THIS AUDIO FILE (not the whole meeting).
- Label voices "Speaker 1", "Speaker 2", ... Use the SAME label for the SAME voice throughout, and a new number only for a new voice.
- Do not describe sounds, music or silence. Never invent speech: if nobody speaks, return an empty list.`;

export interface GeminiSttOptions extends GeminiClientOptions {
  /** Tried in order when the primary model's daily quota is spent. Keep to models verified for diarization. */
  fallbackModels?: string[];
  chunkSeconds?: number;
  /** Delays between retries of a transient failure on one chunk. Injectable so tests don't wait. */
  retryDelaysMs?: number[];
  /** Cuts [startSec, startSec+lenSec) of an audio file to a new file; defaults to ffmpeg stream-copy. */
  cut?: (file: string, startSec: number, lenSec: number, out: string) => Promise<void>;
}

function ffmpegCut(file: string, startSec: number, lenSec: number, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(startSec), "-t", String(lenSec), "-i", file, "-c", "copy", out], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => reject(e.message.includes("ENOENT") ? new Error("ffmpeg is not installed") : e));
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg failed to cut audio: ${err.slice(-200)}`))));
  });
}

/**
 * Speech-to-text with Gemini audio understanding. The recording's audio is cut into chunks (so each response stays far below the
 * output limit and timestamps stay accurate), sent inline one after another, and each chunk is told how the previous one ended so
 * speaker labels stay consistent. Retries happen per chunk, so a rate limit on chunk 5 never re-spends chunks 1-4.
 */
export class GeminiStt implements SttProvider {
  private chunk: number;
  constructor(private o: GeminiSttOptions) { this.chunk = o.chunkSeconds ?? 1800; }

  async transcribe(input: SttInput, storage: StorageProvider): Promise<TranscriptSegmentOut[]> {
    const file = await storage.toLocalFile(input.key);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "milo-stt-"));
    const cut = this.o.cut ?? ffmpegCut;
    const out: TranscriptSegmentOut[] = [];
    // Once a model's daily quota runs out we stay on the next one for the rest of the recording, so labels stay consistent.
    let models = [this.o.model ?? "gemini-3.5-flash", ...(this.o.fallbackModels ?? [])];
    try {
      for (let startSec = 0, n = 0; startSec * 1000 < input.durationMs; startSec += this.chunk, n++) {
        const lenSec = Math.min(this.chunk, Math.ceil(input.durationMs / 1000) - startSec);
        const part = path.join(tmp, `c${n}.m4a`);
        await cut(file, startSec, lenSec, part);
        const data = fs.readFileSync(part).toString("base64");
        const r = await this.withRetry(() => geminiJsonFallback(this.o, models, {
          system: SYSTEM, schema: SCHEMA, temperature: 0,
          parts: [{ text: this.context(out) + `\nThis audio file is ${lenSec} seconds long. Transcribe it.` }, { inlineData: { mimeType: "audio/mp4", data } }],
        }, (from, to, why) => console.warn(`[gemini-stt] ${from} ${why === "quota" ? "daily limit reached" : "is overloaded"}; continuing on ${to}`)));
        models = models.slice(models.indexOf(r.model));
        out.push(...normalizeChunk(r.data, startSec * 1000, lenSec * 1000));
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    return out;
  }

  /** Tail of what's been transcribed so far, so the next chunk reuses speaker labels. */
  private context(done: TranscriptSegmentOut[]): string {
    if (!done.length) return "This is the start of the recording.";
    const labels = [...new Set(done.map((s) => s.speakerLabel))];
    const tail = done.slice(-4).map((s) => `${s.speakerLabel}: ${s.text}`).join("\n");
    return `This audio continues a longer meeting. Speakers so far: ${labels.join(", ")}.\nThe previous part ended with:\n${tail}\nReuse these labels for the same voices.`;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const delays = this.o.retryDelaysMs ?? [5_000, 20_000]; // short: when Gemini stays down, a backup provider (Whisper) takes over after the queue gives up on it
    for (let i = 0; ; i++) {
      try { return await fn(); }
      catch (e) {
        if (isPermanent(e) || i >= delays.length) throw e instanceof Error ? e : new Error(String(e));
        await new Promise((r) => setTimeout(r, delays[i]));
      }
    }
  }
}


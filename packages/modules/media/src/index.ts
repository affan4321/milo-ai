import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { PermanentError } from "@milo/core";
import { recordings, meetings, runStage, type Db } from "@milo/db";
import type { StorageProvider } from "@milo/providers";

function run(cmd: string, args: string[], timeoutMs = 30 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const t = setTimeout(() => { p.kill("SIGKILL"); reject(new Error(`${cmd} timed out`)); }, timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    p.on("error", (e) => { clearTimeout(t); reject(e.message.includes("ENOENT") ? new Error(`${cmd} is not installed`) : e); });
    p.on("close", (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(`${cmd} failed: ${err.trim().split("\n").slice(-3).join(" | ")}`)); });
  });
}

export async function probe(file: string) {
  const j = JSON.parse(await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], 60_000));
  const hasVideo = (j.streams ?? []).some((s: any) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  const hasAudio = (j.streams ?? []).some((s: any) => s.codec_type === "audio");
  return { durationMs: Math.round(Number(j.format?.duration ?? 0) * 1000), hasVideo, hasAudio };
}

/**
 * media stage: probe, make a seekable playable file, extract small mono audio for speech-to-text.
 * Idempotent: outputs have fixed keys and are overwritten on retry.
 */
export async function processMedia(db: Db, storage: StorageProvider, recordingId: string) {
  return runStage(db, recordingId, "media", async () => {
    const [rec] = await db.select().from(recordings).where(eq(recordings.id, recordingId));
    if (!rec?.rawKey) throw new Error("recording has no raw file");
    const raw = await storage.toLocalFile(rec.rawKey);
    const info = await probe(raw);
    if (!info.hasAudio) throw new PermanentError("This file has no audio track, so there is nothing to transcribe.");
    if (!info.durationMs) throw new PermanentError("Could not read the duration of this file.");

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "milo-media-"));
    try {
      const base = `meetings/${rec.meetingId}`;
      let playableKey: string;
      if (info.hasVideo) {
        const out = path.join(tmp, "playable.mp4");
        // Fast path: stream-copy remux. Falls back to a re-encode when the codecs can't live in mp4 (e.g. vp9/opus webm).
        try { await run("ffmpeg", ["-y", "-i", raw, "-c", "copy", "-movflags", "+faststart", out]); }
        catch { await run("ffmpeg", ["-y", "-i", raw, "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", out]); }
        playableKey = `${base}/playable.mp4`;
        await storage.putFile(playableKey, out);
      } else {
        const out = path.join(tmp, "playable.m4a");
        await run("ffmpeg", ["-y", "-i", raw, "-vn", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", out]);
        playableKey = `${base}/playable.m4a`;
        await storage.putFile(playableKey, out);
      }
      const audio = path.join(tmp, "audio.m4a");
      await run("ffmpeg", ["-y", "-i", raw, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "48k", audio]);
      const audioKey = `${base}/audio.m4a`;
      await storage.putFile(audioKey, audio);

      await db.update(recordings).set({ playableKey, audioKey, durationMs: info.durationMs }).where(eq(recordings.id, recordingId));
      await db.update(meetings).set({ status: "processing" }).where(eq(meetings.id, rec.meetingId));
      return { meetingId: rec.meetingId, durationMs: info.durationMs };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}

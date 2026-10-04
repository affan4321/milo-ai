import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import { config } from "./config";

export interface Recording {
  file: string; startedAtMs: number;
  /** Resolves if ffmpeg dies while we still expect it to be recording. */
  died: Promise<void>;
  stop(): Promise<{ bytes: number }>;
}

/**
 * Records the virtual display and the virtual audio sink with ffmpeg: 720p, ~600 kbps video, 64 kbps mono audio
 * (about 300 MB per hour). Fragmented MP4, so a crash or kill mid-call still leaves a playable file.
 */
export async function startRecording(file: string): Promise<Recording> {
  fs.mkdirSync(file.replace(/\/[^/]+$/, ""), { recursive: true });
  const args = [
    "-y", "-loglevel", "error", "-nostats", "-progress", "pipe:1",
    "-f", "x11grab", "-draw_mouse", "0", "-framerate", "15", "-video_size", config.videoSize, "-i", config.display,
    "-f", "pulse", "-i", config.pulseSource,
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-b:v", "600k", "-maxrate", "700k", "-bufsize", "1400k", "-pix_fmt", "yuv420p", "-g", "30",
    "-c:a", "aac", "-b:a", "64k", "-ac", "1",
    "-movflags", "+frag_keyframe+empty_moov+default_base_moof", file,
  ];
  const p: ChildProcessWithoutNullStreams = spawn("ffmpeg", args);
  let err = "", exited: number | null = null;
  p.stderr.on("data", (d) => (err = (err + d).slice(-1500)));
  const done = new Promise<void>((r) => p.on("close", (c) => { exited = c ?? 1; r(); }));

  // Recording time 0 = the first frame ffmpeg actually writes, not the moment we spawned it.
  const startedAtMs = await new Promise<number>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ffmpeg produced no output within 15s: ${err.trim() || "no error output"}`)), 15_000);
    p.stdout.on("data", (d: Buffer) => { const m = /out_time_us=(\d+)/.exec(String(d)); if (m && Number(m[1]) >= 0) { clearTimeout(t); resolve(Date.now() - Number(m[1]) / 1000); } });
    p.on("close", () => { clearTimeout(t); reject(new Error(`ffmpeg exited early (${exited}): ${err.trim()}`)); });
  }).catch((e) => { p.kill("SIGKILL"); throw e; });

  let stopping = false;
  const died = done.then(() => new Promise<void>((resolve) => { if (!stopping) resolve(); })); // never resolves after a normal stop
  return {
    file, startedAtMs, died,
    async stop() {
      stopping = true;
      if (exited === null) { p.stdin.write("q"); setTimeout(() => exited === null && p.kill("SIGKILL"), 15_000); }
      await done;
      return { bytes: fs.existsSync(file) ? fs.statSync(file).size : 0 };
    },
  };
}

import fs from "node:fs";
import path from "node:path";
import { isBotName, parseHighlightCommand, CONSENT_MESSAGE, type BotFailReason, type BotJob } from "@milo/core";
import { api as realApi, HttpError } from "./api";
import { config } from "./config";
import { MeetAdapter } from "./platforms/meet";
import { TeamsAdapter } from "./platforms/teams";
import { ZoomAdapter } from "./platforms/zoom";
import type { EndReason, PlatformAdapter } from "./platforms/types";
import { startRecording, type Recording } from "./recorder";
import { SidecarCollector } from "./sidecar";

export interface Deps {
  makeAdapter(platform: string): PlatformAdapter;
  record(file: string): Promise<Recording>;
  api: Pick<typeof realApi, "getState" | "report" | "uploadSidecar" | "uploadRecording" | "highlight">;
  cfg: Pick<typeof config, "dataDir" | "heartbeatMs" | "aloneGraceMs" | "aloneAtStartMs" | "maxMeetingMs">;
}
export const defaultDeps: Deps = {
  makeAdapter: (platform) => { if (platform === "meet") return new MeetAdapter(); if (platform === "teams") return new TeamsAdapter(); if (platform === "zoom") return new ZoomAdapter(); throw new Error(`no join script for ${platform} yet`); },
  record: startRecording, api: realApi, cfg: config,
};

/** Anything shorter than this isn't a meeting worth transcribing (removed on arrival, or the call was empty). */
export const MIN_RECORDING_MS = 10_000;
export type Outcome = "recorded" | "failed" | "skipped";

/**
 * One bot session, start to finish: join -> consent -> record (+ captions/chat/participants) -> leave -> hand over.
 * Never throws; every path ends in a reported state. A partial recording (removed mid-call) is still handed over.
 */
export async function runSession(job: BotJob, d: Deps = defaultDeps): Promise<Outcome> {
  const id = job.botSessionId, tag = `[session ${id.slice(0, 8)}]`;
  const state = await d.api.getState(id);
  if (!state || state.state !== "scheduled") { console.log(`${tag} skipped (state: ${state?.state ?? "unknown"})`); return "skipped"; }

  const dir = path.join(d.cfg.dataDir, "sessions", id);
  fs.mkdirSync(dir, { recursive: true });
  let current: "joining" | "waiting_room" | "recording" = "joining";
  await d.api.report(id, "joining");
  let people: number | undefined;
  // Heartbeat: the web app fails sessions whose bot goes silent. It also carries the participant count for the live page.
  const beat = setInterval(() => void d.api.report(id, current, undefined, people === undefined ? undefined : { participants: people }), d.cfg.heartbeatMs);

  const adapter = d.makeAdapter(job.platform);
  const side = new SidecarCollector(job.platform);
  let rec: Recording | undefined, endedBy: EndReason | "error" = "error", failure: BotFailReason | undefined;
  try {
    const joined = await adapter.join(job.url, job.displayName, { onWaiting: () => { current = "waiting_room"; void d.api.report(id, "waiting_room"); } });
    if (!joined.admitted) { failure = joined.reason; }
    else {
      try { rec = await d.record(path.join(dir, "recording.mp4")); }
      catch (e) { console.error(`${tag} recorder failed to start:`, e instanceof Error ? e.message : e); failure = "recording_error"; }
      if (rec) {
        side.start(rec.startedAtMs); current = "recording"; await d.api.report(id, "recording", undefined, { recordingStartedAtMs: rec.startedAtMs });
        // Consent first (people should see it as early as possible), then the watchers. All of it is best-effort:
        // losing captions or chat must never cost us the recording.
        if (job.consentMessage && !(await adapter.postConsent(job.consentMessage).catch(() => false))) console.warn(`${tag} could not post the consent message (chat disabled?)`);
        await adapter.watchSpeakers((n, t, at) => (t.trim() ? side.caption(n, t, at) : side.speaker(n, at))).catch((e) => console.warn(`${tag} captions unavailable:`, e?.message ?? e));
        // Anyone typing `/milo highlight` marks the last 30 s. Handled one at a time, and a failure here never touches the recording.
        let queue: Promise<void> = Promise.resolve(), lastAck = 0;
        const rec0 = rec;
        await adapter.watchChat((from, text, at) => {
          side.chat(from, text, at);
          const cmd = parseHighlightCommand(text);
          if (!cmd || isBotName(from) || text.includes(CONSENT_MESSAGE.slice(0, 40))) return;
          queue = queue.then(async () => {
            const saved = await d.api.highlight(id, { atMs: Math.max(0, at - rec0.startedAtMs), by: from, note: cmd.note });
            if (saved?.created && Date.now() - lastAck > 3000) { lastAck = Date.now(); await adapter.sendChat("Highlight saved: the last 30 seconds are marked.").catch(() => false); }
          }).catch(() => {});
        }).catch((e) => console.warn(`${tag} chat unavailable:`, e?.message ?? e));
        await adapter.watchParticipants((ns, at) => side.participants(ns, at)).catch(() => {});
        endedBy = await Promise.race([
          adapter.detectEnd({ aloneGraceMs: d.cfg.aloneGraceMs, aloneAtStartMs: d.cfg.aloneAtStartMs, maxMs: d.cfg.maxMeetingMs, onCount: (n, at) => { people = n; side.count(n, at); } }),
          rec.died.then(() => "error" as const),
        ]);
        if (endedBy === "error") failure = "recording_error";
      }
    }
  } catch (e) {
    console.error(`${tag} session error:`, e instanceof Error ? e.stack : e);
    failure ??= rec ? "recording_error" : "join_error";
  } finally {
    clearInterval(beat);
  }

  // ---- wind down ----
  let bytes = 0, durationMs = 0;
  if (rec) { bytes = (await rec.stop().catch(() => ({ bytes: 0 }))).bytes; durationMs = Date.now() - rec.startedAtMs; }
  await adapter.leave().catch(() => {});
  await adapter.close().catch(() => {});

  const usable = !!rec && bytes > 0 && durationMs >= MIN_RECORDING_MS;
  if (!usable) {
    // Name what actually happened: removed vs. the call simply ending right away vs. a recorder problem.
    const reason: BotFailReason = failure ?? (endedBy === "removed" ? "removed_early" : endedBy === "error" ? "recording_error" : "too_short");
    await d.api.report(id, "failed", reason);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`${tag} failed: ${reason}`);
    return "failed";
  }

  // Keep the files on disk until the web app has them: if the hand-over fails they are retried later (see retryPending).
  fs.writeFileSync(path.join(dir, "sidecar.json"), JSON.stringify(side.build(endedBy, rec!.startedAtMs)));
  await d.api.report(id, "left");
  console.log(`${tag} left (${endedBy}), ${(bytes / 1e6).toFixed(1)} MB, ${Math.round(durationMs / 1000)}s`);
  await handOver(id, dir, d, tag);
  return "recorded";
}

async function handOver(id: string, dir: string, d: Deps, tag: string): Promise<boolean> {
  try {
    await d.api.uploadSidecar(id, JSON.parse(fs.readFileSync(path.join(dir, "sidecar.json"), "utf8"))); // sidecar first: the pipeline starts when the recording lands
    await d.api.uploadRecording(id, path.join(dir, "recording.mp4"));
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`${tag} handed over`);
    return true;
  } catch (e) {
    // 404 means the web app no longer knows this session (meeting deleted): retrying can never succeed, so drop the files.
    if (e instanceof HttpError && e.status === 404) { fs.rmSync(dir, { recursive: true, force: true }); console.warn(`${tag} session no longer exists; discarded the recording`); return false; }
    console.error(`${tag} hand-over failed, keeping files for retry:`, e instanceof Error ? e.message : e);
    return false;
  }
}

/** Retry hand-overs that failed earlier (web app was down, network blip). Called at startup and periodically. */
export async function retryPending(d: Deps = defaultDeps): Promise<number> {
  const root = path.join(d.cfg.dataDir, "sessions");
  if (!fs.existsSync(root)) return 0;
  let ok = 0;
  for (const id of fs.readdirSync(root)) {
    const dir = path.join(root, id);
    if (fs.existsSync(path.join(dir, "sidecar.json")) && fs.existsSync(path.join(dir, "recording.mp4")) && (await handOver(id, dir, d, `[pending ${id.slice(0, 8)}]`))) ok++;
  }
  return ok;
}

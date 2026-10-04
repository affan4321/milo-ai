// Orchestrator tests with fake adapter / recorder / web client. Run: npx tsx apps/bot/src/session.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BotJob, Sidecar } from "@milo/core";
import { runSession, retryPending, type Deps } from "./session";
import { HttpError } from "./api";
import type { EndReason, JoinResult, PlatformAdapter } from "./platforms/types";
import { SidecarCollector } from "./sidecar";

let fails = 0;
const check = (c: unknown, m: string) => { if (!c) { fails++; console.error("FAIL:", m); } };
const job: BotJob = { botSessionId: "11111111-2222-3333-4444-555555555555", meetingId: "m1", url: "https://meet.google.com/x", platform: "meet", displayName: "Milo AI Notetaker", consentMessage: "hello, recording" };

interface Scenario {
  state?: string; join?: JoinResult | "throw"; waiting?: boolean; consentOk?: boolean; end?: EndReason | (() => Promise<EndReason>); recStart?: "ok" | "fail";
  recAgeMs?: number; recBytes?: number; uploadFails?: number; watchThrows?: boolean; died?: boolean; hb?: number;
}
function harness(s: Scenario) {
  const calls: string[] = [];
  const reports: string[] = [];
  const uploads: { sidecar?: Sidecar; recording?: string; order: string[] } = { order: [] };
  let uploadAttempts = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-test-"));
  const adapter: PlatformAdapter = {
    async join(_u, name, hooks) { calls.push(`join:${name}`); if (s.waiting) hooks.onWaiting(); if (s.join === "throw") throw new Error("boom"); return s.join ?? { admitted: true }; },
    async postConsent(m) { calls.push(`consent:${m}`); return s.consentOk ?? true; },
    async watchSpeakers(cb) { if (s.watchThrows) throw new Error("no captions"); cb("Ada", "hello everyone", Date.now()); },
    async watchChat(cb) { if (s.watchThrows) throw new Error("no chat"); cb("Bob", "hi", Date.now()); },
    async watchParticipants(cb) { cb(["Ada", "Bob"], Date.now()); },
    async detectEnd() { calls.push("detectEnd"); return typeof s.end === "function" ? s.end() : s.end ?? "ended"; },
    async leave() { calls.push("leave"); }, async close() { calls.push("close"); },
  };
  const deps: Deps = {
    makeAdapter: () => adapter,
    async record(file) {
      calls.push("record");
      if (s.recStart === "fail") throw new Error("ffmpeg exploded");
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.alloc(s.recBytes ?? 2048));
      return { file, startedAtMs: Date.now() - (s.recAgeMs ?? 60_000), died: s.died ? Promise.resolve() : new Promise<void>(() => {}), async stop() { calls.push("stopRec"); return { bytes: s.recBytes ?? 2048 }; } };
    },
    api: {
      async getState() { return { state: s.state ?? "scheduled" }; },
      async report(_id, st, reason) { reports.push(reason ? `${st}:${reason}` : st); },
      async uploadSidecar(_id, sc) { uploads.sidecar = sc; uploads.order.push("sidecar"); },
      async uploadRecording(_id, file) { if (++uploadAttempts <= (s.uploadFails ?? 0)) throw new Error("web down"); uploads.recording = file; uploads.order.push("recording"); },
    },
    cfg: { dataDir: dir, heartbeatMs: s.hb ?? 60_000, aloneGraceMs: 1, aloneAtStartMs: 1, maxMeetingMs: 1e9 },
  };
  return { deps, calls, reports, uploads, dir, sessionDir: path.join(dir, "sessions", job.botSessionId) };
}

// 1. happy path (and waiting room is reported)
let h = harness({ waiting: true });
check(await runSession(job, h.deps) === "recorded", "happy path -> recorded");
check(h.reports.join() === "joining,waiting_room,recording,left", `states in order (got ${h.reports.join()})`);
check(h.calls.includes("consent:hello, recording") && h.calls.indexOf("record") < h.calls.indexOf("consent:hello, recording"), "consent posted after recording starts");
check(h.uploads.order.join() === "sidecar,recording", "sidecar uploaded before recording");
check(h.uploads.sidecar?.endedBy === "ended" && h.uploads.sidecar.captions[0]?.name === "Ada" && h.uploads.sidecar.chat[0]?.from === "Bob" && h.uploads.sidecar.participants.length === 2, "sidecar carries captions, chat and participants");
check(!fs.existsSync(h.sessionDir), "files removed after hand-over");
check(h.calls.indexOf("stopRec") < h.calls.indexOf("leave") || h.calls.includes("leave"), "recorder stopped and bot left");

// 2. not admitted: no recorder, no uploads, reason reported
h = harness({ join: { admitted: false, reason: "not_admitted" } });
check(await runSession(job, h.deps) === "failed" && h.reports.at(-1) === "failed:not_admitted", "not admitted -> failed:not_admitted");
check(!h.calls.includes("record") && !h.uploads.recording && h.calls.includes("close"), "nothing recorded, browser closed");

// 3. removed mid-call: partial recording still handed over
h = harness({ end: "removed", recAgeMs: 40_000 });
check(await runSession(job, h.deps) === "recorded" && h.uploads.sidecar?.endedBy === "removed" && !!h.uploads.recording, "removed mid-call -> partial recording still processed");

// 4. removed almost immediately: not worth processing
h = harness({ end: "removed", recAgeMs: 2_000 });
check(await runSession(job, h.deps) === "failed" && h.reports.at(-1) === "failed:removed_early" && !h.uploads.recording, "removed on arrival -> failed:removed_early");
h = harness({ end: "ended", recAgeMs: 2_000 });
check(await runSession(job, h.deps) === "failed" && h.reports.at(-1) === "failed:too_short" && !h.uploads.recording, "call ends right after joining -> failed:too_short (not a recorder fault)");

// 5. recorder can't start
h = harness({ recStart: "fail" });
check(await runSession(job, h.deps) === "failed" && h.reports.at(-1) === "failed:recording_error" && h.calls.includes("leave"), "recorder failure -> failed:recording_error and the bot leaves");

// 6. ffmpeg dies mid-call but produced data: keep what we have
h = harness({ died: true, end: () => new Promise<EndReason>(() => {}), recAgeMs: 90_000 });
check(await runSession(job, h.deps) === "recorded" && h.uploads.sidecar?.endedBy === "error", "recorder died mid-call -> partial recording handed over");

// 7. consent refused and watchers broken must not cost the recording
h = harness({ consentOk: false, watchThrows: true });
check(await runSession(job, h.deps) === "recorded" && !!h.uploads.recording, "chat disabled + no captions -> still recorded");

// 8. adapter throws during join
h = harness({ join: "throw" });
check(await runSession(job, h.deps) === "failed" && h.reports.at(-1) === "failed:join_error" && h.calls.includes("close"), "join exception -> failed:join_error, cleaned up");

// 9. stale / already-handled session is skipped without touching anything
h = harness({ state: "failed" });
check(await runSession(job, h.deps) === "skipped" && h.calls.length === 0 && h.reports.length === 0, "non-scheduled session skipped");

// 10. upload fails -> files kept; retryPending delivers them later
h = harness({ uploadFails: 99 });
check(await runSession(job, h.deps) === "recorded" && fs.existsSync(path.join(h.sessionDir, "recording.mp4")), "failed hand-over keeps the recording on disk");
const h2 = harness({}); h2.deps.cfg = h.deps.cfg; (h2.deps as any).cfg = h.deps.cfg;
check(await retryPending(h2.deps) === 1 && h2.uploads.order.join() === "sidecar,recording" && !fs.existsSync(h.sessionDir), "retryPending delivers and cleans up");
check(await retryPending(h2.deps) === 0, "nothing left to retry");

// 10b. the web app says the session no longer exists (404) -> discard instead of retrying forever
h = harness({});
fs.mkdirSync(h.sessionDir, { recursive: true }); fs.writeFileSync(path.join(h.sessionDir, "sidecar.json"), "{}"); fs.writeFileSync(path.join(h.sessionDir, "recording.mp4"), "x");
h.deps.api.uploadSidecar = async () => { throw new HttpError(404, "HTTP 404 not found"); };
check(await retryPending(h.deps) === 0 && !fs.existsSync(h.sessionDir), "404 on hand-over discards the orphaned recording");

// 11. heartbeat: same state repeated while waiting for the call to end
h = harness({ hb: 40, end: () => new Promise((r) => setTimeout(() => r("ended"), 200)) });
await runSession(job, h.deps);
check(h.reports.filter((r) => r === "recording").length >= 3, `heartbeats repeat the state (got ${h.reports.filter((r) => r === "recording").length} 'recording' reports)`);

// sidecar collector: clock conversion, caption growth, roster
const sc = new SidecarCollector("meet"); sc.start(1000);
sc.caption("Ada", "hello", 1500); sc.caption("Ada", "hello there everyone", 2500); sc.caption("Bob", "hi", 4000); sc.chat("Ada", "/milo highlight", 3000); sc.chat("Ada", "/milo highlight", 3100);
sc.participants(["Ada", "Bob"], 1200); sc.participants(["Ada"], 9000);
const b = sc.build("ended", 1000);
check(b.captions.length === 2 && b.captions[0]!.text === "hello there everyone" && b.captions[0]!.atMs === 500, "captions: grow in place, offset to recording clock");
check(b.speakerEvents.map((e) => e.name).join() === "Ada,Bob" && b.speakerEvents[1]!.atMs === 3000, "speaker changes recorded");
check(b.chat.length === 1, "duplicate chat message collapsed");
check(b.participants.find((p) => p.name === "Bob")!.leftMs === 8000 && b.participants.find((p) => p.name === "Ada")!.leftMs === null, "roster join/leave times");
check(new SidecarCollector("meet").build("ended", 0).captions.length === 0, "empty collector builds cleanly");
const jk = new SidecarCollector("meet"); jk.start(0); jk.participants(["Ada", "visual_effects", "keyboard_arrow_down", "Bob"], 1000);
check(jk.build("ended", 0).participants.map((p) => p.name).join() === "Ada,Bob", "icon ligature text is not a participant");
// continuous speaking observations (thinned to ~1.5 s) and peak participant count
const pk = new SidecarCollector("meet"); pk.start(0);
for (let t = 1000; t <= 20_000; t += 300) pk.caption("Ada", "talking " + t, t);
pk.count(1, 500); pk.count(2, 2000); pk.count(2, 3000); pk.count(1, 25_000);
const pb = pk.build("ended", 0);
check(pb.speakerEvents.length >= 12 && pb.speakerEvents.length <= 16 && pb.speakerEvents.every((e) => e.name === "Ada"), `repeated captions become ~1.5 s observations (${pb.speakerEvents.length})`);
check(pb.peakParticipants === 2, "peak participant count recorded");
const ch = new SidecarCollector("meet"); ch.start(0);
ch.chat("Milo AI Notetaker is recording and transcribing this meeting for the meeting owner. If you'd rather not be recorded", "Hover over a message", 100); ch.chat("Milo AI Notetaker", "anything", 200); ch.chat("Ada", "real message", 300);
check(ch.build("ended", 0).chat.map((c) => c.text).join() === "real message", "the bot's own consent message is not recorded as chat");
// roster falls back to speakers seen in captions when the participant list can't be read
const fb = new SidecarCollector("meet"); fb.start(0); fb.caption("Ada", "hi", 2000); fb.caption("Milo AI Notetaker", "x", 3000); fb.caption("You", "y", 4000);
check(fb.build("ended", 0).participants.map((p) => p.name).join() === "Ada" && fb.build("ended", 0).participants[0]!.joinedMs === 2000, "participants fall back to caption speakers (never the bot or 'You')");

console.log(fails ? `${fails} FAILED` : "ok"); process.exit(fails ? 1 : 0);

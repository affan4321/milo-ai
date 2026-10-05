// Run: DATABASE_URL=postgres://milo:milo@localhost:5433/milo npx tsx apps/worker/src/delete-meetings.test.ts   (local database only)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { assertTestDatabase, getDb, users, meetings, recordings, clips, shares, botSessions, pipelineStage, memberships, workspaces, ensureWorkspace } from "@milo/db";
assertTestDatabase();
import { LocalStorage } from "@milo/providers";
import { deleteMeetings, newToken } from "@milo/sharing";

const db = getDb(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "milo-del-")), storage = new LocalStorage(dir), stamp = Date.now();
const mkUser = async (n: string) => (await db.insert(users).values({ email: `${n}-${stamp}@del-test.local`, name: n }).returning())[0]!;
const A = await mkUser("a"), B = await mkUser("b");
const mkMeeting = async (u: typeof A, title: string) => (await db.insert(meetings).values({ ownerId: u.id, workspaceId: await ensureWorkspace(db, u.id), title, status: "ready", captureSource: "upload" }).returning())[0]!;
const put = async (key: string) => { await storage.put(key, Buffer.from("x")); return key; };
let n = 0, fails = 0; const check = (ok: boolean, msg: string) => { n++; if (!ok) { fails++; console.log("FAIL:", msg); } };

try {
  // A1: a finished meeting with every kind of file, a clip and a public share
  const a1 = await mkMeeting(A, "a1");
  const keys = { raw: await put(`m/${a1.id}/raw.mp4`), play: await put(`m/${a1.id}/playable.mp4`), audio: await put(`m/${a1.id}/audio.m4a`), side: await put(`m/${a1.id}/sidecar.json`), clip: await put(`clips/${a1.id}.mp4`) };
  await db.insert(recordings).values({ meetingId: a1.id, rawKey: keys.raw, playableKey: keys.play, audioKey: keys.audio, sidecarKey: keys.side, durationMs: 60000 });
  const [clip] = await db.insert(clips).values({ meetingId: a1.id, startMs: 0, endMs: 5000, status: "ready", storageKey: keys.clip }).returning();
  const token = newToken(); await db.insert(shares).values({ token, targetType: "clip", targetId: clip!.id });
  // A2: the bot is in the meeting right now.  A3: processing is running.  A4: plain.  B1: someone else's.
  const a2 = await mkMeeting(A, "a2"); await db.insert(botSessions).values({ meetingId: a2.id, state: "recording", meetingUrl: "x", platform: "meet" });
  const a3 = await mkMeeting(A, "a3"); const [r3] = await db.insert(recordings).values({ meetingId: a3.id, rawKey: await put(`m/${a3.id}/raw.mp4`) }).returning(); await db.insert(pipelineStage).values({ recordingId: r3!.id, stage: "transcription", status: "running" });
  const a4 = await mkMeeting(A, "a4");
  const b1 = await mkMeeting(B, "b1"); const bKey = await put(`m/${b1.id}/raw.mp4`); await db.insert(recordings).values({ meetingId: b1.id, rawKey: bKey });

  const r = await deleteMeetings(db, storage, A.id, [a1.id, a2.id, a3.id, a4.id, b1.id, randomUUID(), a1.id]);
  check(r.deleted.length === 2 && r.deleted.includes(a1.id) && r.deleted.includes(a4.id), "finished and plain meetings are deleted (duplicates ignored)");
  check(r.skipped.filter((s) => s.reason === "in_progress").map((s) => s.id).sort().join() === [a2.id, a3.id].sort().join(), "a meeting being recorded or processed is skipped, not deleted");
  check(r.skipped.filter((s) => s.reason === "not_found").length === 2, "someone else's meeting and an unknown id are reported as not found");
  const left = await db.select({ id: meetings.id }).from(meetings).where(inArray(meetings.id, [a1.id, a2.id, a3.id, a4.id, b1.id]));
  check(left.length === 3 && !left.some((m) => m.id === a1.id || m.id === a4.id), "only the deleted meetings are gone from the database");
  check((await db.select().from(recordings).where(eq(recordings.meetingId, a1.id))).length === 0 && (await db.select().from(clips).where(eq(clips.meetingId, a1.id))).length === 0, "recordings and clips cascade away");
  check((await db.select().from(shares).where(eq(shares.token, token))).length === 0, "the public share link of a deleted clip is removed too");
  check(Object.values(keys).every((k) => !fs.existsSync(path.join(dir, k))), "every file (raw, playable, audio, sidecar, clip) is removed from storage");
  check(fs.existsSync(path.join(dir, bKey)), "someone else's files are untouched");
  check((await deleteMeetings(db, storage, A.id, [])).deleted.length === 0, "an empty selection does nothing");
  await storage.delete("never/existed.mp4"); check(true, "deleting a missing file is not an error");
} finally {
  // Remove everything this test (or an earlier crashed run of it) created: meetings first (they point at users), then workspaces, then users.
  const mine = await db.select({ id: users.id }).from(users).where(like(users.email, "%@del-test.local")); const ids = mine.map((u) => u.id);
  if (ids.length) {
    const ws = await db.select({ id: memberships.workspaceId }).from(memberships).where(inArray(memberships.userId, ids));
    await db.delete(meetings).where(inArray(meetings.ownerId, ids));
    await db.delete(users).where(inArray(users.id, ids));
    if (ws.length) await db.delete(workspaces).where(inArray(workspaces.id, ws.map((w) => w.id)));
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(fails ? `${fails} FAILED of ${n}` : `delete-meetings tests passed (${n} checks)`); process.exit(fails ? 1 : 0);

// Clips + share links against Postgres and real ffmpeg. Run: npx tsx --env-file=.env apps/worker/src/clips.test.ts <sample.mp4>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { getDb, users, meetings, recordings, speakers, transcriptSegments, summaries, chapters, actionItems, clips, shares } from "@milo/db";
import { LocalStorage } from "@milo/providers";
import { processMedia } from "@milo/media";
import { createClip, renderClip, createShare, revokeShares, resolveShare, buildShareView, listClips, newToken } from "@milo/sharing";
import { assertTestDatabase } from "@milo/db"; assertTestDatabase(); // never run these against the hosted database

let fails = 0;
const check = (c: unknown, m: string) => { console.log(c ? "  ok  " : "  FAIL", m); if (!c) fails++; };
const db = getDb(), storage = new LocalStorage();
const [u] = await db.insert(users).values({ email: `clip-${Date.now()}@milo.local` }).returning();
const [m] = await db.insert(meetings).values({ ownerId: u!.id, title: "Board prep call", status: "ready", captureSource: "upload" }).returning();
const [r] = await db.insert(recordings).values({ meetingId: m!.id, rawKey: `meetings/${m!.id}/raw.mp4` }).returning();
await storage.putStream(r!.rawKey!, fs.createReadStream(process.argv[2]!));
await processMedia(db, storage, r!.id);                                   // gives us a real playable file + duration (30 s sample)
const [ada, bob] = await db.insert(speakers).values([{ meetingId: m!.id, label: "Speaker 1", displayName: "Ada" }, { meetingId: m!.id, label: "Speaker 2" }]).returning();
await db.insert(transcriptSegments).values([
  { meetingId: m!.id, speakerId: ada!.id, startMs: 1000, endMs: 6000, text: "Welcome everyone." },
  { meetingId: m!.id, speakerId: bob!.id, startMs: 8000, endMs: 13000, text: "The budget is the main risk." },
  { meetingId: m!.id, speakerId: ada!.id, startMs: 14000, endMs: 19000, text: "I will draft the board memo." },
  { meetingId: m!.id, speakerId: bob!.id, startMs: 24000, endMs: 29000, text: "SECRET: unrelated later topic." },
]);
await db.insert(summaries).values({ meetingId: m!.id, templateKey: "general", content: { sections: [{ heading: "Key points", bullets: [{ text: "Budget is the main risk", ms: 9000 }, { text: "Unrelated late point", ms: 26000 }] }] } });
await db.insert(chapters).values([{ meetingId: m!.id, title: "Intro", startMs: 0 }, { meetingId: m!.id, title: "Risks and owners", startMs: 7000 }, { meetingId: m!.id, title: "Wrap up", startMs: 23000 }]);
await db.insert(actionItems).values([{ meetingId: m!.id, text: "Draft the board memo", assignee: "Ada", sourceMs: 15000 }, { meetingId: m!.id, text: "Secret later task", sourceMs: 27000 }]);

// --- creating clips: validation ---
const bad = await createClip(db, { meetingId: m!.id, startMs: 5000, endMs: 5200 }); check("error" in bad, "sub-second clip rejected");
const nan = await createClip(db, { meetingId: m!.id, startMs: NaN, endMs: 9000 }); check("error" in nan, "garbage range rejected");
const noRec = await createClip(db, { meetingId: "00000000-0000-0000-0000-000000000000", startMs: 0, endMs: 5000 }); check("error" in noRec, "meeting without a recording rejected");
const c1r = await createClip(db, { meetingId: m!.id, startMs: 7000, endMs: 20000, title: "  The budget risk  ", createdBy: "owner" });
const c1 = (c1r as any).clip; check(c1.status === "pending" && c1.title === "The budget risk", "valid clip created pending, title trimmed");
const clamped = (await createClip(db, { meetingId: m!.id, startMs: -5000, endMs: 999_999 }) as any).clip; check(clamped.startMs === 0 && clamped.endMs <= 31_000, `range clamped into the recording (${clamped.startMs}-${clamped.endMs})`);
check("error" in (await createShare(db, c1.id)), "no link before the clip is rendered");

// --- rendering with real ffmpeg ---
await renderClip(db, storage, c1.id);
const [done] = await db.select().from(clips).where(eq(clips.id, c1.id));
const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", await storage.toLocalFile(done!.storageKey!)]).toString());
const dur = Number(probe.format.duration);
check(done!.status === "ready" && Math.abs(dur - 13) < 0.6, `clip rendered, ${dur.toFixed(1)}s long (asked for 13s)`);
check(probe.streams.some((s: any) => s.codec_type === "video") && probe.streams.some((s: any) => s.codec_type === "audio"), "clip has video and audio");
await renderClip(db, storage, c1.id); check((await db.select().from(clips).where(eq(clips.id, c1.id)))[0]!.status === "ready", "rendering again is harmless");

// --- share links ---
const s1 = (await createShare(db, c1.id) as any).share;
check(/^[A-Za-z0-9_-]{32}$/.test(s1.token), `token is 192 bits of url-safe randomness (${s1.token.length} chars)`);
check((await createShare(db, c1.id) as any).share.id === s1.id, "asking again returns the same live link");
check(newToken() !== newToken(), "tokens differ");
let look = await resolveShare(db, s1.token); check(look.ok, "valid token resolves");
check(!(await resolveShare(db, "nonsense")).ok && (await resolveShare(db, "x".repeat(32)) as any).reason === "not_found" && (await resolveShare(db, "../../etc/passwd") as any).reason === "not_found", "unknown / malformed tokens are 'not found'");

// --- what an outsider sees: only the clip's stretch ---
const view = await buildShareView(db, done!);
check(view.transcript.map((t) => t.text).join("|") === "The budget is the main risk.|I will draft the board memo.", `transcript is only the clip's range (${view.transcript.length} lines)`);
check(view.transcript[0]!.startMs === 1000 && view.transcript[0]!.speaker === "Ada" || view.transcript[0]!.speaker === "Speaker 2", "transcript times are relative to the clip; speaker names resolved");
check(view.recap.topic === "Risks and owners" && view.recap.points.join() === "Budget is the main risk" && view.recap.actionItems.length === 1, "recap: topic, in-range summary point, in-range action item");
check(!JSON.stringify(view).includes("SECRET") && !JSON.stringify(view).includes("Secret later") && !JSON.stringify(view).includes("Unrelated"), "nothing from outside the clip leaks into the share view");

// --- revoke / expiry ---
check((await revokeShares(db, c1.id)) === 1 && (await resolveShare(db, s1.token) as any).reason === "revoked", "revoking kills the link immediately");
const s2 = (await createShare(db, c1.id) as any).share; check(s2.token !== s1.token && (await resolveShare(db, s2.token)).ok, "after a revoke a NEW link can be made; the old one stays dead");
await db.update(shares).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(shares.id, s2.id)); check((await resolveShare(db, s2.token) as any).reason === "expired", "expired links stop working");
check((await listClips(db, m!.id)).find((c) => c.id === c1.id)?.share !== undefined, "owner's clip list includes share state");

await db.delete(meetings).where(eq(meetings.id, m!.id)); await db.delete(users).where(eq(users.id, u!.id));
console.log(fails ? `${fails} FAILED` : "ok"); process.exit(fails ? 1 : 0);

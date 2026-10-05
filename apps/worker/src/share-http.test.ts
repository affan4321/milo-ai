// HTTP-level checks of the public share link against a RUNNING web app with real auth (default http://localhost:3000).
// Run: npx tsx --env-file=.env apps/worker/src/share-http.test.ts <sample.mp4>
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { getDb, users, meetings, recordings, speakers, transcriptSegments } from "@milo/db";
import { LocalStorage } from "@milo/providers";
import { processMedia } from "@milo/media";
import { createClip, renderClip, createShare, revokeShares } from "@milo/sharing";

const WEB = process.env.WEB_TEST_URL ?? "http://localhost:3000";
let fails = 0;
const check = (c: unknown, m: string) => { console.log(c ? "  ok  " : "  FAIL", m); if (!c) fails++; };
const get = (path: string, init: RequestInit = {}) => fetch(WEB + path, { redirect: "manual", signal: AbortSignal.timeout(30_000), ...init });
const db = getDb(), storage = new LocalStorage();

const [u] = await db.insert(users).values({ email: `share-${Date.now()}@milo.local` }).returning();
const [m] = await db.insert(meetings).values({ ownerId: u!.id, title: "Private quarterly numbers", status: "ready", captureSource: "upload" }).returning();
const [r] = await db.insert(recordings).values({ meetingId: m!.id, rawKey: `meetings/${m!.id}/raw.mp4` }).returning();
await storage.putStream(r!.rawKey!, fs.createReadStream(process.argv[2]!));
await processMedia(db, storage, r!.id);
const [sp] = await db.insert(speakers).values({ meetingId: m!.id, label: "Speaker 1", displayName: "Ada" }).returning();
await db.insert(transcriptSegments).values([
  { meetingId: m!.id, speakerId: sp!.id, startMs: 2000, endMs: 7000, text: "Inside the clip." },
  { meetingId: m!.id, speakerId: sp!.id, startMs: 20_000, endMs: 25_000, text: "TOPSECRET outside the clip." },
]);
try {
  const clip = (await createClip(db, { meetingId: m!.id, startMs: 1000, endMs: 10_000, title: "Shared moment" }) as any).clip;
  await renderClip(db, storage, clip.id);
  const token = (await createShare(db, clip.id) as any).share.token as string;

  let res = await get(`/share/${token}`); let html = await res.text();
  check(res.status === 200 && html.includes("Shared moment") && html.includes("Inside the clip."), "logged-out viewer can open the share page");
  check(!html.includes("TOPSECRET") && !html.includes("Playlists") && /noindex/.test(html), "page has nothing outside the clip, no app navigation, and asks search engines not to index it");
  res = await get(`/api/share/${token}/media`); const full = (await res.arrayBuffer()).byteLength;
  check(res.status === 200 && full > 1000 && res.headers.get("cache-control") === "no-store", `media streams (${full} bytes, no-store)`);
  res = await get(`/api/share/${token}/media`, { headers: { range: "bytes=10-19" } });
  check(res.status === 206 && res.headers.get("content-range") === `bytes 10-19/${full}`, "range requests work (seeking)");
  res = await get(`/api/share/${token}/media`, { headers: { range: "bytes=99999999-" } }); check(res.status === 416, "out-of-range request -> 416");

  // the rest of the app stays private
  const priv = ["/home", `/meetings/${m!.id}`, `/api/media/${r!.id}`];
  for (const p of priv) { res = await get(p); check(res.status === 307 && (res.headers.get("location") ?? "").includes("/sign-in"), `${p.replace(m!.id, ":id").replace(r!.id, ":id")} still requires sign-in`); }
  // a clip token must not open anything but that clip
  res = await get(`/api/share/${token}/../../media/${r!.id}`); check(res.status !== 200 || (await res.text()).length < 200, "token can't be used to reach the full recording");

  res = await get("/share/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"); check(res.status === 404, "unknown token -> 404");
  res = await get("/api/share/not-a-token/media"); check(res.status === 404, "malformed token -> 404");

  await revokeShares(db, clip.id);
  res = await get(`/share/${token}`); html = await res.text();
  check(html.includes("turned off the link") && !html.includes("Inside the clip."), "revoked: page says so and shows nothing");
  res = await get(`/api/share/${token}/media`); check(res.status === 410, "revoked: media is gone immediately (410)");
} catch (e) { console.error("  FAIL", e instanceof Error ? e.message : e); fails++; }
finally { await db.delete(meetings).where(eq(meetings.id, m!.id)); await db.delete(users).where(eq(users.id, u!.id)); }
console.log(fails ? `${fails} FAILED` : "ok"); process.exit(fails ? 1 : 0);

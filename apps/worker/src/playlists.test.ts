// Run: npx tsx --env-file=.env apps/worker/src/playlists.test.ts
import { eq, sql } from "drizzle-orm";
import { getDb, users, meetings, ensureWorkspace } from "@milo/db";
import { createPlaylist, renamePlaylist, deletePlaylist, listPlaylists, addToPlaylist, removeItem, moveItem, getPlaylist, MAX_PLAYLISTS } from "@milo/playlists";
import { assertTestDatabase } from "@milo/db"; assertTestDatabase(); // never run these against the hosted database

let fails = 0; const check = (c: unknown, m: string) => { console.log(c ? "  ok  " : "  FAIL", m); if (!c) fails++; };
const db = getDb(), stamp = Date.now();
const mk = async (e: string) => (await db.insert(users).values({ email: `${stamp}-${e}` }).returning())[0]!;
const A = await mk(`a@co-${stamp}-test.io`), B = await mk(`b@co-${stamp}-test.io`), C = await mk(`c@other-${stamp}-test.io`);
for (const u of [A, B, C]) await ensureWorkspace(db, u.id);
const meet = async (o: typeof A, title: string, visibility = "private", status = "ready") => (await db.insert(meetings).values({ ownerId: o.id, workspaceId: await ensureWorkspace(db, o.id), title, status, visibility, captureSource: "upload" }).returning())[0]!;
const mine1 = await meet(A, "Mine one"), mine2 = await meet(A, "Mine two"), mine3 = await meet(A, "Mine three");
const teamShared = await meet(B, "Teammate shared", "team"), teamPrivate = await meet(B, "Teammate private"), outsider = await meet(C, "Outsider", "team"), pending = await meet(A, "Still processing", "private", "processing");

check((await createPlaylist(db, A.id, "  ")as any).error, "a playlist needs a name");
const p = (await createPlaylist(db, A.id, "Customer  objections") as any).playlist; check(p.name === "Customer objections", "name is tidied");
check((await createPlaylist(db, A.id, "customer OBJECTIONS") as any).error, "duplicate name (any case) rejected");
const p2 = (await createPlaylist(db, A.id, "Wins") as any).playlist;

const r1 = await addToPlaylist(db, A.id, p.id, { meetingId: mine1.id }) as any; await addToPlaylist(db, A.id, p.id, { meetingId: mine2.id, startMs: 30_000, endMs: 60_000 }); await addToPlaylist(db, A.id, p.id, { meetingId: mine3.id });
check(r1.created, "a whole meeting can be added");
check((await addToPlaylist(db, A.id, p.id, { meetingId: mine1.id }) as any).created === false, "adding the same meeting again is a no-op");
check((await addToPlaylist(db, A.id, p.id, { meetingId: mine2.id, startMs: 30_000, endMs: 60_000 }) as any).created === false && (await addToPlaylist(db, A.id, p.id, { meetingId: mine2.id, startMs: 90_000, endMs: 120_000 }) as any).created === true, "same range is a duplicate; a different range of the same meeting is a new item");
check((await addToPlaylist(db, A.id, p.id, { meetingId: mine2.id, startMs: 50_000, endMs: 10_000 }) as any).error, "an inverted range is rejected");
check((await addToPlaylist(db, A.id, p.id, { meetingId: teamShared.id }) as any).created === true, "a teammate's TEAM-shared meeting can be added");
check((await addToPlaylist(db, A.id, p.id, { meetingId: teamPrivate.id }) as any).error, "a teammate's PRIVATE meeting cannot");
check((await addToPlaylist(db, A.id, p.id, { meetingId: outsider.id }) as any).error, "another company's meeting cannot");
check((await addToPlaylist(db, A.id, p.id, { meetingId: pending.id }) as any).error, "a meeting that isn't processed yet cannot");
check((await addToPlaylist(db, B.id, p.id, { meetingId: teamShared.id }) as any).error, "someone else's playlist can't be added to");

let view = (await getPlaylist(db, A.id, p.id))!;
check(view.items.map((i) => i.title).join() === "Mine one,Mine two,Mine three,Mine two,Teammate shared" && view.items[1]!.startMs === 30_000 && view.items[0]!.startMs === null, "items come back in the order added, ranges kept");
const ids = view.items.map((i) => i.id);
check(await moveItem(db, A.id, p.id, ids[2]!, "up"), "move up");
view = (await getPlaylist(db, A.id, p.id))!; check(view.items.map((i) => i.title).slice(0, 3).join() === "Mine one,Mine three,Mine two", "order changed");
check(!(await moveItem(db, A.id, p.id, ids[0]!, "up")) && !(await moveItem(db, A.id, p.id, view.items.at(-1)!.id, "down")), "moving past either end does nothing");
await moveItem(db, A.id, p.id, ids[2]!, "down"); view = (await getPlaylist(db, A.id, p.id))!; check(view.items.map((i) => i.title).slice(0, 3).join() === "Mine one,Mine two,Mine three", "move down restores it");
check(!(await moveItem(db, B.id, p.id, ids[0]!, "down")), "someone else can't reorder it");

// privacy changes after the fact: the item stays but is marked unavailable and its title hidden
await db.update(meetings).set({ visibility: "private" }).where(eq(meetings.id, teamShared.id));
view = (await getPlaylist(db, A.id, p.id))!; const gone = view.items.find((i) => i.meetingId === teamShared.id)!;
check(!gone.available && gone.title === "Unavailable meeting" && !JSON.stringify(view).includes("Teammate shared"), "a meeting made private later is marked unavailable and its title is not revealed");

check(await getPlaylist(db, B.id, p.id) === null, "another user can't open your playlist");
check((await renamePlaylist(db, A.id, p.id, "Wins") as any).error && (await renamePlaylist(db, A.id, p.id, "Objections") as any).ok === true && (await renamePlaylist(db, B.id, p.id, "x") as any).error, "rename: clash and ownership checked");
check(await removeItem(db, A.id, p.id, ids[0]!) && (await getPlaylist(db, A.id, p.id))!.items.length === 4 && !(await removeItem(db, B.id, p.id, ids[1]!)), "remove an item (owner only)");
const list = await listPlaylists(db, A.id); check(list.find((x) => x.id === p.id)!.items === 4 && list.find((x) => x.id === p2.id)!.items === 0 && (await listPlaylists(db, B.id)).length === 0 && list[0]!.createdAt instanceof Date, "list shows item counts; users see only their own");
check(await deletePlaylist(db, A.id, p.id) && await getPlaylist(db, A.id, p.id) === null && !(await deletePlaylist(db, B.id, p2.id)), "delete (owner only)");
for (let i = 0; i < MAX_PLAYLISTS; i++) { const r: any = await createPlaylist(db, C.id, `List ${i}`); if (r.error) break; }
check((await createPlaylist(db, C.id, "one more") as any).error, `limit of ${MAX_PLAYLISTS} playlists`);

for (const u of [A, B, C]) await db.delete(meetings).where(eq(meetings.ownerId, u.id));
for (const u of [A, B, C]) await db.delete(users).where(eq(users.id, u.id));
await db.execute(sql`delete from workspaces where name like ${"%-" + stamp + "-test.io"}`);
console.log(fails ? `${fails} FAILED` : "ok"); process.exit(fails ? 1 : 0);

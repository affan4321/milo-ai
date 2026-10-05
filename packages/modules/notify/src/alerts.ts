import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { PermanentError, formatMs } from "@milo/core";
import { alertHits, alerts, meetings, memberships, preferences, users, ensureWorkspace, type Db } from "@milo/db";
import type { EmailProvider } from "@milo/providers";
import { escapeHtml } from "./recap";

export const MAX_ALERTS = 20;
const HITS_PER_MEETING = 20;
const MARK_START = "«", MARK_END = "»";

export async function createAlert(db: Db, userId: string, keyword: string, notifyEmail = true) {
  const k = keyword.trim().replace(/\s+/g, " ").slice(0, 80);
  if (k.length < 2) return { error: "Enter a word or phrase of at least 2 characters." as const };
  const mine = await db.select().from(alerts).where(eq(alerts.userId, userId));
  if (mine.length >= MAX_ALERTS) return { error: `You can have up to ${MAX_ALERTS} alerts.` as const };
  if (mine.some((a) => a.keyword.toLowerCase() === k.toLowerCase())) return { error: "You already have an alert for that." as const };
  const [a] = await db.insert(alerts).values({ userId, workspaceId: await ensureWorkspace(db, userId), keyword: k, notifyEmail }).returning();
  return { alert: a! };
}

export const deleteAlert = async (db: Db, userId: string, alertId: string) => (await db.delete(alerts).where(and(eq(alerts.id, alertId), eq(alerts.userId, userId))).returning()).length > 0;

export async function listAlerts(db: Db, userId: string) {
  const rows = await db.select().from(alerts).where(eq(alerts.userId, userId)).orderBy(desc(alerts.createdAt));
  const out = [];
  for (const a of rows) {
    const [c] = await db.execute(sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at > ${(a.lastViewedAt ?? new Date(0)).toISOString()}::timestamptz)::int AS unseen FROM alert_hits WHERE alert_id = ${a.id}`) as unknown as { total: number; unseen: number }[];
    out.push({ ...a, total: c?.total ?? 0, unseen: c?.unseen ?? 0 });
  }
  return out;
}

/** An alert's hits (newest first) with where they happened. Only the alert's owner can read them, and only for meetings they can still see. */
export async function listHits(db: Db, userId: string, alertId: string, limit = 100) {
  const [a] = await db.select().from(alerts).where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)));
  if (!a) return null;
  const rows = await db.execute(sql`
    SELECT h.id, h.meeting_id, h.start_ms, h.snippet, h.created_at, m.title, m.created_at AS meeting_at
    FROM alert_hits h JOIN meetings m ON m.id = h.meeting_id
    WHERE h.alert_id = ${alertId} AND (m.owner_id = ${userId} OR (m.visibility = 'team' AND m.workspace_id IN (SELECT workspace_id FROM memberships WHERE user_id = ${userId})))
    ORDER BY h.created_at DESC, h.start_ms LIMIT ${limit}`) as unknown as { id: string; meeting_id: string; start_ms: number; snippet: string; created_at: string; title: string; meeting_at: string }[];
  await db.update(alerts).set({ lastViewedAt: new Date() }).where(eq(alerts.id, alertId));
  return { alert: a, hits: rows.map((r) => ({ id: r.id, meetingId: r.meeting_id, startMs: r.start_ms, snippet: r.snippet, title: r.title, meetingAt: new Date(r.meeting_at), seen: !!a.lastViewedAt && new Date(r.created_at) <= a.lastViewedAt })) };
}

/**
 * Match every relevant alert against a meeting's transcript. Relevant = the owner's alerts, plus (when the meeting is shared with the
 * team) alerts of workspace teammates. New hits are stored once (alert + line is unique) and emailed once, grouped per person.
 * If the email can't be sent, the just-stored hits are removed so a retry finds and sends them again.
 */
export async function evaluateAlertsForMeeting(db: Db, mail: EmailProvider, meetingId: string, appUrl: string): Promise<{ newHits: number; emails: number }> {
  const [m] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!m?.ownerId) throw new PermanentError("meeting not found");
  const userIds = new Set([m.ownerId]);
  if (m.visibility === "team" && m.workspaceId) {
    for (const r of await db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.workspaceId, m.workspaceId), ne(memberships.userId, m.ownerId)))) userIds.add(r.userId);
  }
  const list = await db.select().from(alerts).where(inArray(alerts.userId, [...userIds]));
  if (!list.length) return { newHits: 0, emails: 0 };

  const created: { id: string; alert: typeof alerts.$inferSelect; startMs: number; snippet: string }[] = [];
  for (const a of list) {
    const rows = await db.execute(sql`
      SELECT s.id, s.start_ms, ts_headline('english', s.text, q, ${`StartSel=${MARK_START},StopSel=${MARK_END},MaxWords=25,MinWords=6,ShortWord=2`}) AS snippet
      FROM transcript_segments s, websearch_to_tsquery('english', ${a.keyword}) q
      WHERE s.meeting_id = ${meetingId} AND s.tsv @@ q ORDER BY s.start_ms LIMIT ${HITS_PER_MEETING}`) as unknown as { id: string; start_ms: number; snippet: string }[];
    for (const r of rows) {
      const ins = await db.insert(alertHits).values({ alertId: a.id, meetingId, segmentId: r.id, startMs: r.start_ms, snippet: r.snippet }).onConflictDoNothing().returning();
      if (ins[0]) created.push({ id: ins[0].id, alert: a, startMs: r.start_ms, snippet: r.snippet });
    }
  }
  if (!created.length) return { newHits: 0, emails: 0 };

  // one email per person for this meeting
  const byUser = new Map<string, typeof created>();
  for (const c of created) if (c.alert.notifyEmail) byUser.set(c.alert.userId, [...(byUser.get(c.alert.userId) ?? []), c]);
  let emails = 0;
  try {
    for (const [uid, hits] of byUser) {
      const [u] = await db.select().from(users).where(eq(users.id, uid));
      const [p] = await db.select().from(preferences).where(eq(preferences.userId, uid));
      if (!u || (p && !p.alertEmails)) continue;
      await mail.send({ to: u.email, ...buildAlertEmail(m.title, `${appUrl.replace(/\/$/, "")}/meetings/${m.id}`, hits) }); emails++;
    }
  } catch (e) {
    await db.delete(alertHits).where(inArray(alertHits.id, created.map((c) => c.id))); // so a retry re-detects and re-sends
    throw e;
  }
  return { newHits: created.length, emails };
}

const plain = (s: string) => s.replace(new RegExp(`[${MARK_START}${MARK_END}]`, "g"), "");
function buildAlertEmail(title: string, url: string, hits: { alert: { keyword: string }; startMs: number; snippet: string }[]) {
  const groups = new Map<string, typeof hits>();
  for (const h of hits) groups.set(h.alert.keyword, [...(groups.get(h.alert.keyword) ?? []), h]);
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:620px;margin:auto;color:#1c1917">
<h2 style="margin:0 0 4px">${escapeHtml(title)}</h2><p style="margin:0 0 16px;color:#78716c">Words you asked Milo to watch for came up.</p>
${[...groups].map(([k, hs]) => `<h3 style="margin:16px 0 6px">&ldquo;${escapeHtml(k)}&rdquo;</h3><ul style="margin:0;padding-left:20px">${hs.slice(0, 5).map((h) => `<li style="margin:4px 0"><a href="${escapeHtml(url)}?t=${h.startMs}">${formatMs(h.startMs)}</a> ${escapeHtml(plain(h.snippet))}</li>`).join("")}</ul>`).join("")}
<p style="margin:20px 0"><a href="${escapeHtml(url)}" style="background:#6d5efc;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open the meeting</a></p></body></html>`;
  const text = [title, "", ...[...groups].flatMap(([k, hs]) => [`"${k}"`, ...hs.slice(0, 5).map((h) => `  ${formatMs(h.startMs)}  ${plain(h.snippet)}`), ""]), `Open: ${url}`].join("\n");
  return { subject: `Alert: ${[...groups.keys()].slice(0, 3).join(", ")} in "${title}"`.slice(0, 160), html, text };
}

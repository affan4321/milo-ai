import { asc, eq } from "drizzle-orm";
import { PermanentError, emailDomain, formatMs } from "@milo/core";
import { actionItems, calendarEvents, meetings, preferences, summaries, users, type Db } from "@milo/db";
import type { EmailProvider } from "@milo/providers";

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/**
 * Who gets the recap, from the owner's auto-share rule. The owner always receives their own recap (unless the rule is "none").
 * attendees = everyone invited; internal = only invitees from the owner's own email domain.
 */
export function recipientsFor(rule: string, ownerEmail: string, attendees: { email: string }[]): string[] {
  if (rule !== "attendees" && rule !== "internal") return [];
  const owner = ownerEmail.toLowerCase();
  const pool = attendees.map((a) => a.email.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e) && !/^(noreply|no-reply)@/.test(e));
  const chosen = rule === "internal" ? pool.filter((e) => emailDomain(e) === emailDomain(owner)) : pool;
  return [...new Set([owner, ...chosen])];
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface RecapInput { title: string; when: Date; sections: { heading: string; bullets: string[] }[]; actionItems: { text: string; assignee: string | null; ms: number | null }[]; url: string }

/** Recap content as HTML + plain text. Everything from the meeting is escaped: titles and summaries are user/AI-controlled. */
export function buildRecapEmail(r: RecapInput): { subject: string; html: string; text: string } {
  const sec = r.sections.filter((s) => s.bullets.length).slice(0, 6);
  const items = r.actionItems.slice(0, 15);
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:620px;margin:auto;color:#1c1917">
<h2 style="margin:0 0 4px">${escapeHtml(r.title)}</h2><p style="margin:0 0 20px;color:#78716c">${escapeHtml(r.when.toUTCString().replace(/ GMT$/, " UTC"))}</p>
${sec.map((s) => `<h3 style="margin:18px 0 6px">${escapeHtml(s.heading)}</h3><ul style="margin:0;padding-left:20px">${s.bullets.slice(0, 8).map((b) => `<li style="margin:3px 0">${escapeHtml(b)}</li>`).join("")}</ul>`).join("")}
${items.length ? `<h3 style="margin:18px 0 6px">Action items</h3><ul style="margin:0;padding-left:20px">${items.map((a) => `<li style="margin:3px 0">${a.assignee ? `<strong>${escapeHtml(a.assignee)}</strong>: ` : ""}${escapeHtml(a.text)}</li>`).join("")}</ul>` : ""}
<p style="margin:24px 0"><a href="${escapeHtml(r.url)}" style="background:#6d5efc;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">View in Milo</a></p>
<p style="color:#78716c;font-size:12px">Sent by Milo, an AI meeting notetaker, because you were part of this meeting.</p></body></html>`;
  const text = [r.title, r.when.toUTCString(), "", ...sec.flatMap((s) => [s.heading, ...s.bullets.slice(0, 8).map((b) => `  - ${b}`), ""]),
    ...(items.length ? ["Action items", ...items.map((a) => `  - ${a.assignee ? `${a.assignee}: ` : ""}${a.text}${a.ms !== null ? ` (${formatMs(a.ms)})` : ""}`), ""] : []), `View in Milo: ${r.url}`].join("\n");
  return { subject: `Recap: ${r.title}`.slice(0, 150), html, text };
}

export type RecapResult = { sent: number } | { skipped: "already_sent" | "rule_none" | "disabled" | "no_summary" };

/**
 * Send the post-meeting recap once. Idempotent: `recapSentAt` is set only after sending, so a retry after a failure re-sends,
 * and a retry after success does nothing. If some recipients fail after others succeeded, the meeting is still marked sent
 * (re-sending would duplicate mail to the ones who already have it) and the failures are reported.
 */
export async function sendRecap(db: Db, mail: EmailProvider, meetingId: string, appUrl: string): Promise<RecapResult & { failed?: string[] }> {
  const [m] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!m?.ownerId) throw new PermanentError("meeting not found");
  if (m.recapSentAt) return { skipped: "already_sent" };
  const [owner] = await db.select().from(users).where(eq(users.id, m.ownerId));
  const [prefs] = await db.select().from(preferences).where(eq(preferences.userId, m.ownerId));
  if (!owner) throw new PermanentError("owner not found");
  if (prefs && !prefs.recapEmail) return { skipped: "disabled" };
  const rule = prefs?.autoShareRule ?? "attendees";
  if (rule === "none") return { skipped: "rule_none" };

  const [sum] = await db.select().from(summaries).where(eq(summaries.meetingId, meetingId)).orderBy(asc(summaries.createdAt)).limit(1);
  if (!sum) return { skipped: "no_summary" };
  const items = await db.select().from(actionItems).where(eq(actionItems.meetingId, meetingId));
  const [ev] = m.calendarEventId ? await db.select().from(calendarEvents).where(eq(calendarEvents.id, m.calendarEventId)) : [];
  const to = recipientsFor(rule, owner.email, ev?.attendees ?? []);

  const base = appUrl.replace(/\/$/, "");
  const msg = buildRecapEmail({ title: m.title, when: m.startedAt ?? m.createdAt, url: `${base}/meetings/${m.id}`,
    sections: sum.content.sections.map((s) => ({ heading: s.heading, bullets: s.bullets.map((b) => b.text) })),
    actionItems: items.map((a) => ({ text: a.text, assignee: a.assignee, ms: a.sourceMs })) });
  let sent = 0; const failed: string[] = []; let lastError: unknown;
  for (const addr of to) { try { await mail.send({ to: addr, ...msg }); sent++; } catch (e) { failed.push(addr); lastError = e; } }
  if (sent === 0) throw lastError ?? new Error("no recipients");   // nothing delivered: let the queue retry
  await db.update(meetings).set({ recapSentAt: new Date() }).where(eq(meetings.id, meetingId));
  return { sent, ...(failed.length ? { failed } : {}) };
}

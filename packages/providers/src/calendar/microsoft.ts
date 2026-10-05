import { detectMeeting } from "@milo/core";
import type { CalendarEventOut, CalendarProvider } from "../types";

export class MicrosoftAuthError extends Error {}
export interface MicrosoftCreds { clientId: string; clientSecret: string; refreshToken: string; tenant?: string }
const strip = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&amp;|&lt;|&gt;/g, " ");

/**
 * Outlook / Microsoft 365 calendar through Microsoft Graph, using a stored refresh token (scope offline_access + Calendars.Read).
 * NOT yet verified against a live Microsoft account: parsing and error handling are covered by mocked tests only.
 */
export class MicrosoftCalendar implements CalendarProvider {
  constructor(private c: MicrosoftCreds, private windowDays = 14, private fetchImpl: typeof fetch = fetch) {}

  private async accessToken(): Promise<string> {
    const res = await this.fetchImpl(`https://login.microsoftonline.com/${this.c.tenant ?? "common"}/oauth2/v2.0/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.c.clientId, client_secret: this.c.clientSecret, refresh_token: this.c.refreshToken, grant_type: "refresh_token", scope: "https://graph.microsoft.com/Calendars.Read offline_access" }),
      signal: AbortSignal.timeout(15_000),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (body.error === "invalid_grant" || body.error === "interaction_required") throw new MicrosoftAuthError("Microsoft access expired or was revoked. Sign in with Microsoft again to reconnect your calendar.");
      throw new Error(`Microsoft token refresh failed: ${body.error ?? res.status}`);
    }
    return body.access_token;
  }

  async listUpcoming(): Promise<CalendarEventOut[]> {
    const token = await this.accessToken();
    const now = new Date(), end = new Date(+now + this.windowDays * 86_400_000);
    let url: string | undefined = `https://graph.microsoft.com/v1.0/me/calendarView?${new URLSearchParams({ startDateTime: now.toISOString(), endDateTime: end.toISOString(), $top: "100", $orderby: "start/dateTime", $select: "id,subject,start,end,isCancelled,isAllDay,onlineMeeting,onlineMeetingUrl,location,body,attendees,organizer" })}`;
    const items: any[] = [];
    for (let page = 0; url && page < 3; page++) {
      const res: Response = await this.fetchImpl(url, { headers: { authorization: `Bearer ${token}`, prefer: 'outlook.timezone="UTC"' }, signal: AbortSignal.timeout(20_000) });
      if (res.status === 401 || res.status === 403) throw new MicrosoftAuthError(`Microsoft refused access (HTTP ${res.status}). Reconnect Microsoft.`);
      if (!res.ok) throw new Error(`Microsoft Graph error: HTTP ${res.status}`);
      const body: any = await res.json(); items.push(...(body.value ?? [])); url = body["@odata.nextLink"];
    }
    return parseGraphEvents(items);
  }
}

/** Graph returns UTC times without a zone suffix when we ask for outlook.timezone="UTC". */
const utc = (s: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);

export function parseGraphEvents(items: any[]): CalendarEventOut[] {
  const out: CalendarEventOut[] = [];
  for (const ev of items) {
    if (ev.isCancelled || ev.isAllDay || !ev.start?.dateTime) continue;
    const link = detectMeeting([ev.onlineMeeting?.joinUrl, ev.onlineMeetingUrl, ev.location?.displayName, ev.body?.content ? strip(ev.body.content) : "", ev.body?.content].filter(Boolean).join(" "));
    out.push({
      externalId: String(ev.id), title: ev.subject || "(no title)", startsAt: utc(ev.start.dateTime), endsAt: utc(ev.end?.dateTime ?? ev.start.dateTime),
      attendees: (ev.attendees ?? []).filter((a: any) => a.emailAddress?.address && a.type !== "resource").map((a: any) => ({ email: a.emailAddress.address, ...(a.emailAddress.name ? { name: a.emailAddress.name } : {}) })),
      organizerEmail: ev.organizer?.emailAddress?.address ?? null, meetingUrl: link?.url ?? null, platform: link?.platform ?? "unknown",
    });
  }
  return out;
}

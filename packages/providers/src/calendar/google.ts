import { detectMeeting } from "@milo/core";
import type { CalendarEventOut, CalendarProvider } from "../types";

export class GoogleAuthError extends Error {}

export interface GoogleCreds { clientId: string; clientSecret: string; refreshToken: string }

/** Google Calendar via a stored refresh token. Testing-mode tokens expire after 7 days -> GoogleAuthError so the UI can ask to reconnect. */
export class GoogleCalendar implements CalendarProvider {
  constructor(private creds: GoogleCreds, private windowDays = 14) {}

  private async accessToken(): Promise<string> {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.creds.clientId, client_secret: this.creds.clientSecret,
        refresh_token: this.creds.refreshToken, grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (body.error === "invalid_grant") throw new GoogleAuthError("Google access expired or was revoked. Sign in with Google again to reconnect your calendar.");
      throw new Error(`Google token refresh failed: ${body.error ?? res.status}`);
    }
    return body.access_token;
  }

  async listUpcoming(): Promise<CalendarEventOut[]> {
    const token = await this.accessToken();
    const now = new Date();
    const params = new URLSearchParams({
      singleEvents: "true", orderBy: "startTime", maxResults: "100",
      timeMin: now.toISOString(), timeMax: new Date(+now + this.windowDays * 86_400_000).toISOString(),
    });
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 401 || res.status === 403) throw new GoogleAuthError(`Google Calendar refused access (HTTP ${res.status}). Reconnect Google.`);
    if (!res.ok) throw new Error(`Google Calendar error: HTTP ${res.status}`);
    return parseGoogleEvents(((await res.json()) as any).items ?? []);
  }
}

export function parseGoogleEvents(items: any[]): CalendarEventOut[] {
  const out: CalendarEventOut[] = [];
  for (const ev of items) {
    if (ev.status === "cancelled" || !ev.start?.dateTime) continue; // skip cancelled and all-day events
    const video = ev.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === "video")?.uri;
    const link = detectMeeting([ev.hangoutLink, video, ev.location, ev.description].filter(Boolean).join(" "));
    out.push({
      externalId: String(ev.id), title: ev.summary || "(no title)",
      startsAt: new Date(ev.start.dateTime), endsAt: new Date(ev.end?.dateTime ?? ev.start.dateTime),
      attendees: (ev.attendees ?? []).filter((a: any) => a.email && !a.resource).map((a: any) => ({ email: a.email, ...(a.displayName ? { name: a.displayName } : {}) })),
      meetingUrl: link?.url ?? null, platform: link?.platform ?? "unknown",
    });
  }
  return out;
}

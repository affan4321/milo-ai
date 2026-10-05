import { PermanentError } from "@milo/core";
import type { EmailMessage, EmailProvider } from "../types";

/** Transactional email through Resend's HTTP API (https://resend.com). Unverified against the live service; see the mocked test. */
export class ResendEmail implements EmailProvider {
  constructor(private o: { apiKey: string; from: string; fetch?: typeof fetch }) {}
  async send(m: EmailMessage) {
    if (!this.o.apiKey || !this.o.from) throw new PermanentError("RESEND_API_KEY and EMAIL_FROM must be set to send email.");
    const res = await (this.o.fetch ?? fetch)("https://api.resend.com/emails", {
      method: "POST", headers: { authorization: `Bearer ${this.o.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.o.from, to: [m.to], subject: m.subject, html: m.html, ...(m.text ? { text: m.text } : {}) }), signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return;
    const body: any = await res.json().catch(() => ({}));
    const msg = body?.message ?? body?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 429 || res.status >= 500) throw new Error(`Email provider is busy or down (${res.status}); retrying.`);  // transient
    throw new PermanentError(`Email was rejected: ${msg}`);                                                                       // bad key / unverified domain / bad address
  }
}

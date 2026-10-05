import { config } from "../config";
import type { EndReason, JoinResult, PlatformAdapter } from "./types";
import { WebAdapter, sleep, realCaptchaOnScreen } from "./web-adapter";
import { S, TEXT } from "./zoom-selectors";

export type ZoomPhase = "in_call" | "captcha" | "denied" | "guests_blocked" | "bad_link" | "waiting" | "prejoin" | "removed" | "ended" | "unknown";

/**
 * Invites use `zoom.us/j/<id>?pwd=<passcode>` (or a regional host like us02web.zoom.us). That page tries to launch the desktop app;
 * the web client lives at `/wc/join/<id>`. Personal links (`/my/<name>`) can't be converted, so they are used as they are and the
 * page's own "join from your browser" link is clicked.
 */
export function zoomWebUrl(link: string): string {
  try {
    const u = new URL(link);
    const m = /^\/(?:j|wc\/join|wc)\/(\d{9,12})/.exec(u.pathname);
    if (!m) return link;
    const out = new URL(`${u.protocol}//${u.host}/wc/join/${m[1]}`);
    const pwd = u.searchParams.get("pwd");
    if (pwd) out.searchParams.set("pwd", pwd);
    return out.toString();
  } catch { return link; }
}

/** Pure, so it can be tested without a browser. The waiting room also shows a Leave control, so "waiting" is decided before "in_call". */
export function classifyZoom(text: string, f: { leave: boolean; join: boolean; nameInput: boolean; captcha?: boolean }): ZoomPhase {
  if (TEXT.waiting.test(text)) return "waiting";
  if (TEXT.removed.test(text)) return "removed";
  if (f.captcha || TEXT.captcha.test(text)) return "captcha";
  if (TEXT.denied.test(text)) return "denied";
  if (TEXT.badLink.test(text)) return "bad_link";
  if (TEXT.guestsBlocked.test(text)) return "guests_blocked";
  if (TEXT.ended.test(text)) return "ended";
  if (f.nameInput && f.join) return "prejoin";
  if (f.leave) return "in_call";
  return "unknown";
}

export class ZoomAdapter extends WebAdapter implements PlatformAdapter {
  protected readonly tag = "zoom";
  protected panelSelector = '[class*="chat-container"], [class*="participants-section"]';
  private everSawOthers = false;
  private lastText = "";

  private async phase(): Promise<ZoomPhase> {
    const page = this.p;
    if (page.isClosed()) return "ended";
    const text = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
    this.lastText = text;
    const vis = (loc: ReturnType<typeof page.locator>) => loc.first().isVisible().catch(() => false);
    return classifyZoom(text, {
      leave: await vis(page.locator(S.leaveButton)),
      join: await page.getByRole("button", { name: S.joinButton }).first().isVisible().catch(() => false),
      nameInput: await vis(page.locator(S.nameInput)),
      captcha: await realCaptchaOnScreen(page, S.captcha), // the invisible badge is not a challenge
    });
  }

  /** Zoom asks to join computer audio (needed to hear anyone, so the recording has sound). Join muted, camera off. */
  private async settleAudio() {
    const page = this.p;
    await this.clickIfVisible(page.getByRole("button", { name: S.joinAudio }));
    await this.clickIfVisible(page.locator(S.muteButton));
    await this.clickIfVisible(page.locator(S.stopVideoButton));
  }

  async join(url: string, displayName: string, hooks: { onWaiting(): void }): Promise<JoinResult> {
    const page = await this.launch();
    try { await page.goto(zoomWebUrl(url), { waitUntil: "domcontentloaded", timeout: 45_000 }); }
    catch { await this.dump("goto-failed", true); return { admitted: false, reason: "bad_link" }; }
    await this.dump("loaded");
    // A personal or unconverted link lands on the app launcher; its "Join from Your Browser" link leads to the web client.
    await this.clickIfVisible(page.getByRole("link", { name: /join from your browser/i }));

    const deadline = Date.now() + config.joinTimeoutMs;
    let clicked = false, notedWaiting = false, unknownSince = 0;
    while (Date.now() < deadline) {
      const ph = await this.phase();
      switch (ph) {
        case "in_call": await this.settleAudio(); await sleep(2000); await this.dump("in-call"); return { admitted: true };
        case "captcha": await this.dump("captcha", true); return { admitted: false, reason: "captcha" };
        case "denied": await this.dump("denied", true); return { admitted: false, reason: "denied" };
        case "bad_link": await this.dump("bad-link", true); return { admitted: false, reason: "bad_link" };
        case "guests_blocked": await this.dump("guests-blocked", true); return { admitted: false, reason: "guests_blocked" };
        case "removed": case "ended": await this.dump("ended-before-join", true); return { admitted: false, reason: "removed_early" };
        case "waiting": if (!notedWaiting) { notedWaiting = true; hooks.onWaiting(); await this.dump("waiting"); } unknownSince = 0; break;
        case "prejoin":
          unknownSince = 0;
          if (!clicked) {
            await page.locator(S.nameInput).first().fill(displayName).catch(() => {});
            await this.clickIfVisible(page.locator(S.muteButton)); await this.clickIfVisible(page.locator(S.stopVideoButton));
            await this.dump("prejoin");
            clicked = await this.clickIfVisible(page.getByRole("button", { name: S.joinButton }));
          }
          break;
        default:
          await this.clickIfVisible(page.getByRole("button", { name: S.dismissButton }));
          unknownSince ||= Date.now();
          if (Date.now() - unknownSince > 45_000) { await this.dump("join-unknown", true); return { admitted: false, reason: "join_error" }; }
      }
      await sleep(1000);
    }
    await this.dump("join-timeout", true);
    return { admitted: false, reason: "not_admitted" };
  }

  private async openChat(): Promise<boolean> {
    const page = this.p;
    if (await page.locator(S.chatInput).first().isVisible().catch(() => false)) return true;
    if (!(await this.clickIfVisible(page.locator(S.chatButton)))) return false;
    return page.locator(S.chatInput).first().waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false);
  }

  postConsent(message: string) { return this.sendChat(message); }

  async sendChat(message: string): Promise<boolean> {
    const probe = message.slice(0, 40);
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        if (!(await this.openChat())) { await this.dump(`consent-no-chat-${attempt}`); await sleep(2500); continue; }
        await this.p.locator(S.chatInput).first().click({ timeout: 3000 });
        await this.p.keyboard.insertText(message);
        await this.p.keyboard.press("Enter");
        if (await this.p.getByText(probe, { exact: false }).first().waitFor({ timeout: 4000 }).then(() => true, () => false)) { await this.dump("consent-posted"); return true; }
      } catch { /* editor re-rendered mid-action: try again */ }
      await sleep(800);
    }
    await this.dump("consent-failed", true);
    return false;
  }

  /**
   * Zoom has no captions unless the host turns them on, so speakers come from the tile Zoom outlines for whoever is talking.
   * That gives names and timing but no words: text is empty, and the transcript's words come from the audio.
   */
  async watchSpeakers(cb: (name: string, text: string, epochMs: number) => void): Promise<void> {
    const page = this.p;
    await page.exposeFunction("__miloSpeaker", (name: string) => cb(name, "", Date.now()));
    await page.evaluate((s) => {
      let last = "";
      setInterval(() => {
        const tile = document.querySelector(s.active);
        const el = tile?.matches(s.name) ? tile : tile?.querySelector(s.name);
        const name = ((el as HTMLElement | null)?.innerText ?? "").split("\n")[0]?.trim() ?? "";
        if (name && name !== "") { last = name; (window as any).__miloSpeaker(name); } else last = "";
      }, 500);
    }, { active: S.activeSpeaker, name: S.speakerName });
  }

  async watchChat(cb: (from: string, text: string, epochMs: number) => void): Promise<void> {
    const page = this.p;
    await page.exposeFunction("__miloChat", (from: string, text: string) => cb(from, text, Date.now()));
    await this.openChat();
    await page.evaluate((s) => {
      const seen = new Set<string>();
      const scan = () => document.querySelectorAll(s.msg).forEach((el) => {
        const body = (el.querySelector(s.body) as HTMLElement | null)?.innerText?.trim() ?? "";
        const root = (el.closest('[class*="chat-item"], [class*="chat-message"]') ?? el) as HTMLElement;
        const from = (root.querySelector(s.sender) as HTMLElement | null)?.innerText?.trim() ?? "Unknown";
        const text = body || (el as HTMLElement).innerText?.trim();
        const id = `${from}|${text}`;
        if (!text || seen.has(id)) return; seen.add(id);
        (window as any).__miloChat(from.replace(/\s*to\s+everyone.*$/i, ""), text);
      });
      scan();
      new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
    }, { msg: S.chatMessage, body: S.chatBody, sender: S.chatSender });
  }

  private async count(): Promise<number | undefined> {
    const page = this.p;
    if (TEXT.alone.test(this.lastText)) return 1;
    const counter = page.locator(S.participantCounter).first();
    const label = (await counter.count().catch(() => 0)) ? await counter.evaluate((el) => (el as HTMLElement).innerText, undefined, { timeout: 1500 }).catch(() => "") : "";
    const n = /(\d+)/.exec(label);
    if (n) return Number(n[1]);
    const rows = await page.locator(S.participantRow).count().catch(() => 0);
    return rows > 0 ? rows : undefined;
  }

  async watchParticipants(cb: (names: string[], epochMs: number) => void): Promise<void> {
    const tick = async () => {
      if (!this.page || this.page.isClosed()) return;
      if ((await this.page.locator(S.participantRow).count().catch(() => 0)) === 0) await this.clickIfVisible(this.page.locator(S.participantsButton)); // the list renders only while the panel is open
      const names = await this.page.locator(S.participantRow).evaluateAll((els, sel) => els.map((e) => ((e.querySelector(sel as string) as HTMLElement | null)?.innerText ?? (e as HTMLElement).innerText).split("\n")[0]?.trim() ?? "").filter(Boolean), S.participantName).catch(() => [] as string[]);
      if (names.length) cb([...new Set(names.map((n) => n.replace(/\s*\((host|me|guest|co-host)[^)]*\)\s*$/i, "")))], Date.now());
      setTimeout(tick, 5000);
    };
    setTimeout(tick, 2000);
  }

  async detectEnd(o: { aloneGraceMs: number; aloneAtStartMs: number; maxMs: number; onCount?: (n: number, epochMs: number) => void }): Promise<EndReason> {
    const t0 = Date.now(); let aloneSince = 0, lastTick = Date.now();
    for (;;) {
      if (Date.now() - t0 > o.maxMs) return "timeout";
      const ph = await this.phase();
      if (ph === "removed") { await this.dump("removed", true); return "removed"; }
      if (ph === "ended" || ph === "denied") { await this.dump("ended", true); return "ended"; }
      if (ph !== "in_call" && ph !== "unknown") return "ended";
      if (config.debug && Date.now() - lastTick > 45_000) { lastTick = Date.now(); await this.dump("tick"); }
      const n = await this.count();
      if (n !== undefined) {
        o.onCount?.(n, Date.now());
        if (n > 1) { this.everSawOthers = true; aloneSince = 0; }
        else {
          aloneSince ||= Date.now();
          if (Date.now() - aloneSince > (this.everSawOthers ? o.aloneGraceMs : o.aloneAtStartMs)) { await this.dump("alone"); return "alone"; }
        }
      }
      await sleep(1000);
    }
  }

  async leave() {
    if (await this.clickIfVisible(this.p.locator(S.leaveButton))) { await sleep(500); await this.clickIfVisible(this.p.getByRole("button", { name: S.leaveConfirm })); }
    await sleep(1000);
  }
}

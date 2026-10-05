import { config } from "../config";
import { WebAdapter, sleep, realCaptchaOnScreen } from "./web-adapter";
import type { EndReason, JoinResult, PlatformAdapter } from "./types";
import { S, TEXT } from "./meet-selectors";

type Phase = "in_call" | "captcha" | "denied" | "guests_blocked" | "bad_link" | "waiting" | "prejoin" | "sign_in_required" | "removed" | "ended" | "unknown";

export class MeetAdapter extends WebAdapter implements PlatformAdapter {
  protected readonly tag = "meet";
  private everSawOthers = false;
  private lastText = "";

  // ---------- page state ----------
  private async phase(): Promise<Phase> {
    const page = this.p;
    if (page.isClosed()) return "ended";
    const url = page.url();
    const text = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
    this.lastText = text;
    const visible = async (sel: string) => (await page.locator(sel).first().isVisible().catch(() => false));
    // The waiting room has a "Leave call" button too (seen on real Meet), so "waiting" must be decided BEFORE "in_call".
    if (TEXT.waiting.test(text)) return "waiting";
    if (await visible(S.leaveButton)) return "in_call";
    if (TEXT.removed.test(text)) return "removed";
    // Meet always loads a hidden reCAPTCHA frame, even on the "Connecting…" screen: only a VISIBLE challenge (or its wording) is a block.
    if ((await realCaptchaOnScreen(page, S.captcha)) || TEXT.captcha.test(text)) return "captcha"; // the invisible badge Meet always loads is not a challenge
    if (TEXT.denied.test(text)) return "denied";
    if (TEXT.badLink.test(text)) return "bad_link";
    if (TEXT.guestsBlocked.test(text)) return "guests_blocked";
    if (TEXT.ended.test(text)) return "ended";
    if (await page.getByRole("button", { name: S.joinButton }).first().isVisible().catch(() => false)) return "prejoin";
    if (/accounts\.google\.com/.test(url) || TEXT.signIn.test(text)) return "sign_in_required";
    return "unknown";
  }

  // ---------- PlatformAdapter ----------
  async join(url: string, displayName: string, hooks: { onWaiting(): void }): Promise<JoinResult> {
    const page = await this.launch();
    try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }); }
    catch { await this.dump("goto-failed", true); return { admitted: false, reason: "bad_link" }; }
    await this.dump("loaded");

    const deadline = Date.now() + config.joinTimeoutMs;
    let clicked = false, notedWaiting = false, unknownSince = 0;
    while (Date.now() < deadline) {
      const ph = await this.phase();
      switch (ph) {
        case "in_call": await sleep(2500); await this.dump("in-call"); return { admitted: true }; // let the call UI settle before we start poking at it
        case "captcha": await this.dump("captcha", true); return { admitted: false, reason: "captcha" };
        case "denied": await this.dump("denied", true); return { admitted: false, reason: "denied" };
        case "bad_link": await this.dump("bad-link", true); return { admitted: false, reason: "bad_link" };
        case "guests_blocked": await this.dump("guests-blocked", true); return { admitted: false, reason: "guests_blocked" };
        case "removed": case "ended": await this.dump("ended-before-join", true); return { admitted: false, reason: "removed_early" };
        case "sign_in_required": await this.dump("sign-in", true); return { admitted: false, reason: "sign_in_required" };
        case "waiting": if (!notedWaiting) { notedWaiting = true; hooks.onWaiting(); await this.dump("waiting"); } unknownSince = 0; break;
        case "prejoin":
          unknownSince = 0;
          if (!clicked) {
            // Signed-out guests get a name box; a signed-in bot account already has its name. Join muted either way.
            const name = page.locator(S.nameInput).first();
            if (await name.isVisible().catch(() => false)) await name.fill(displayName).catch(() => {});
            await this.clickIfVisible(page.locator(S.micOn)); await this.clickIfVisible(page.locator(S.camOn));
            await this.dump("prejoin");
            clicked = await this.clickIfVisible(page.getByRole("button", { name: S.joinButton }));
          }
          break;
        default: {
          await this.clickIfVisible(page.getByRole("button", { name: S.dismissButton }));
          unknownSince ||= Date.now();
          if (Date.now() - unknownSince > 45_000) { await this.dump("join-unknown", true); return { admitted: false, reason: "join_error" }; }
        }
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

  /**
   * Post the message and confirm it appears. The page can re-render between typing and sending (the box gets replaced and the
   * Enter lands nowhere), so confirm and retry rather than trusting a single attempt.
   */
  postConsent(message: string) { return this.sendChat(message); }

  async sendChat(message: string): Promise<boolean> {
    const probe = message.slice(0, 40);
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        if (!(await this.openChat())) { await this.dump(`consent-no-chat-${attempt}`); await sleep(2500); continue; } // not ready yet, host disabled chat, or the button moved
        const box = this.p.locator(S.chatInput).first();
        await box.fill(message, { timeout: 3000 });
        await box.press("Enter", { timeout: 3000 });
        if (await this.p.getByText(probe, { exact: false }).first().waitFor({ timeout: 4000 }).then(() => true, () => false)) { await this.dump("consent-posted"); return true; }
      } catch { /* element replaced mid-action: try again */ }
      await sleep(800);
    }
    await this.dump("consent-failed", true);
    return false;
  }

  async watchSpeakers(cb: (name: string, text: string, epochMs: number) => void): Promise<void> {
    const page = this.p;
    await page.exposeFunction("__miloCaption", (name: string, text: string) => cb(name, text, Date.now()));
    await this.dump("before-captions");
    const turnedOn = await this.clickIfVisible(page.locator(S.captionsOff)); // captions give real names with timestamps
    await sleep(1500);
    await this.dump(turnedOn ? "captions-on" : "captions-button-not-found", !turnedOn);
    await page.evaluate((sel) => {
      const last = new Map<number, string>();
      const scan = () => {
        const region = document.querySelector(sel);
        if (!region) return;
        // Each caption block: a speaker name on the first line, what they said below it.
        const blocks = Array.from(region.querySelectorAll(":scope > div, :scope > div > div")).filter((el) => el.children.length >= 1 && (el as HTMLElement).innerText?.trim());
        blocks.forEach((el, i) => {
          const lines = (el as HTMLElement).innerText.split("\n").map((l) => l.trim()).filter(Boolean);
          if (lines.length < 2) return;
          const key = lines.join("|");
          if (last.get(i) === key) return;
          last.set(i, key);
          (window as any).__miloCaption(lines[0], lines.slice(1).join(" "));
        });
      };
      let timer: number | undefined;
      new MutationObserver(() => { clearTimeout(timer); timer = window.setTimeout(scan, 250); }).observe(document.body, { childList: true, subtree: true, characterData: true });
    }, S.captionsRegion);
  }

  async watchChat(cb: (from: string, text: string, epochMs: number) => void): Promise<void> {
    const page = this.p;
    await page.exposeFunction("__miloChat", (from: string, text: string) => cb(from, text, Date.now()));
    await this.openChat();
    await page.evaluate((sel) => {
      const seen = new Set<string>();
      const scan = () => document.querySelectorAll(sel).forEach((el) => {
        const id = el.getAttribute("data-message-id") ?? (el as HTMLElement).innerText;
        if (seen.has(id)) return; seen.add(id);
        const lines = (el as HTMLElement).innerText.split("\n").map((l) => l.trim()).filter(Boolean);
        // The sender may come from an attribute or be the first line of the message block; either way it must not end up in the text.
        const attr = el.getAttribute("data-sender-name");
        const from = attr ?? (lines.length > 1 ? lines[0]! : "Unknown");
        const body = attr ? (lines[0] === attr ? lines.slice(1) : lines) : lines.length > 1 ? lines.slice(1) : lines;
        const text = body.join(" ");
        if (text) (window as any).__miloChat(from, text);
      });
      scan();
      new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
    }, S.chatMessage);
  }

  private async count(): Promise<number | undefined> {
    const page = this.p;
    if (TEXT.alone.test(this.lastText)) return 1; // Meet says so itself
    const btn = page.locator(S.peopleButton).first();
    // Only read it if it exists: `evaluate` on a missing element would wait out the full timeout on every poll.
    const label = (await btn.count().catch(() => 0)) ? await btn.evaluate((el) => `${el.getAttribute("aria-label") ?? ""} ${(el as HTMLElement).innerText ?? ""}`, undefined, { timeout: 1500 }).catch(() => "") : "";
    const n = /(\d+)/.exec(label);
    if (n) return Number(n[1]);
    const tiles = await page.locator(S.participantTile).count().catch(() => 0);
    return tiles > 0 ? tiles : undefined;
  }

  async watchParticipants(cb: (names: string[], epochMs: number) => void): Promise<void> {
    const tick = async () => {
      if (!this.page || this.page.isClosed()) return;
      const names = (await this.page.locator(S.participantTile).evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "").filter(Boolean)).catch(() => [] as string[]))
        .filter((n) => !/^[a-z]+(_[a-z]+)+$/.test(n)); // icon ligature text such as "visual_effects" is not a person
      if (names.length) cb([...new Set(names)], Date.now());
      setTimeout(tick, 5000);
    };
    setTimeout(tick, 2000);
  }

  async detectEnd(o: { aloneGraceMs: number; aloneAtStartMs: number; maxMs: number; onCount?: (n: number, epochMs: number) => void }): Promise<EndReason> {
    const t0 = Date.now(); let aloneSince = 0, lastTick = Date.now();
    for (;;) {
      if (Date.now() - t0 > o.maxMs) return "timeout";
      const pollStart = Date.now();
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
          // Allow a long wait if nobody has arrived yet; leave quickly once everyone else has gone.
          if (Date.now() - aloneSince > (this.everSawOthers ? o.aloneGraceMs : o.aloneAtStartMs)) { await this.dump("alone"); return "alone"; }
        }
      }
      if (Date.now() - pollStart > 4000) console.warn(`[meet] slow poll: ${Date.now() - pollStart}ms`);
      await sleep(1000);
    }
  }

  async leave() { await this.clickIfVisible(this.p.locator(S.leaveButton)); await sleep(1000); }
}

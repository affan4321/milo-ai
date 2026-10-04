import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { config } from "../config";
import type { EndReason, JoinResult, PlatformAdapter } from "./types";
import { S, TEXT } from "./meet-selectors";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Phase = "in_call" | "captcha" | "denied" | "guests_blocked" | "bad_link" | "waiting" | "prejoin" | "sign_in_required" | "removed" | "ended" | "unknown";

export class MeetAdapter implements PlatformAdapter {
  private ctx?: BrowserContext;
  private page?: Page;
  private everSawOthers = false;

  // ---------- browser ----------
  private async launch(): Promise<Page> {
    for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) fs.rmSync(path.join(config.profileDir, f), { force: true }); // stale after a crash
    this.ctx = await chromium.launchPersistentContext(config.profileDir, {
      channel: config.chromeChannel, headless: false, viewport: null, acceptDownloads: false,
      ignoreDefaultArgs: ["--enable-automation"],
      args: ["--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled", "--kiosk", "--window-position=0,0", `--window-size=${config.videoSize.replace("x", ",")}`,
        "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--disable-features=TranslateUI", "--lang=en-US"],
      locale: "en-US",
    });
    // tsx/esbuild wraps named functions in a __name() helper; functions we send into the page need it defined there too.
    await this.ctx.addInitScript("window.__name = window.__name || ((f) => f);");
    await this.ctx.grantPermissions(["microphone", "camera"]).catch(() => {});
    this.page = this.ctx.pages()[0] ?? (await this.ctx.newPage());
    return this.page;
  }
  private get p(): Page { if (!this.page) throw new Error("browser not started"); return this.page; }

  /** Screenshot + accessibility snapshot for tuning selectors against the real page. Always on failure, on request otherwise. */
  async dump(label: string, force = false) {
    if (!this.page || !(config.debug || force)) return;
    try {
      const dir = path.join(config.dataDir, "debug"); fs.mkdirSync(dir, { recursive: true });
      const base = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}`);
      await this.page.screenshot({ path: `${base}.png` }).catch(() => {});
      fs.writeFileSync(`${base}.aria.txt`, `${this.page.url()}\n\n${await this.page.locator("body").ariaSnapshot({ timeout: 5000 }).catch(() => "(no snapshot)")}`);
      console.log(`[meet] debug dump: ${base}.*`);
    } catch {}
  }

  // ---------- page state ----------
  private async phase(): Promise<Phase> {
    const page = this.p;
    if (page.isClosed()) return "ended";
    const url = page.url();
    const text = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
    const visible = async (sel: string) => (await page.locator(sel).first().isVisible().catch(() => false));
    if (await visible(S.leaveButton)) return "in_call";
    if (TEXT.removed.test(text)) return "removed";
    if ((await page.locator(S.captcha).count().catch(() => 0)) > 0 || TEXT.captcha.test(text)) return "captcha";
    if (TEXT.denied.test(text)) return "denied";
    if (TEXT.badLink.test(text)) return "bad_link";
    if (TEXT.guestsBlocked.test(text)) return "guests_blocked";
    if (TEXT.ended.test(text)) return "ended";
    if (TEXT.waiting.test(text)) return "waiting";
    if (await page.getByRole("button", { name: S.joinButton }).first().isVisible().catch(() => false)) return "prejoin";
    if (/accounts\.google\.com/.test(url) || TEXT.signIn.test(text)) return "sign_in_required";
    return "unknown";
  }

  private async clickIfVisible(loc: ReturnType<Page["locator"]>) {
    try { if (await loc.first().isVisible()) { await loc.first().click({ timeout: 3000 }); return true; } } catch {}
    return false;
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
        case "in_call": await this.dump("in-call"); return { admitted: true };
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
  async postConsent(message: string): Promise<boolean> {
    const probe = message.slice(0, 40);
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        if (!(await this.openChat())) return false; // host disabled chat, or the button moved
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
    await this.clickIfVisible(page.locator(S.captionsOff)); // captions give real names with timestamps
    await sleep(500);
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
    const label = await page.locator(S.peopleButton).first().evaluate((el) => `${el.getAttribute("aria-label") ?? ""} ${(el as HTMLElement).innerText ?? ""}`).catch(() => "");
    const n = /(\d+)/.exec(label);
    if (n) return Number(n[1]);
    const tiles = await page.locator(S.participantTile).count().catch(() => 0);
    return tiles > 0 ? tiles : undefined;
  }

  async watchParticipants(cb: (names: string[], epochMs: number) => void): Promise<void> {
    const tick = async () => {
      if (!this.page || this.page.isClosed()) return;
      const names = await this.page.locator(S.participantTile).evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "").filter(Boolean)).catch(() => [] as string[]);
      if (names.length) cb([...new Set(names)], Date.now());
      setTimeout(tick, 5000);
    };
    setTimeout(tick, 2000);
  }

  async detectEnd(o: { aloneGraceMs: number; aloneAtStartMs: number; maxMs: number }): Promise<EndReason> {
    const t0 = Date.now(); let aloneSince = 0;
    for (;;) {
      if (Date.now() - t0 > o.maxMs) return "timeout";
      const ph = await this.phase();
      if (ph === "removed") return "removed";
      if (ph === "ended" || ph === "denied") return "ended";
      if (ph !== "in_call" && ph !== "unknown") return "ended";
      const n = await this.count();
      if (n !== undefined) {
        if (n > 1) { this.everSawOthers = true; aloneSince = 0; }
        else {
          aloneSince ||= Date.now();
          // Allow a long wait if nobody has arrived yet; leave quickly once everyone else has gone.
          if (Date.now() - aloneSince > (this.everSawOthers ? o.aloneGraceMs : o.aloneAtStartMs)) return "alone";
        }
      }
      await sleep(2000);
    }
  }

  async leave() { await this.clickIfVisible(this.p.locator(S.leaveButton)); await sleep(1000); }
  async close() { await this.ctx?.close().catch(() => {}); this.ctx = undefined; this.page = undefined; }
}

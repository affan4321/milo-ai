import { config } from "../config";
import type { EndReason, JoinResult, PlatformAdapter } from "./types";
import { WebAdapter, sleep } from "./web-adapter";
import { S, TEXT } from "./teams-selectors";

export type TeamsPhase = "in_call" | "captcha" | "denied" | "guests_blocked" | "bad_link" | "waiting" | "prejoin" | "launcher" | "removed" | "ended" | "unknown";

/**
 * Decide what the page is showing from its visible text plus which controls exist. Pure so it can be tested without a browser.
 * Order matters: the lobby also shows a hang-up control, so "waiting" must be decided before "in_call".
 */
export function classifyTeams(text: string, f: { leave: boolean; join: boolean; joinOnWeb: boolean; captcha?: boolean }): TeamsPhase {
  if (TEXT.waiting.test(text)) return "waiting";
  if (TEXT.removed.test(text)) return "removed";
  if (f.captcha || TEXT.captcha.test(text)) return "captcha";
  if (TEXT.denied.test(text)) return "denied";
  if (TEXT.badLink.test(text)) return "bad_link";
  if (TEXT.guestsBlocked.test(text)) return "guests_blocked";
  if (f.leave && !f.join) return "in_call";
  if (f.join) return "prejoin";
  if (f.joinOnWeb) return "launcher";
  if (TEXT.ended.test(text)) return "ended";
  return "unknown";
}

export class TeamsAdapter extends WebAdapter implements PlatformAdapter {
  protected readonly tag = "teams";
  protected panelSelector = '[data-tid="app-layout-area--sidebar"], [data-tid="chat-pane"]';
  private everSawOthers = false;
  private lastText = "";

  private async phase(): Promise<TeamsPhase> {
    const page = this.p;
    if (page.isClosed()) return "ended";
    const text = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
    this.lastText = text;
    const vis = (loc: ReturnType<typeof page.locator>) => loc.first().isVisible().catch(() => false);
    return classifyTeams(text, {
      leave: await vis(page.locator(S.leaveButton)),
      join: await page.getByRole("button", { name: S.joinButton }).first().isVisible().catch(() => false),
      joinOnWeb: await page.getByRole("button", { name: S.joinOnWeb }).first().isVisible().catch(() => false) || await page.getByRole("link", { name: S.joinOnWeb }).first().isVisible().catch(() => false),
      captcha: await page.locator('iframe[src*="recaptcha" i]').first().isVisible().catch(() => false), // a hidden frame is not a challenge
    });
  }

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
        case "in_call": await sleep(2500); await this.dump("in-call"); return { admitted: true };
        case "captcha": await this.dump("captcha", true); return { admitted: false, reason: "captcha" };
        case "denied": await this.dump("denied", true); return { admitted: false, reason: "denied" };
        case "bad_link": await this.dump("bad-link", true); return { admitted: false, reason: "bad_link" };
        case "guests_blocked": await this.dump("guests-blocked", true); return { admitted: false, reason: "guests_blocked" };
        case "removed": case "ended": await this.dump("ended-before-join", true); return { admitted: false, reason: "removed_early" };
        case "launcher":
          unknownSince = 0;
          await this.clickIfVisible(page.getByRole("button", { name: S.joinOnWeb })) || await this.clickIfVisible(page.getByRole("link", { name: S.joinOnWeb }));
          break;
        case "waiting": if (!notedWaiting) { notedWaiting = true; hooks.onWaiting(); await this.dump("waiting"); } unknownSince = 0; break;
        case "prejoin":
          unknownSince = 0;
          if (!clicked) {
            const name = page.locator(S.nameInput).first();
            if (await name.isVisible().catch(() => false)) await name.fill(displayName).catch(() => {});
            await this.clickIfVisible(page.locator(S.micToggle)); await this.clickIfVisible(page.locator(S.camToggle)); // join muted, camera off
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
        const box = this.p.locator(S.chatInput).first();
        await box.click({ timeout: 3000 });
        await this.p.keyboard.insertText(message); // the editor is contenteditable, not an <input>
        await this.p.keyboard.press("Enter");
        if (await this.p.getByText(probe, { exact: false }).first().waitFor({ timeout: 4000 }).then(() => true, () => false)) { await this.dump("consent-posted"); return true; }
      } catch { /* editor re-rendered mid-action: try again */ }
      await sleep(800);
    }
    await this.dump("consent-failed", true);
    return false;
  }

  async watchSpeakers(cb: (name: string, text: string, epochMs: number) => void): Promise<void> {
    const page = this.p;
    await page.exposeFunction("__miloCaption", (name: string, text: string) => cb(name, text, Date.now()));
    // Live captions sit under More > Language and speech > Turn on live captions, and carry real names.
    let on = false;
    if (await this.clickIfVisible(page.locator(S.moreButton))) {
      await sleep(600);
      await this.clickIfVisible(page.getByRole("menuitem", { name: S.captionsMenu }));
      await sleep(600);
      on = await this.clickIfVisible(page.getByRole("menuitem", { name: S.captionsOn }));
      await sleep(1000);
    }
    await this.dump(on ? "captions-on" : "captions-button-not-found", !on);
    await page.evaluate((s) => {
      const last = new Map<Element, string>();
      const scan = () => {
        const region = document.querySelector(s.region);
        if (!region) return;
        region.querySelectorAll(s.author).forEach((a) => {
          const item = a.closest('[class*="item"], [role="listitem"], div')?.parentElement ?? a.parentElement;
          const t = item?.querySelector(s.text) as HTMLElement | null;
          const name = (a as HTMLElement).innerText.trim(), text = t?.innerText.trim() ?? "";
          if (!name || !text || last.get(a) === text) return;
          last.set(a, text);
          (window as any).__miloCaption(name, text);
        });
      };
      let timer: number | undefined;
      new MutationObserver(() => { clearTimeout(timer); timer = window.setTimeout(scan, 250); }).observe(document.body, { childList: true, subtree: true, characterData: true });
    }, { region: S.captionsRegion, author: S.captionAuthor, text: S.captionText });
  }

  async watchChat(cb: (from: string, text: string, epochMs: number) => void): Promise<void> {
    const page = this.p;
    await page.exposeFunction("__miloChat", (from: string, text: string) => cb(from, text, Date.now()));
    await this.openChat();
    await page.evaluate((s) => {
      const seen = new Set<string>();
      const scan = () => document.querySelectorAll(s.msg).forEach((el) => {
        const body = el.querySelector(s.body) as HTMLElement | null;
        const text = (body ?? (el as HTMLElement)).innerText?.trim();
        const from = (el.querySelector(s.author) as HTMLElement | null)?.innerText.trim() ?? "Unknown";
        const id = el.getAttribute("id") ?? el.getAttribute("data-mid") ?? `${from}|${text}`;
        if (!text || seen.has(id)) return; seen.add(id);
        (window as any).__miloChat(from, text);
      });
      scan();
      new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
    }, { msg: S.chatMessage, body: S.chatBody, author: S.chatAuthor });
  }

  private async count(): Promise<number | undefined> {
    const page = this.p;
    if (TEXT.alone.test(this.lastText)) return 1;
    const items = await page.locator(S.rosterItem).count().catch(() => 0);
    if (items > 0) return items;
    const header = page.locator(S.rosterCount).first();
    const label = (await header.count().catch(() => 0)) ? await header.evaluate((el) => (el as HTMLElement).innerText, undefined, { timeout: 1500 }).catch(() => "") : "";
    const n = /\((\d+)\)|(\d+)/.exec(label);
    return n ? Number(n[1] ?? n[2]) : undefined;
  }

  async watchParticipants(cb: (names: string[], epochMs: number) => void): Promise<void> {
    const tick = async () => {
      if (!this.page || this.page.isClosed()) return;
      if ((await this.page.locator(S.rosterItem).count().catch(() => 0)) === 0) await this.clickIfVisible(this.page.locator(S.peopleButton)); // the roster only renders while open
      const names = await this.page.locator(S.rosterItem).evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "").filter(Boolean)).catch(() => [] as string[]);
      if (names.length) cb([...new Set(names)], Date.now());
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

  async leave() { await this.clickIfVisible(this.p.locator(S.leaveButton)); await sleep(1000); }
}

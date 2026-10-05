import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { config } from "../config";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Is a real reCAPTCHA challenge on screen? Meet (and Teams, Zoom) always load an invisible reCAPTCHA badge frame, which hangs half
 * off the edge of the window, so "a recaptcha iframe exists/is visible" is true even in a healthy call. A challenge is a frame that is
 * large enough to hold a widget and sits entirely inside the window.
 */
export async function realCaptchaOnScreen(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => Array.from(document.querySelectorAll(sel)).some((el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && !el.closest(".grecaptcha-badge")
      && r.width >= 200 && r.height >= 60 && r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight;
  }), selector).catch(() => false);
}

/** Browser plumbing shared by every web-based platform adapter (launch, debug dumps, safe clicking). */
export abstract class WebAdapter {
  protected ctx?: BrowserContext;
  protected page?: Page;
  protected abstract readonly tag: string;
  /** CSS selector of a panel worth saving HTML for in debug dumps. */
  protected panelSelector = '[aria-label="Side panel"]';

  protected async launch(): Promise<Page> {
    for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) fs.rmSync(path.join(config.profileDir, f), { force: true }); // stale after a crash
    this.ctx = await chromium.launchPersistentContext(config.profileDir, {
      channel: config.chromeChannel, headless: false, viewport: null, acceptDownloads: false,
      ignoreDefaultArgs: ["--enable-automation"],
      args: ["--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled", "--kiosk", "--window-position=0,0", `--window-size=${config.videoSize.replace("x", ",")}`,
        "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--disable-features=TranslateUI", "--lang=en-US"],
      locale: "en-US",
    });
    // tsx/esbuild wraps named functions in a __name() helper; functions we send into the page need it defined there too.
    // Anything that isn't present should fail in seconds, never block for Playwright's 30 s default.
    this.ctx.setDefaultTimeout(5000);
    await this.ctx.addInitScript("window.__name = window.__name || ((f) => f);");
    await this.ctx.grantPermissions(["microphone", "camera"]).catch(() => {});
    this.page = this.ctx.pages()[0] ?? (await this.ctx.newPage());
    return this.page;
  }
  protected get p(): Page { if (!this.page) throw new Error("browser not started"); return this.page; }

  /** Screenshot + accessibility snapshot for tuning selectors against the real page. Always on failure, on request otherwise. */
  async dump(label: string, force = false) {
    if (!this.page || !(config.debug || force)) return;
    try {
      const dir = path.join(config.dataDir, "debug"); fs.mkdirSync(dir, { recursive: true });
      const base = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}`);
      await this.page.screenshot({ path: `${base}.png` }).catch(() => {});
      // Only look if the panel exists, and never wait on it: a missing element would otherwise block for Playwright's 30 s default.
      const sidePanel = this.page.locator(this.panelSelector).first();
      const panel = (await sidePanel.count().catch(() => 0)) ? await sidePanel.evaluate((el) => el.outerHTML, undefined, { timeout: 2000 }).catch(() => "") : "";
      if (panel) fs.writeFileSync(`${base}.panel.html`, panel.slice(0, 60_000));
      fs.writeFileSync(`${base}.aria.txt`, `${this.page.url()}\n\n${await this.page.locator("body").ariaSnapshot({ timeout: 5000 }).catch(() => "(no snapshot)")}`);
      console.log(`[${this.tag}] debug dump: ${base}.*`);
    } catch {}
  }

  protected async clickIfVisible(loc: ReturnType<Page["locator"]>) {
    try { if (await loc.first().isVisible()) { await loc.first().click({ timeout: 3000 }); return true; } } catch {}
    return false;
  }

  async close() { await this.ctx?.close().catch(() => {}); this.ctx = undefined; this.page = undefined; }
}

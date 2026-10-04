import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { config } from "./config";

/**
 * One-time sign-in of the bot's dedicated Google account. Run inside the container with a VNC viewer attached
 * (see docs/bot.md): you sign in by hand, Milo never sees the password, and the session lives in the profile volume.
 */
export async function loginMode() {
  for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) fs.rmSync(path.join(config.profileDir, f), { force: true });
  const ctx = await chromium.launchPersistentContext(config.profileDir, {
    channel: config.chromeChannel, headless: false, viewport: null, ignoreDefaultArgs: ["--enable-automation"],
    args: ["--no-first-run", "--disable-blink-features=AutomationControlled", "--window-position=0,0", `--window-size=${config.videoSize.replace("x", ",")}`],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("https://accounts.google.com/");
  console.log("Sign in to the bot's Google account in the browser window, its display name should be 'Milo AI Notetaker', then CLOSE the window.");
  await new Promise<void>((r) => ctx.on("close", () => r()));
  console.log("profile saved");
}

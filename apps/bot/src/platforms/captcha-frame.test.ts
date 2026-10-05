// Real-browser check of the captcha heuristic: the invisible reCAPTCHA badge Meet always loads must NOT count; a real widget must.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { realCaptchaOnScreen } from "./web-adapter";

const SEL = 'iframe[src*="recaptcha" i]';
const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL ?? "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const frame = (style: string) => `<iframe src="about:blank#recaptcha" style="${style}"></iframe>`;
const check = async (html: string) => { await page.setContent(`<body style="margin:0">${html}</body>`); return realCaptchaOnScreen(page, SEL); };

// the badge: 256x60, fixed to the bottom right but sliding mostly off-screen (right: -186px), inside .grecaptcha-badge
assert.equal(await check(`<div class="grecaptcha-badge" style="position:fixed;bottom:14px;right:-186px;width:256px;height:60px">${frame("width:256px;height:60px;border:0")}</div>`), false, "badge half off-screen");
assert.equal(await check(`<div class="grecaptcha-badge" style="position:fixed;bottom:14px;right:14px;width:256px;height:60px">${frame("width:256px;height:60px;border:0")}</div>`), false, "badge fully on-screen is still the badge");
assert.equal(await check(frame("position:fixed;right:-186px;bottom:14px;width:256px;height:60px;border:0")), false, "badge frame alone, hanging off the edge");
assert.equal(await check(frame("width:1px;height:1px;border:0")), false, "1x1 tracking frame");
assert.equal(await check(frame("display:none;width:400px;height:500px")), false, "hidden frame");
assert.equal(await check(""), false, "no frame at all");
assert.equal(await check(frame("position:fixed;left:400px;top:150px;width:400px;height:500px;border:0")), true, "challenge popup in the middle of the window");
assert.equal(await check(frame("width:304px;height:78px;border:0")), true, "I'm-not-a-robot checkbox widget");
await browser.close();
console.log("captcha frame tests passed");

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isPermanent } from "@milo/core";
import { OutboxEmail } from "./email/outbox";
import { ResendEmail } from "./email/resend";
let fails = 0; const check = (c: unknown, m: string) => { if (!c) { fails++; console.error("FAIL:", m); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outbox-"));
await new OutboxEmail(dir).send({ to: "ada@x.com/../../evil", subject: "Hi --> <script>", html: "<p>body</p>" });
const files = fs.readdirSync(dir);
check(files.length === 1 && !files[0]!.includes("/") && files[0]!.endsWith(".html"), "outbox writes one safe-named file (no path traversal)");
const content = fs.readFileSync(path.join(dir, files[0]!), "utf8");
check(content.includes("<p>body</p>") && !content.split("\n")[0]!.slice(4).includes("-->" ) || content.startsWith("<!-- To:"), "header comment can't be closed early by hostile subject");
check(content.split("\n")[0]!.indexOf("-->") === content.split("\n")[0]!.length - 3, "the header comment is closed exactly once");

let sent: any; const ok = (s: number, body: unknown = {}) => (async (_u: string, init: any) => { sent = { init }; return new Response(JSON.stringify(body), { status: s }); }) as unknown as typeof fetch;
await new ResendEmail({ apiKey: "k", from: "Milo <hi@m.io>", fetch: ok(200) }).send({ to: "a@b.com", subject: "S", html: "<b>h</b>", text: "t" });
const body = JSON.parse(sent.init.body);
check(sent.init.headers.authorization === "Bearer k" && body.to[0] === "a@b.com" && body.from === "Milo <hi@m.io>" && body.text === "t", "resend: request shape");
let e: any = await new ResendEmail({ apiKey: "k", from: "f", fetch: ok(429) }).send({ to: "a@b.com", subject: "S", html: "h" }).catch((x) => x); check(e && !isPermanent(e), "429 is retryable");
e = await new ResendEmail({ apiKey: "k", from: "f", fetch: ok(503) }).send({ to: "a@b.com", subject: "S", html: "h" }).catch((x) => x); check(e && !isPermanent(e), "5xx is retryable");
e = await new ResendEmail({ apiKey: "k", from: "f", fetch: ok(422, { message: "domain not verified" }) }).send({ to: "a@b.com", subject: "S", html: "h" }).catch((x) => x); check(isPermanent(e) && /domain not verified/.test(e.message), "rejection (bad domain/address) is permanent with the reason");
e = await new ResendEmail({ apiKey: "", from: "f", fetch: ok(200) }).send({ to: "a@b.com", subject: "S", html: "h" }).catch((x) => x); check(isPermanent(e), "missing key is permanent");
console.log(fails ? `${fails} FAILED` : "ok"); process.exit(fails ? 1 : 0);

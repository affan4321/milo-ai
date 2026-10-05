import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EmailMessage, EmailProvider } from "../types";

/** Development "mail server": every email becomes a .html file you can open in a browser. Nothing leaves the machine. */
export class OutboxEmail implements EmailProvider {
  // The folder is created when the first email is sent, NOT here: every request builds the providers, and on read-only serverless
  // hosting (Vercel) creating a folder at construction time made every route fail with HTTP 500.
  constructor(private dir: string) {}
  private ready(): string {
    try { fs.mkdirSync(this.dir, { recursive: true }); return this.dir; }
    catch { const tmp = path.join(os.tmpdir(), "milo-outbox"); fs.mkdirSync(tmp, { recursive: true }); return tmp; }
  }
  async send(m: EmailMessage) {
    const safe = m.to.replace(/[^a-z0-9@._-]/gi, "_").slice(0, 60);
    const file = path.join(this.ready(), `${new Date().toISOString().replace(/[:.]/g, "-")}__${safe}.html`);
    fs.writeFileSync(file, `<!-- To: ${m.to.replace(/--/g, "- -")} | Subject: ${m.subject.replace(/--/g, "- -")} -->\n${m.html}`);
  }
}

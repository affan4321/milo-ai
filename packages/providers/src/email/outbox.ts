import fs from "node:fs";
import path from "node:path";
import type { EmailMessage, EmailProvider } from "../types";

/** Development "mail server": every email becomes a .html file you can open in a browser. Nothing leaves the machine. */
export class OutboxEmail implements EmailProvider {
  constructor(private dir: string) { fs.mkdirSync(dir, { recursive: true }); }
  async send(m: EmailMessage) {
    const safe = m.to.replace(/[^a-z0-9@._-]/gi, "_").slice(0, 60);
    const file = path.join(this.dir, `${new Date().toISOString().replace(/[:.]/g, "-")}__${safe}.html`);
    fs.writeFileSync(file, `<!-- To: ${m.to.replace(/--/g, "- -")} | Subject: ${m.subject.replace(/--/g, "- -")} -->\n${m.html}`);
  }
}

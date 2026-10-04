import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { StorageProvider } from "../types";

function repoRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return process.cwd();
    dir = up;
  }
}

/** Disk-backed storage. Shared by web and worker via a common directory; swapped for S3/R2 in deployment. */
export class LocalStorage implements StorageProvider {
  private root: string;
  constructor(root = process.env.STORAGE_DIR ?? path.join(repoRoot(), ".data", "storage")) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
  }
  private abs(key: string) {
    const p = path.resolve(this.root, key);
    if (p !== this.root && !p.startsWith(this.root + path.sep)) throw new Error("invalid storage key");
    return p;
  }
  private prep(key: string) { const p = this.abs(key); fs.mkdirSync(path.dirname(p), { recursive: true }); return p; }

  async put(key: string, body: Uint8Array) { await fs.promises.writeFile(this.prep(key), body); }
  async putStream(key: string, body: Readable) {
    const final = this.prep(key), tmp = `${final}.part`;
    try { await pipeline(body, fs.createWriteStream(tmp)); } catch (e) { await fs.promises.rm(tmp, { force: true }); throw e; }
    await fs.promises.rename(tmp, final); // an aborted upload never leaves a half-written file under the real key
    return (await fs.promises.stat(final)).size;
  }
  async putFile(key: string, localPath: string) { await fs.promises.copyFile(localPath, this.prep(key)); }
  async toLocalFile(key: string) { return this.abs(key); }
  async size(key: string) { try { return (await fs.promises.stat(this.abs(key))).size; } catch { return null; } }
  read(key: string, range?: { start: number; end: number }) { return fs.createReadStream(this.abs(key), range); }
}

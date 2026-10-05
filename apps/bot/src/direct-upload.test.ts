// The bot's real uploader against a stub web app, with the files landing in a real S3 server (MinIO). Skipped if MinIO isn't up.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { S3Storage, contentTypeFor } from "@milo/providers";

const o = { endpoint: "http://localhost:9000", bucket: "milo-test", accessKeyId: "minio", secretAccessKey: "minio12345" };
// The bucket is created by packages/providers/src/s3.test.ts (run it first on a fresh MinIO).
const storage = new S3Storage(o);
try { await storage.size("probe"); } catch { console.log("MinIO/bucket not reachable; skipping"); process.exit(0); }
const id = `sess-${Date.now()}`, completed: string[] = [];

const web = http.createServer(async (req, res) => {
  const j = (b: object) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
  if (req.headers.authorization !== "Bearer test-token-test-token") { res.writeHead(401); return res.end(); }
  if (req.url!.endsWith("/upload-url")) {
    let body = ""; for await (const c of req) body += c; const b = JSON.parse(body);
    const key = b.kind === "sidecar" ? `bot/${id}/sidecar.json` : `bot/${id}/raw.${b.ext}`;
    return j({ mode: "direct", url: await storage.presignPut(key, 60), contentType: contentTypeFor(key) });
  }
  if (req.url!.includes("/recording/complete")) { completed.push(req.url!); return j({ ok: true }); }
  res.writeHead(404); res.end();
});
await new Promise<void>((r) => web.listen(0, r));
process.env.WEB_URL = `http://127.0.0.1:${(web.address() as any).port}`; process.env.BOT_TOKEN = "test-token-test-token";
const { api } = await import("./api");

const file = path.join(os.tmpdir(), `rec-${Date.now()}.mp4`); fs.writeFileSync(file, Buffer.alloc(3 * 1024 * 1024, 7));
await api.uploadSidecar(id, { version: 1, platform: "meet", recordingStartedAtMs: 0, endedBy: "ended", speakerEvents: [], captions: [], chat: [], participants: [] } as never);
await api.uploadRecording(id, file, "mp4");
assert.equal(await storage.size(`bot/${id}/raw.mp4`), 3 * 1024 * 1024, "recording landed in the bucket, whole");
assert.ok((await storage.size(`bot/${id}/sidecar.json`)) ?? 0 > 10, "sidecar landed");
assert.equal(completed.length, 1, "web app told to start processing exactly once");
web.close();
console.log("direct upload tests passed");

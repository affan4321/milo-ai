// Runs against a real S3-compatible server (the MinIO from docker-compose). Skipped if it isn't reachable.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import { S3Storage, contentTypeFor } from "./storage/s3";

const o = { endpoint: "http://localhost:9000", bucket: "milo-test", accessKeyId: "minio", secretAccessKey: "minio12345" };
const raw = new S3Client({ region: "auto", endpoint: o.endpoint, forcePathStyle: true, credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey } });
try { await raw.send(new CreateBucketCommand({ Bucket: o.bucket })); } catch (e: any) { if (!/Already|Exists|Owned/i.test(e?.name ?? "")) { console.log("MinIO not reachable; skipping:", e?.message ?? e); process.exit(0); } }

const s = new S3Storage(o), key = `t/${Date.now()}/a.mp4`, data = Buffer.from("0123456789abcdefghij");
assert.equal(await s.size(key), null, "missing object has no size");
await s.put(key, data);
assert.equal(await s.size(key), 20);
const chunks: Buffer[] = []; for await (const c of s.read(key, { start: 5, end: 9 })) chunks.push(c as Buffer);
assert.equal(Buffer.concat(chunks).toString(), "56789", "range read");
const local = await s.toLocalFile(key); assert.equal(fs.readFileSync(local).toString(), data.toString(), "download to temp file");
const key2 = `t/${Date.now()}/b.m4a`; assert.equal(await s.putStream(key2, Readable.from([Buffer.from("stream-"), Buffer.from("body")])), 11, "streamed upload");
const f = path.join(os.tmpdir(), `milo-s3-${Date.now()}.mp4`); fs.writeFileSync(f, "file-body"); const key3 = `t/${Date.now()}/c.mp4`; await s.putFile(key3, f); assert.equal(await s.size(key3), 9, "file upload");
// presigned PUT, the way a browser or the bot uploads without going through the web app
const key4 = `t/${Date.now()}/d.mp4`, put = await s.presignPut!(key4, 60);
const r = await fetch(put, { method: "PUT", headers: { "content-type": contentTypeFor(key4) }, body: "direct-upload" }); assert.equal(r.status, 200);
assert.equal(await s.size(key4), 13, "presigned upload landed");
const get = await fetch(await s.presignGet!(key4, 60), { headers: { range: "bytes=0-5" } });
assert.equal(get.status, 206); assert.equal(await get.text(), "direct", "presigned playback supports Range");
await assert.rejects(s.toLocalFile(`t/none/${Date.now()}.mp4`), /not found/);
console.log("s3 storage tests passed");

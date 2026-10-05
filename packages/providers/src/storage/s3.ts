import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { PassThrough, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageProvider } from "../types";

export interface S3Options { endpoint?: string; region?: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle?: boolean }

const TYPES: Record<string, string> = { mp4: "video/mp4", m4a: "audio/mp4", webm: "video/webm", mp3: "audio/mpeg", mov: "video/quicktime", mkv: "video/x-matroska", wav: "audio/wav", ogg: "audio/ogg", aac: "audio/aac", flac: "audio/flac", json: "application/json" };
/** The Content-Type a presigned upload of this key must send (it is part of the signature). */
export const contentTypeFor = (key: string) => TYPES[key.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

/**
 * S3-compatible object storage (Cloudflare R2, MinIO, AWS S3). Lets the web app run on serverless hosting: browsers and the bot
 * upload straight to the bucket with presigned URLs, and playback is a redirect to a presigned URL, so no recording ever passes
 * through a function (which would hit the platform's request-size and time limits).
 */
export class S3Storage implements StorageProvider {
  private s3: S3Client;
  private cacheDir = path.join(os.tmpdir(), "milo-s3-cache");
  constructor(private o: S3Options) {
    this.s3 = new S3Client({ region: o.region ?? "auto", endpoint: o.endpoint, forcePathStyle: o.forcePathStyle ?? true, credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey } });
  }
  private get Bucket() { return this.o.bucket; }

  async put(key: string, body: Uint8Array, contentType?: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.Bucket, Key: key, Body: body, ContentType: contentType ?? contentTypeFor(key) }));
  }
  async putStream(key: string, body: Readable) {
    await new Upload({ client: this.s3, params: { Bucket: this.Bucket, Key: key, Body: body, ContentType: contentTypeFor(key) } }).done();
    return (await this.size(key)) ?? 0;
  }
  async putFile(key: string, localPath: string) {
    await new Upload({ client: this.s3, params: { Bucket: this.Bucket, Key: key, Body: fs.createReadStream(localPath), ContentType: contentTypeFor(key) } }).done();
  }
  /** Downloads to a temp file (reused while the object's size is unchanged) so ffmpeg can read it. Files older than 6 h are pruned. */
  async toLocalFile(key: string) {
    fs.mkdirSync(this.cacheDir, { recursive: true });
    this.prune();
    const size = await this.size(key);
    if (size === null) throw new Error(`storage object not found: ${key}`);
    const file = path.join(this.cacheDir, `${crypto.createHash("sha1").update(key).digest("hex")}${path.extname(key)}`);
    if (fs.existsSync(file) && fs.statSync(file).size === size) { fs.utimesSync(file, new Date(), new Date()); return file; }
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.Bucket, Key: key }));
    const tmp = `${file}.${process.pid}.part`;
    try { await pipeline(res.Body as Readable, fs.createWriteStream(tmp)); fs.renameSync(tmp, file); }
    catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
    return file;
  }
  private prune() {
    try { for (const f of fs.readdirSync(this.cacheDir)) { const p = path.join(this.cacheDir, f); if (Date.now() - fs.statSync(p).mtimeMs > 6 * 3600_000) fs.rmSync(p, { force: true }); } } catch {}
  }
  async size(key: string) {
    try { return (await this.s3.send(new HeadObjectCommand({ Bucket: this.Bucket, Key: key }))).ContentLength ?? 0; }
    catch (e: any) { if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound") return null; throw e; }
  }
  read(key: string, range?: { start: number; end: number }) {
    const out = new PassThrough();
    this.s3.send(new GetObjectCommand({ Bucket: this.Bucket, Key: key, Range: range ? `bytes=${range.start}-${range.end}` : undefined }))
      .then((r) => (r.Body as Readable).on("error", (e) => out.destroy(e)).pipe(out), (e) => out.destroy(e));
    return out;
  }
  presignPut(key: string, expiresSec = 3600) {
    return getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.Bucket, Key: key, ContentType: contentTypeFor(key) }), { expiresIn: expiresSec });
  }
  presignGet(key: string, expiresSec = 3600) {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.Bucket, Key: key, ResponseContentType: contentTypeFor(key) }), { expiresIn: expiresSec });
  }
}

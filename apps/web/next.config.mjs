import path from "node:path";
import { fileURLToPath } from "node:url";

// Load the repo-root .env (Next only reads apps/web/.env by default). Absent on hosted builds, which use real environment variables.
try { process.loadEnvFile(new URL("../../.env", import.meta.url)); } catch {}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

// A second dev server (e.g. a no-login test instance on another port) must not share the first one's build directory:
// two servers rewriting the same .next corrupt each other. Start it with NEXT_DIST_DIR=.next-test.
export default {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Workspace packages live above apps/web; tracing must start at the repo root or hosted builds miss them.
  outputFileTracingRoot: root,
  // The local embedding model (native binaries, 100s of MB) is only used where EMBED_PROVIDER=local (the worker, or a self-hosted web).
  // Serverless hosting uses EMBED_PROVIDER=remote, so keep these out of the function bundle (size limit 250 MB).
  outputFileTracingExcludes: { "*": ["**/onnxruntime-node/**", "**/onnxruntime-common/**", "**/@huggingface/**", "**/sharp/**", "**/@img/**"] },
  transpilePackages: ["@milo/core", "@milo/db", "@milo/providers", "@milo/calendar", "@milo/media", "@milo/transcription", "@milo/intelligence", "@milo/sharing", "@milo/indexing", "@milo/search", "@milo/notify", "@milo/playlists"],
  serverExternalPackages: ["postgres", "@huggingface/transformers", "onnxruntime-node", "sharp", "@aws-sdk/client-s3", "@aws-sdk/lib-storage", "@aws-sdk/s3-request-presigner"],
};

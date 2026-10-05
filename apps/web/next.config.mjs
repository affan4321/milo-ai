// Load the repo-root .env (Next only reads apps/web/.env by default).
try { process.loadEnvFile(new URL("../../.env", import.meta.url)); } catch {}

// A second dev server (e.g. a no-login test instance on another port) must not share the first one's build directory:
// two servers rewriting the same .next corrupt each other. Start it with NEXT_DIST_DIR=.next-test.
export default { distDir: process.env.NEXT_DIST_DIR ?? ".next", transpilePackages: ["@milo/core", "@milo/db", "@milo/providers", "@milo/calendar", "@milo/media", "@milo/transcription", "@milo/intelligence", "@milo/sharing", "@milo/indexing", "@milo/search"], serverExternalPackages: ["postgres"] };

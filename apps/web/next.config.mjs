// Load the repo-root .env (Next only reads apps/web/.env by default).
try { process.loadEnvFile(new URL("../../.env", import.meta.url)); } catch {}

export default { transpilePackages: ["@milo/core", "@milo/db", "@milo/providers", "@milo/calendar", "@milo/media", "@milo/transcription", "@milo/intelligence"], serverExternalPackages: ["postgres"] };

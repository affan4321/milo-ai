# Hosting the web app on Vercel (https://miloainotetaker.vercel.app)

Vercel hosts **only the website**. The worker (processing, scheduling, embeddings) and the meeting bots keep running on your
machine or a server, and talk to the same hosted database and storage. A recording or a processing job only moves while that
machine is on; browsing, playback and (keyword) search work from Vercel alone.

```
 browser ─► Vercel (web) ─► Neon Postgres ◄─ worker + bots (your machine)
    │            │                              │
    └────────────┴──────── Cloudflare R2 ◄──────┘     (recordings go browser/bot → R2 directly)
```

## 1. Accounts (all have free tiers)
1. **Neon** (or Supabase): create a Postgres project, enable the `vector` extension (the migration does `CREATE EXTENSION`).
   Note both connection strings: *pooled* and *direct*.
2. **Cloudflare R2**: create a bucket (e.g. `milo`) and an API token with read/write on it. Then set the bucket's **CORS policy**
   so browsers can upload and play directly:
   ```json
   [{ "AllowedOrigins": ["https://miloainotetaker.vercel.app"], "AllowedMethods": ["GET", "PUT", "HEAD"],
      "AllowedHeaders": ["Content-Type"], "ExposeHeaders": ["ETag", "Content-Range", "Accept-Ranges"], "MaxAgeSeconds": 3600 }]
   ```
3. **Vercel**: import the GitHub repo. **Root Directory: `apps/web`** (leave "Include source files outside of the Root Directory" on).
   Framework Next.js; the install/build commands are auto-detected for pnpm. Import your untracked `.env.vercel.local` under Settings → Environment Variables (its variable names are listed in `.env.example`).
   Vercel's Hobby plan is for non-commercial use; check its terms for your case.

## 2. Create the database tables (once, from your machine)
```bash
DATABASE_URL="<neon DIRECT url>" pnpm db:migrate
```

## 3. Google sign-in
Google Cloud console → your OAuth client → add redirect URI `https://miloainotetaker.vercel.app/api/auth/callback/google`.
While the consent screen is in "Testing", add each person who will sign in under **Test users**.

## 4. Point the worker and bots at the same services
In the machine's `.env` (never committed):
```
DATABASE_URL=<neon DIRECT url>   STORAGE_PROVIDER=s3   S3_*=<same R2 values>   APP_URL=https://miloainotetaker.vercel.app
EMBED_TOKEN=<same value as in Vercel>
```
Bots: `BOT_WEB_URL=https://miloainotetaker.vercel.app docker compose up -d bot` (same `BOT_TOKEN` as Vercel). They upload recordings straight to R2.

## 5. Search: the embedding service
Vercel can't run the embedding model, so the worker serves it on port 8788 (turned on by `EMBED_TOKEN`). Vercel must be able to
reach it: expose it with a tunnel, e.g. `ngrok http 8788` (or Cloudflare Tunnel), and put that address in Vercel as `EMBED_URL`.
Nobody sees this address. If the machine or tunnel is down, search and Ask quietly fall back to keyword matching.

## What changes for users
- Uploads and bot recordings go directly to R2 (no 4.5 MB request limit). Playback redirects to short-lived signed R2 links.
- Shared clip links work with no sign-in; the signed media link lasts 15 minutes, so a revoked link stops within that time.

## Verified vs not
Tested here: the S3 adapter against a real S3 server (MinIO), the bot's direct upload, the embedding service, the production
build with Vercel-style settings (no native model files in the bundle). **Not tested:** an actual Vercel deployment, Neon, and R2.
Expect to fix small configuration issues on first deploy (CORS and environment variables are the usual ones).

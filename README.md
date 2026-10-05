# Milo.ai

**An AI notetaker that joins your meetings, records them, and turns every call into searchable notes, summaries and action items.**

Live: <https://miloainotetaker.vercel.app>

This document is written in layers. Read as far as you need:

| If you are… | Read | Time |
|---|---|---|
| A stakeholder or decision maker | [Part 1 — Overview](#part-1--overview) | 3 min |
| A product, QA or technical lead | [Part 2 — How it works](#part-2--how-it-works) | 8 min |
| A developer joining the project | [Part 3 — Architecture for developers](#part-3--architecture-for-developers) | 20 min |

---

# Part 1 — Overview

## What Milo does

People spend hours in video meetings and forget what was decided. Milo attends the meeting for you, so nobody has to take notes.

1. **Joins your calls.** Milo connects to your calendar and enters Google Meet, Microsoft Teams and Zoom calls as a visible participant named "Milo AI Notetaker". It announces itself in the meeting chat so everyone knows the call is being recorded.
2. **Records and transcribes.** It captures the video and audio and produces a word-by-word transcript that says who spoke.
3. **Summarises.** Within minutes it writes a summary (in a style you choose: general, sales call, one-to-one, stand-up and others), pulls out action items with owners, and divides the call into chapters.
4. **Lets you find anything.** Search across every meeting, or ask a question in plain language ("What did we agree with the client about pricing?") and get an answer with links to the exact moments in the recordings.
5. **Makes sharing easy.** Save a highlight with one click (or type `/milo highlight` in the meeting chat), turn it into a short clip, and send a link to someone outside your team. They need no account.

## Who it is for

Teams that hold many calls: sales, customer success, product, consulting, recruiting. Anyone who needs a reliable record of what was said without a person writing it down.

## Why it is built the way it is

- **Transparent by design.** Milo is always visible in the meeting and announces itself. It never records secretly.
- **Reliable when things go wrong.** If the bot is blocked from a meeting, you can still upload the recording and get the same notes. If the AI service is busy, playback and transcripts keep working while the summary retries.
- **Low running cost.** It runs on free tiers of its AI and hosting providers, with local and backup options when a free allowance runs out.
- **No waiting on third-party approvals.** It works without app-store or marketplace reviews from Google, Zoom or Microsoft.

## Where the project stands

| Area | Status |
|---|---|
| Sign-in with Google; calendar connection (Google or a pasted calendar link) | Working |
| Meeting bot for Google Meet | Working, verified on real calls |
| Upload a recording → transcript, summary, action items, chapters | Working |
| Playback synced to the transcript; speaker names from live captions | Working |
| Highlights, clips and public share links | Working |
| Search across meetings and "Ask Milo" with cited answers | Working |
| Team calls, playlists, keyword alerts, recap emails, settings | Working (recap email is saved to a file unless an email provider is configured) |
| Meeting bots for Microsoft Teams and Zoom | Built and unit-tested; **not yet verified on live calls** |
| Microsoft sign-in | Built; not yet verified with a real Microsoft account |
| Hosted deployment | Website on Vercel, database on Neon, files on Cloudflare R2 |

**Known limits.** The meeting bots and processing run on one machine that must stay on; there is no automatic failover. The AI providers' free tiers have daily caps, so very heavy use needs a paid plan. Hosts can block bots or guests from a meeting; Milo reports this plainly and never tries to get around it.

---

# Part 2 — How it works

## The system at a glance

Milo has three running parts and three hosted services.

```
                    ┌────────────────────────┐
   Your browser ──► │  Website (web)         │  sign-in, pages, search, sharing
                    │  hosted on Vercel      │
                    └──────────┬─────────────┘
                               │ reads and writes
        ┌──────────────────────┼───────────────────────────┐
        ▼                      ▼                           ▼
┌───────────────┐   ┌──────────────────┐        ┌────────────────────┐
│ Database      │   │ File storage     │        │ AI services        │
│ (Neon         │   │ (Cloudflare R2)  │        │ Gemini, Groq       │
│  Postgres)    │   │ recordings/clips │        │ + a local search   │
└──────▲────────┘   └───────▲──────────┘        │ model              │
       │                    │                    └─────────▲──────────┘
       │      ┌─────────────┴─────────────┐                │
       └──────┤ Worker (processing)       ├────────────────┘
              │ calendar, transcripts,    │
              │ summaries, search index   │
              ├───────────────────────────┤
              │ Meeting bots (Chrome)     │ ──► joins Meet / Teams / Zoom calls
              └───────────────────────────┘
              runs on an always-on machine
```

- **Website** — what people see. It stays up even if the worker or bots are off.
- **Worker** — the back office. It syncs calendars, schedules bots, and turns recordings into transcripts, summaries and a search index.
- **Bots** — each is a real Chrome browser inside a container that attends one meeting at a time.

## What happens to a meeting

```
Calendar event ─► Bot joins & records ─► Upload ─► Processing pipeline ─► Notes ready
                                                       │
                                  prepare media → transcribe → summarise → index for search → email recap
```

1. **Scheduling.** A minute before a meeting that matches the owner's rule ("record all", "only meetings I host", and so on), a join job is created. Pasting a link into "Send Milo to a meeting" does the same for unscheduled calls.
2. **Capture.** The bot joins, waits to be admitted, posts the consent message, and records. While in the call it also watches live captions (to learn who is speaking), the participant list, and the chat (for commands such as `/milo highlight`). It leaves when the call ends, when it is removed, or when it is alone.
3. **Upload.** The recording and a small "sidecar" file of names and timing go straight to storage.
4. **Processing.** Each step runs independently and retries on failure: make the video seekable, transcribe, name the speakers using the sidecar, write the summary and action items, index everything for search, and send the recap email.
5. **Use.** The meeting page shows the player and transcript together, the summary and its templates, action items, highlights and clips.

## Built to keep working when parts fail

| If this fails… | …this still works |
|---|---|
| The AI summary service | Playback, transcript, search. Only the summary panel shows "retrying". |
| The worker machine is off | Browsing, playback, sharing. New recordings wait and are processed when it returns. |
| The bot is blocked from a call | Uploading the recording instead. The failure reason is shown in plain words. |
| Gemini's daily free allowance runs out | A backup provider takes short meetings and questions; speech-to-text can fall back to Whisper. Heavy long meetings wait for the next day. |
| The search-embedding service is unreachable | Search falls back to keyword matching. |

## Privacy and safety

- The bot is visible and announces itself; the announcement text is configurable.
- Clips are shared by unguessable links that can be revoked at any time.
- Recordings are stored in a private bucket and played through short-lived signed links. Nothing is public by default.
- Meetings belong to their owner and are private unless shared with a team.
- Secrets live only in environment variables, never in the repository.

---

# Part 3 — Architecture for developers

## Stack

| Layer | Technology |
|---|---|
| Web app and API | Next.js 15 (App Router, TypeScript), Tailwind CSS, Auth.js |
| Database | Postgres with `pgvector` and built-in full-text search (Drizzle ORM) |
| Job queue | pg-boss (runs on the same Postgres; no Redis) |
| Worker | Node.js process hosting the pipeline and scheduled jobs |
| Bot | Playwright + real Chrome on a virtual display and audio device, ffmpeg capture, in Docker |
| Media | ffmpeg |
| AI | Gemini (summaries, questions, transcription); Groq as opt-in backup; local multilingual-e5-small for embeddings |
| Storage | Local disk in development; S3-compatible (Cloudflare R2) when hosted |
| Hosting | Vercel (web), Neon (database), R2 (files), Docker host (worker, bots) |
| Monorepo | pnpm workspaces |

## Repository layout

```
apps/
  web/        Next.js: pages, server actions, API routes
  worker/     Queue consumer: one handler per pipeline stage, schedules, embedding service
  bot/        Meeting bot: platform adapters, recorder, sidecar collector, upload
packages/
  core/       Shared types, event names, time and meeting-link utilities
  db/         Drizzle schema, migrations, stage-runner (retry/status) helpers
  providers/  External services behind interfaces: storage, speech-to-text, LLM, calendar, email
  modules/    Feature logic: calendar, media, transcription, intelligence,
              indexing, search, sharing, notify, playlists
docs/         Architecture brief, bot operations, deployment, walkthrough
```

### The one rule that keeps it modular
A module may import `core`, `db` and `providers`, **never another module**. Apps (`web`, `worker`) compose modules; `bot` imports only `core` and `providers`. Modules talk to each other through database rows and queue events, so any module can be moved into its own process by changing a start command.

## Processing pipeline

A recording moves through stages connected by events on the queue:

```
recording.uploaded → media → media.ready → transcription → transcript.ready
                                                   ├─► intelligence (summary, actions, chapters)
                                                   └─► indexing (full-text + embeddings) ─► notify (recap, alerts)
```

- Every stage runs inside a common **stage runner** that records `(recording, stage, status, attempts, error)` in the database. The UI reads this table to show per-panel states: empty, processing, ready, failed-with-retry.
- Stages are **idempotent**: running one twice produces the same result, so retries are always safe.
- Errors are classified. *Transient* errors retry with backoff. *Permanent* errors (bad input) and *daily-quota* errors stop retrying so they don't burn the allowance.
- All time-based data is stored in milliseconds from recording start, so the player, transcript, citations, highlights and clips share one clock.

## Providers: swap services without touching features

Each external dependency sits behind a small interface with a real implementation and a **fake** that returns fixtures. With no API keys set, the whole app runs on fakes, which is how most tests run.

| Interface | Real implementations | Notes |
|---|---|---|
| `StorageProvider` | Local disk, S3-compatible | S3 mode adds presigned upload/download URLs |
| `SttProvider` | Gemini audio, Whisper (Groq) | Whisper has no speaker labels |
| `LlmProvider` | Gemini, OpenAI-compatible (Groq) | A fallback wrapper switches providers only on *daily-quota* errors |
| `CalendarProvider` | Google Calendar, ICS feed, Microsoft | ICS needs no OAuth |
| `EmailProvider` | Resend, file "outbox" | Outbox writes HTML files for local use |
| Embeddings | Local model, remote (HTTP to the worker) | Each stored vector records which model made it |

Selection is by environment variable (for example `LLM_PROVIDER=gemini`).

## The meeting bot

- One **adapter per platform** behind a shared interface: `join`, `postConsent`, `sendChat`, `watchSpeakers`, `watchChat`, `watchParticipants`, `detectEnd`, `leave`. Meet, Teams and Zoom each implement it; browser plumbing is shared in a base class.
- **Everything that depends on a platform's page markup lives in one selectors file per platform.** Pages are obfuscated and change without notice, so tuning a platform means editing that file only.
- The bot reports plain failure states (not admitted, denied, guests blocked, captcha, removed) and never tries to defeat a CAPTCHA or bot check.
- A **session orchestrator** owns the lifecycle: join → record → collect sidecar → upload → report. Capture, sidecar and upload are shared by all platforms.
- **Concurrency:** one meeting per container. Run N containers for N concurrent meetings. Containers register a heartbeat so the website can show "bot online".
- The bot uses a dedicated Google account whose signed-in Chrome profile is kept on a volume.

## Search and Ask Milo

- **Hybrid retrieval:** Postgres full-text search plus pgvector similarity, combined with reciprocal-rank fusion.
- **Scope** (my calls, team, all) is one SQL visibility rule applied to every query, so access control is enforced in a single place.
- **Ask** retrieves numbered excerpts, asks the LLM to answer using only those, and renumbers the citations so each link opens the right moment. Threads are saved, and earlier messages are replayed as context.
- If embeddings are unavailable, retrieval silently degrades to keyword-only.

## Data model (core tables)

`users`, `workspaces`, `memberships`, `preferences` · `calendar_connections`, `calendar_events` · `meetings`, `bot_sessions`, `bot_workers` · `recordings`, `pipeline_stage` · `participants`, `speakers`, `transcript_segments` (text, words, tsvector, embedding + model) · `templates`, `summaries`, `action_items` · `highlights`, `clips`, `shares`, `playlists` · `alerts`, `alert_hits` · `ask_threads`, `ask_messages`.

## Hosting topology

```
Vercel ── web (stateless, serverless)          ── Neon Postgres (pooled for web; direct for queue)
                                               ── Cloudflare R2 (recordings; browser/bot upload directly via presigned URLs)
Always-on machine (Docker) ── worker ──────────── same Neon + R2
                           ── bots (scale with --scale bot=N)
                           ── tunnel (ngrok) ──► worker's embedding endpoint, so the website can embed search queries
```

Why this shape: serverless functions have request-size and time limits and no disk, so recordings never pass through them (direct-to-bucket uploads and signed-URL playback), and the embedding model, which cannot fit in a function, is served by the worker over an authenticated HTTPS endpoint. The same code also runs entirely locally with no hosted services.

## Running it

**Locally (no keys needed — fake providers, local disk):**

```bash
pnpm install
cp .env.example .env                 # defaults work for local use
docker compose up -d postgres        # pgvector database (MinIO optional)
pnpm db:migrate
pnpm dev:web                         # http://localhost:3000
pnpm dev:worker                      # in a second terminal
```

Without Google credentials the app signs you in as a built-in development user. To use real services, set the provider variables listed in `.env.example` (Gemini key, Google OAuth, storage, database).

**Always-on machine (worker, bots, tunnel):** see `docs/DEPLOY.md`. **Hosted website:** see `docs/VERCEL.md`. **Bots, sign-in and troubleshooting:** see `docs/bot.md`.

**Tests.** Plain TypeScript scripts, no framework; each prints pass/fail:

```bash
npx tsx --env-file=.env apps/worker/src/pipeline.test.ts <sample.mp4>   # media → transcript → summary on a file, using fakes (scripts/make-sample.sh makes one)
npx tsx --env-file=.env apps/worker/src/search.test.ts       # search, Ask, indexing
npx tsx apps/bot/src/session.test.ts                          # bot lifecycle, no browser
pnpm typecheck                                                # whole monorepo
```

Files ending in `-live.test.ts` and the model-comparison scripts call real AI services and spend free-tier quota; they are marked with a warning at the top.

## Extending it

| To add… | Do this |
|---|---|
| A meeting platform | Implement the bot adapter interface, add a selectors file, register it in the session factory, add it to the supported-platforms list |
| A pipeline stage | Add a module that exports an idempotent function, wrap it in the stage runner, register a queue handler in the worker |
| An AI or storage provider | Implement the provider interface, add a case to provider selection by env var, add a fake if it is new |
| A summary template | Add a row to the templates table (name and prompt) |

## Configuration

One `.env` file configures everything locally and on the worker machine (`.env.example` lists every variable with comments). The hosted website takes the same variable names through Vercel's environment settings. Secrets are never committed.

## Documentation map

| File | Contents |
|---|---|
| `docs/ARCHITECTURE.md` | The design brief: decisions, module table, data model, hour-long-call design |
| `docs/DEPLOY.md` | Running the worker, bots and tunnel on an always-on machine |
| `docs/VERCEL.md` | Hosting the website on Vercel, Neon and R2 |
| `docs/bot.md` | Bot account sign-in, selector tuning, testing without a real meeting |
| `docs/WALKTHROUGH.md` | A guided tour of the product in demo order |

# Milo.ai — architecture brief

## Context

Milo.ai is a rebrand and rebuild of Fathom (AI meeting notetaker), aiming for feature parity with the original and then improving on it. The required loop from the assignment: connect a calendar → get the notetaker into a real meeting → record → playback synced to transcript → AI summary with switchable templates → action items → mid-call highlights → search across meetings → share a clip with an outsider → hold up on an 8-person, 1-hour call.

Decisions already made with the user:

- **A visible bot joins the meeting.** Participants must see they are being recorded. Self-hosted, with safeguards and fallbacks because it will sometimes be blocked. Google Meet and Zoom are both required; Teams follows.
- **LLM is Google Gemini on the free tier** (model ID is a config value; the user intends a Flash model).
- **Google Calendar is core** and is built early.
- **Scope is parity-plus, not a minimal cut.** Work is ordered by priority so the product is demonstrable at every step, but no feature of the original is dropped for deadline reasons alone.
- **No platform verification waits.** Nothing may depend on Google OAuth verification, Zoom Marketplace review or Chrome Web Store review.
- **Fault isolation.** One broken module must not take down the rest.
- **This document is the deliverable.** No code yet.

What `flows/` shows (22 screenshots): sign-up (Google / Microsoft), Google calendar consent, personal-email detection, 3-step preferences ("take notes on X and share with Y" plus a consent checkbox), job-function question, desktop-app download and permissions, the app's settings panel (auto-capture, capture mode, notifications, privacy, consent chat message), the customize page (per-platform status, auto-record and auto-share rules), and an empty home with tabs (My Calls, Team Calls, Playlists, Alerts, Deals), search bar and an "Ask Fathom" panel with a scope picker (My / Team / All calls). The recording page itself was not captured, so it is designed from the assignment brief and public knowledge of the product.

---

## 1. The decisions that shape everything

### 1.1 Capture: a self-hosted bot, isolated in its own service

- **Bot (primary).** A headless Chrome in a container opens the Meet link, joins as **"Milo AI Notetaker"**, asks to be admitted, posts a consent message in chat, and records the call's video and audio. It leaves when the call ends, it is removed, or it is alone.
- **While in the call the bot also reads the page:** live captions give real speaker names with timestamps (used to name diarized speakers), the participant list gives attendance, and the chat gives commands (see highlights).
- **Scheduling.** The calendar module enqueues a join job shortly before each event that matches the user's auto-record rule. "Send Milo to a meeting" (paste a link) covers unscheduled calls.
- **The bot will sometimes be blocked,** and the design assumes it: the host may never admit it, some Workspace orgs refuse guests, Google can flag automation (more often from cloud IPs), and a Meet page change can break the join script.
- **Safeguards:**
  - A **dedicated Google account** for the bot. The user signs it in once by hand; the bot reuses that persistent Chrome profile. Signed-in accounts are refused far less than anonymous guests.
  - **Real Chrome on a virtual display,** not headless mode.
  - The bot never attempts a CAPTCHA or any bot-detection challenge; it reports the block and stops.
  - **Plain failure states** on the meeting ("Host didn't admit Milo", "This meeting doesn't allow guests") with a one-click switch to the browser recorder.
  - Join timeout, and a partial recording is still processed if the bot is removed mid-call.
- **Fallbacks, same pipeline:** an in-browser tab recorder (no bot) and file upload, so a blocked bot never means a lost meeting.
- **Platforms: Google Meet and Zoom are both required; Teams follows.** Each platform is a separate join script behind one interface (`join`, `postConsent`, `watchSpeakers`, `watchChat`, `detectEnd`); recording, sidecar and upload are shared.
  - **Meet:** join by link with the bot's Google account.
  - **Zoom:** join through Zoom's web client by link as a named guest (meeting ID and passcode are parsed from the invite). No Zoom app or Marketplace review. Speaker names come from the active-speaker indicator, since captions depend on the host. Known blocks: host disabled browser joining, "authenticated users only", waiting room never admitted, or Zoom shows a CAPTCHA (the bot stops and reports it).
  - **Teams:** anonymous web join by link; blocked where the tenant disables anonymous join.
- Where it runs: a container with a virtual display and virtual audio device, on a VM or the developer's machine. Not a serverless host.

The bot's only outputs are an uploaded recording, a caption/participant sidecar file, and a `recording.uploaded` event. Nothing downstream knows or cares which capture source produced them.

### 1.2 Services: three processes, modules on queues

True per-feature microservices (own DB, network calls) add plumbing without adding isolation here. The split that buys real isolation:

- **`web`** — UI and API. Stays up if everything else is down.
- **`worker`** — the processing pipeline and scheduled jobs.
- **`bot`** — meeting capture. Heaviest and most fragile, so it is its own container with its own resource limits.

Inside `worker`, each stage is a module on its own queue. Modules communicate only through events and the database, never by calling each other, so any one can be moved to its own process later by changing a start command. Every job is idempotent, retried with backoff, and records per-recording status. A failed summary leaves playback, transcript and search working; the UI shows a retry on that panel only.

### 1.3 Zero-verification integrations

| Risk | How Milo avoids it |
| --- | --- |
| Google OAuth verification (calendar is a sensitive scope) | OAuth app stays in **Testing** mode with named test users. Works immediately. Limits: "unverified app" screen, 100 test users, refresh token expires after 7 days. |
| Calendar still blocked for someone | Paste a calendar's **secret iCal (ICS) URL**. No OAuth. |
| Zoom / Teams app review | Not needed. The bot joins by link as a guest. |
| Chrome Web Store review | Not needed. No extension in the core path. |
| Microsoft sign-in | Azure app registration needs no review for basic sign-in; added in the parity phase. |
| Email sending domain | Recap emails use a transactional provider's sandbox/own-domain setup; sharing by link works without it. |

---

## 2. System shape

```
Browser (Next.js UI)
        │ HTTPS
        ▼
web ── API: auth, CRUD, live-meeting controls, search, ask, share
        │ rows + events
        ▼
Postgres (data · job queue · full-text · vectors)        Object storage (S3-compatible)
        ▲                    ▲                                  ▲
        │                    │                                  │
worker: calendar-sync → media → transcription → intelligence → indexing → notify
bot:    join → consent → record → sidecar (captions, participants, chat) → upload
```

| Concern | Choice | Why |
| --- | --- | --- |
| Web + API | Next.js (App Router, TypeScript), Tailwind, shadcn/ui | One codebase for UI and API |
| Database | Postgres with `pgvector` and built-in full-text search | One store for data, search, vectors and queue |
| ORM | Drizzle | Typed schema, plain SQL when needed |
| Queue | pg-boss (Postgres-backed) | No Redis; retries, backoff, schedules, rate limits |
| Auth | Auth.js: Google (with calendar scope), later Microsoft | Same flow yields the calendar token |
| Storage | S3-compatible adapter: MinIO locally, Cloudflare R2 deployed | Large files, range requests |
| Bot | Playwright + Chromium, virtual display and audio, ffmpeg capture | Free, self-hosted, no vendor |
| Media | ffmpeg in the worker | Seekable mp4, audio extraction, clip cutting |
| Speech-to-text | Deepgram (diarization, word timestamps) behind an adapter; Gemini audio as fallback | Accurate timestamps drive playback sync, clips and highlights; sign-up credit is free |
| LLM + embeddings | Gemini via Google AI Studio key, behind an adapter; model ID in config | Free tier; a 1-hour transcript fits in one request |
| Run | `docker compose up`: postgres, minio, web, worker, bot | Whole product on one machine or VM |

Free-tier consequences designed in: LLM jobs are throttled by the queue to stay under per-minute and per-day caps; every summary is cached per template; the walkthrough notes that free-tier content may be used by Google.

Every provider (calendar, storage, STT, LLM, email, capture) has an interface, a real implementation and a **fake** one returning fixtures, so the UI can be built before keys exist and the demo survives a provider outage.

---

## 3. Modules

| # | Module | Process | Responsibility | If it breaks |
| --- | --- | --- | --- | --- |
| 1 | identity | web | Sign-in, session, onboarding, preferences, workspace membership | App unreachable; kept smallest |
| 2 | calendar | worker + web | Sync events (Google, ICS), parse meeting links and attendees, apply auto-record rule, schedule bot joins | Home shows last synced events and a warning; manual "send Milo" still works |
| 3 | bot | bot | Join, consent message, record, sidecar, upload | Meeting marked "bot couldn't join" with reason; browser recorder and upload still work |
| 4 | capture-alt | web (browser) | Tab recorder and file upload | Bot path unaffected |
| 5 | media | worker | Seekable mp4, audio extract, poster, duration, clip cuts | "Processing failed — retry"; raw file kept |
| 6 | transcription | worker | Diarized, word-timed transcript; merge speaker names from sidecar | Playback works; transcript panel shows retry |
| 7 | intelligence | worker + web (streaming) | Summary per template, action items, chapters, topics | Transcript, playback, search still work |
| 8 | indexing | worker | Full-text vectors and embeddings | Search degrades to titles and attendees |
| 9 | search & ask | web | Cross-meeting search; Ask Milo with timestamp citations; scope picker | Rest of app unaffected |
| 10 | sharing | web + media | Clips, public links, viewer page, playlists | Private app unaffected |
| 11 | notify | worker | Recap email to owner/attendees per auto-share rule; keyword alerts | Nothing else affected |

Events in order: `bot.join.requested` → `recording.uploaded` → `media.ready` → `transcript.ready` → (`insights.ready`, `index.ready`) → `recap.sent`. A `pipeline_stage` table holds `(recording_id, stage, status, attempts, error)` and drives per-panel UI states.

---

## 4. Data model (core tables)

- `users`, `workspaces`, `memberships`, `preferences` (auto-record rule, auto-share rule, default template, role, consent message on/off)
- `calendar_connections` (google | ics), `calendar_events` (title, times, attendees, meeting_url, platform, record decision)
- `meetings` (owner, workspace, calendar_event_id nullable, title, started_at, status, capture_source: bot | browser | upload)
- `bot_sessions` (meeting_id, state: scheduled | joining | waiting_room | recording | left | failed, reason, started_at)
- `recordings` (meeting_id, storage keys for raw / playable / audio, duration)
- `participants` (meeting_id, name, email nullable, joined/left), `speakers` (meeting_id, diarization label, participant_id, talk_time_ms)
- `transcript_segments` (meeting_id, speaker_id, start_ms, end_ms, text, words jsonb, tsvector, embedding)
- `templates` (built-in + custom), `summaries` (meeting_id, template_id, content with timestamp citations)
- `action_items` (meeting_id, text, assignee, due, done, source_ms)
- `highlights` (meeting_id, start_ms, end_ms, note, created_by, source: live_button | chat_command | after)
- `clips` (meeting_id, start_ms, end_ms, title, storage key), `shares` (token, target, expires_at, views), `playlists`, `playlist_items`
- `alerts` (workspace, keyword/topic rule), `alert_hits`
- `ask_threads`, `ask_messages` (with cited segment ids)
- `pipeline_stage`

All time-based data is in milliseconds from recording start, so player, transcript, citations, highlights and clips share one clock. The bot records its own start time, which is what makes live highlights land correctly.

---

## 5. The assignment's journey, mapped

| Step | What Milo does |
| --- | --- |
| Connect a calendar | Onboarding step 2: Google, or paste an ICS link. Home lists upcoming meetings with platform icon and a per-event record toggle. |
| Notetaker into a real meeting | At start time the bot asks to join as "Milo AI Notetaker". Home shows its live state (joining, waiting to be admitted, recording). A consent message appears in the meeting chat. |
| Let it record | Bot records until the call ends. The live meeting page in Milo shows a timer, participants and a Highlight button. |
| Playback against transcript | Player left, transcript right. Active line follows playback; click a line to seek; speaker colours; speed control; chapters on the scrub bar. |
| Summary, switch templates | Template picker (General, Sales discovery, 1:1, Standup, Customer call, User interview, Chronological, custom prompt). First view streams; later views are cached. Every bullet has a timestamp chip that seeks the player. |
| Action items | Text, owner, checkbox, jump-to-moment, copy as Markdown, grouped by owner. |
| Highlight mid-call | Highlight button on Milo's live page, **or anyone types `/milo highlight` in the meeting chat**. It marks the previous 30 seconds. Highlights show as scrub-bar markers and a list, each one click from a clip. |
| Search across meetings | Global search: hits with snippet, speaker, timestamp, grouped by meeting, landing on the exact moment. Ask Milo answers across meetings with citations. |
| Share a clip with an outsider | Select transcript text or drag a range → Create clip → public link. Viewer needs no account: clip, its transcript, a short recap. Revocable. |
| 8 people, 1 hour | Section 6. |

---

## 6. The hour-long, eight-person call

- **Capture:** bot records at a capped bitrate (720p, ~700 kbps), about 300–350 MB per hour; file is written locally in the container and uploaded in parts.
- **Media:** stream-copy remux to a seekable mp4 (seconds, not a re-encode); a ~30 MB audio-only file goes to STT. Playback uses range requests from storage.
- **Speakers:** diarization gives 8 voice tracks; the bot's caption sidecar says who was speaking when, so tracks are named automatically. One rename dialog fixes any miss and applies everywhere.
- **Transcript:** roughly 9–10k words, 600–900 segments; the list is virtualised.
- **Intelligence:** whole transcript in one LLM call, structured output: chapters, summary, action items with owner and source timestamp.
- **Navigation:** chapters, speaker filter, in-meeting find, talk-time bar per speaker, action items grouped by owner.
- **Status:** per-stage progress on the meeting page; the player is usable before the summary lands.

A long multi-speaker recording is loaded through the upload path at the start of the build so every screen is designed against this case.

---

## 7. Parity with Fathom, and where Milo goes further

**Parity (built):** Google sign-in; onboarding (calendar, record/share preferences, consent acknowledgement, job function); home with My Calls, Team Calls, Playlists, Alerts; search; Ask panel with My/Team/All scope; meeting page; templates; action items; highlights; clips and sharing; auto-record and auto-share rules; consent chat message; settings and customize pages; recap email; Microsoft sign-in; Zoom and Teams via the bot.

**Replaced:** the desktop app and Chrome extension are replaced by the bot plus the browser recorder. Milo is web-only.

**Deferred, named in the walkthrough:** Deals / CRM sync, real-time coaching, billing, referral, Slack huddles.

**Beyond Fathom:**

1. Evidence-linked output: every summary line and action item links to its moment.
2. Retroactive highlight: one press saves the last 30 seconds.
3. Highlight from the meeting chat, by anyone on the call.
4. Automatic speaker naming from captions, not guesswork.
5. Per-person view for big calls: commitments and talk-time balance.
6. Catch-up share page: a clip carries its own recap for someone who wasn't there.
7. Graceful capture: bot, browser recorder and upload feed one pipeline, so a blocked bot never means a lost meeting.

---

## 8. UX and brand

- Milo is its own brand: own name, mark, colour, type and copy. No Fathom assets or wording; the flows are a reference for behaviour.
- Dark and light themes from design tokens; one accent colour; dense, calm meeting page.
- Every async panel has four designed states: empty, processing (stage named), ready, failed-with-retry.
- Bot state is always visible and plainly worded ("Waiting for the host to let Milo in").
- Empty home is never blank: upcoming meetings, "Send Milo to a meeting", "Upload a recording", and a sample meeting.

---

## 9. Repository skeleton

```
milo-ai/
  apps/
    web/        Next.js: routes, UI, API handlers
                app/(auth) (onboarding) (app)/home meetings/[id] live/[id]
                    search playlists alerts settings share/[token]
    worker/     pg-boss process; registers one handler per module
    bot/        Playwright runner; platforms/meet (then zoom, teams); recorder; sidecar
  packages/
    db/         Drizzle schema, migrations, seed
    core/       event names, job contracts, shared types, time utils
    modules/    calendar/ media/ transcription/ intelligence/ indexing/
                search/ sharing/ notify/
    providers/  storage, stt, llm, calendar, email — each: interface + real + fake
    ui/         design tokens, shared components
  docker-compose.yml     postgres(pgvector), minio, web, worker, bot
  docs/ARCHITECTURE.md   this brief, committed
  .agent-logs/  CAPTURE-TEST.md  .claude/   (already in place)
```

Rule that keeps modules independent: a module may import `core`, `db` and `providers`, never another module. `bot` imports only `core` and `providers`.

---

## 10. Build order

Each step ends with something demonstrable.

| # | Step | Outcome |
| --- | --- | --- |
| 0 | Skeleton | Monorepo, compose, schema, fake providers, design tokens, app shell; this brief committed to `docs/ARCHITECTURE.md` |
| 1 | Sign-in + Google Calendar + onboarding | Real upcoming meetings on home (Testing-mode OAuth, ICS fallback) |
| 2 | Upload → pipeline → meeting page | Long sample recording: playback synced to transcript |
| 3 | Intelligence | Summary, templates, action items, chapters (Gemini) |
| 4 | Meet bot | Bot joins a real Meet, posts consent, records, names speakers; scheduled from calendar |
| 5 | Zoom bot | Same bot joins a real Zoom call by link, posts consent, records, names speakers |
| 6 | Live page + highlights | Highlight by button and by chat command, on Meet and Zoom |
| 7 | Clips + share page | Public clip opened logged-out |
| 8 | Search + Ask Milo | Cross-meeting search and cited answers |
| 9 | Parity | Team Calls, Playlists, Alerts, auto-share recap email, settings/customize pages, Microsoft sign-in |
| 10 | Teams join script | Bot on a third platform |
| 11 | Polish + deploy | States, dark/light, hosted on a VM, walkthrough notes |

The bot comes after the pipeline on purpose: it needs somewhere to deliver a recording, and the upload path lets everything downstream be built and judged without waiting on the most fragile piece. If the bot stalls, the browser recorder is the working capture path while it is fixed.

---

## 11. Verification (once built)

1. `docker compose up`; sign in; finish onboarding; home shows real upcoming events (Google test user, then ICS).
2. (Repeat this step on a Zoom call.) Schedule a Google Meet; at start time the bot asks to join; admit it; the consent message appears in chat; talk for two minutes; type `/milo highlight`; end the call. The meeting appears and moves through each stage.
3. Meeting page: play and confirm the transcript follows; click a line to seek; speakers carry real names; switch three templates; tick an action item and jump to its source.
4. The highlight covers the 30 s before the command; turn it into a clip; open the link in a private window with no session.
5. Upload the 1-hour, 8-speaker sample: 8 speakers, rename applies everywhere, transcript scrolls smoothly, chapters and per-person action items present.
6. Search a phrase present in two meetings; both hits land on the right timestamp. Ask Milo a cross-meeting question; citations open the right moments.
7. Fault isolation: stop `bot` — web and pipeline work, upload still records a meeting. Stop `worker` — web still browses, plays and searches. Force the LLM to fail — summary panel shows retry while transcript and playback work.
8. Bot failure paths: host never admits (times out with a clear status), bot removed mid-call (partial recording still processed).
9. Capture log check: `.agent-logs/` has an entry for every prompt in the build.

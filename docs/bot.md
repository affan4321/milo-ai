# Milo meeting bot — setup and operations

The bot is a real Chrome running on a virtual display inside a Linux container. It joins a Google Meet as **"Milo AI Notetaker"**,
posts a consent message in the chat, records the call's video and audio with ffmpeg, and hands the recording plus a sidecar
(captions, participants, chat) to the web app, which runs the normal pipeline.

## 1. One-time: sign in the bot's Google account

Signed-in accounts are refused by Meet far less often than anonymous guests, so the bot uses a **dedicated Google account**
(not yours). Create one, e.g. `milo.notetaker@gmail.com`. Milo never sees its password: you sign in by hand, and the session is
kept in the `botprofile` Docker volume.

```bash
# 1. build and start the login session (opens a browser inside the container, reachable over VNC on localhost only)
export BOT_VNC_PASSWORD=choose-something
docker compose build bot
docker compose run --rm --service-ports -e BOT_VNC_PASSWORD bot login
```

2. Connect a VNC client to `localhost:5900` (macOS: Finder → Go → Connect to Server → `vnc://localhost:5900`).
3. In the browser window that appears, sign in to the bot account. Set the account's **display name to `Milo AI Notetaker`**
   (Google Account → Personal info → Name) so participants see that name in the call.
4. Close the browser window. The profile is saved; the `login` command exits.

Google may ask for a phone number or show "unusual activity" the first time a new account signs in from a datacenter-like
environment. Complete it in the same VNC session. If it keeps blocking, sign in once from a normal browser on the same
network first, then retry.

## 2. Run the bot

The bot needs the web app reachable from the container and a shared `BOT_TOKEN` (already in `.env`):

```bash
BOT_WEB_URL=http://host.docker.internal:3000 docker compose up -d bot
docker compose logs -f bot
```

It takes one meeting at a time (one display, one audio sink). Run more containers for parallel meetings.

## 3. How a meeting gets a bot

- **Scheduled:** the worker checks the calendar every minute and sends a join job for meetings that match the owner's
  auto-record rule, starting 90 seconds before the meeting. Each event has a "Milo will record" toggle on Home.
- **On demand:** Home → "Send Milo to a meeting", paste a Meet link.

Home and the meeting page show the bot's state in plain words: joining, waiting for the host to let it in, recording, left,
or why it failed ("The host never let Milo in", "This meeting doesn't allow guests", …).

## 4. When it can't join

The bot never tries to solve a CAPTCHA or bypass a bot check: it reports the block and stops. Nothing is recorded, and the
meeting page offers uploading a recording instead. Failure reasons: host never admitted, request denied, guests blocked,
CAPTCHA, sign-in required, bad link, removed early.

If the bot is removed mid-call, whatever was recorded so far is still processed.

## 5. Tuning against real Meet

Meet's page is obfuscated and changes without notice, so everything that depends on it is in one file:
`apps/bot/src/platforms/meet-selectors.ts`. **These selectors were verified against a mock Meet page, not a live call.**
On the first real call:

```bash
BOT_DEBUG=1 docker compose up -d bot      # saves a screenshot + accessibility snapshot at each stage
docker compose cp bot:/data/debug ./bot-debug
```

Open the `.png`/`.aria.txt` files from the stage that went wrong and adjust the selectors or phrases. A dev override mounts
your working copy so edits apply without rebuilding:

```bash
docker compose -f docker-compose.yml -f docker-compose.bot-dev.yml up -d --force-recreate bot
```

## 6. Testing without a real Meet

```bash
MOCK_AUDIO=/path/to/speech.m4a node apps/bot/test/mock-meet/server.mjs 8801     # a scriptable fake meeting
npx tsx apps/bot/src/session.test.ts                                              # orchestrator logic, no browser
npx tsx --env-file=.env apps/worker/src/bot-e2e.test.ts                           # real bot container end to end
```

The end-to-end test needs Postgres, the web app (`BOT_TOKEN` set), a worker with fake providers
(`STT_PROVIDER=fake LLM_PROVIDER=fake`), and the bot container started with `BOT_WEB_URL` pointing at the web app and a short
`BOT_JOIN_TIMEOUT_MS` (e.g. 25000).

## Known limits

- Selectors are unverified against live Meet (see §5).
- Chrome for Linux is x86-64 only; on an ARM host the container falls back to Chromium, which Meet may treat differently.
- Hosts can block bots or guests; that is reported, not worked around.
- One meeting per container.
- Zoom and Teams join scripts are not written yet (the adapter interface is shared).

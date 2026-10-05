# Running Milo for real: what runs where

| Piece | Where | Why |
|---|---|---|
| Website | Vercel (`https://miloainotetaker.vercel.app`) | always on, free |
| Database | Neon | hosted Postgres |
| Recordings and clips | Cloudflare R2 | hosted storage |
| **Worker, meeting bots, tunnel** | **an always-on machine** | long-running; needs Chrome, ffmpeg and a constant process |

The first three are hosted (docs/VERCEL.md). The last row is the only thing that must stay running on a machine. If that
machine is your laptop, processing and bots stop when it sleeps. Put it on a small always-on server instead:

## 1. The server
Any Linux x86-64 VM with Docker and the Compose plugin, ~2 vCPU / 4 GB RAM for the worker plus one or two bots (about 1 core and
1 GB per concurrent meeting, plus ~1 GB for the embedding model). Outbound internet only; **no inbound ports** are needed
(the tunnel dials out). Prefer x86: Chrome for Linux has no ARM build, so on ARM the bot falls back to Chromium, which Meet may treat differently.

## 2. Set up
```bash
git clone <repo> && cd milo-ai
# .env on the server: copy the one from your laptop, plus two lines for the tunnel:
#   NGROK_AUTHTOKEN=<from dashboard.ngrok.com>     NGROK_DOMAIN=<your-domain>.ngrok-free.app
docker compose -f docker-compose.vm.yml up -d --build
docker compose -f docker-compose.vm.yml ps            # worker should become "healthy"
```
Everything restarts by itself after a crash or reboot (`restart: unless-stopped`; enable Docker at boot with `systemctl enable docker`).
Stop the copies on your laptop, so two workers don't compete for the same jobs.

## 3. Sign the bot in (once, on the server)
`docker compose -f docker-compose.vm.yml run --rm --service-ports bot-login`, then follow docs/bot.md §1 (VNC over an SSH tunnel:
`ssh -L 5900:localhost:5900 user@server`). Then `docker compose -f docker-compose.vm.yml up -d --scale bot=2 bot`.

## 4. Updating
`git pull && docker compose -f docker-compose.vm.yml up -d --build`. The website redeploys itself when you push to GitHub.

## 5. Checks
- `docker compose -f docker-compose.vm.yml logs -f worker bot tunnel`
- `https://<NGROK_DOMAIN>/health` returns `{"ok":true}`.
- `https://miloainotetaker.vercel.app/api/health` returns `{"ok":true}` (website can reach the database).
- Nothing summarised? Look for "quota" in the worker log: Gemini's free tier is limited per day.

## Backups
Neon keeps point-in-time history on its own plan; R2 holds the recordings. The server itself holds nothing irreplaceable
except the bot's signed-in profile (`botprofile` volume), which is a one-minute re-login if lost.

## Known limits
One server, no failover. Zoom and Teams selectors are unverified against live calls. Email defaults to files in `/data/outbox`; set `EMAIL_PROVIDER=resend` for real delivery.

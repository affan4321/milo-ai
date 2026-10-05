# Deploying Milo on one VM

One machine runs everything: Postgres, web, worker, meeting bots and an HTTPS proxy. A 4 vCPU / 8 GB VM handles the app plus
two or three concurrent meetings (each bot needs about 1 core and 1 GB). Recordings and the search model live on a disk volume,
so size the disk for your recordings (about 0.5–1 GB per meeting-hour).

## 1. Prepare
1. A Linux VM with Docker and the Compose plugin, ports 80 and 443 open, and a DNS name pointing at it.
2. `git clone` the repo, then fill in `.env` (see the VM section of `.env.example`). Generate every secret with
   `openssl rand`. This file is never committed.
3. Google sign-in: in the Google Cloud console add `https://<your-domain>/api/auth/callback/google` as an authorised redirect URI.
   (Microsoft: `https://<your-domain>/api/auth/callback/microsoft-entra-id`.)

## 2. Start
```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
docker compose -f docker-compose.prod.yml ps          # web should become "healthy"
```
Database migrations run automatically before web and worker start. Open `https://<your-domain>`.

## 3. Sign the bot in (once)
Follow docs/bot.md §1, using the production compose file and its `botprofile` volume. Then scale bots:
`docker compose -f docker-compose.prod.yml --env-file .env up -d --scale bot=3 bot`.

## 4. Updating
```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```
A recording in progress is uploaded by the bot when the call ends, so restart bots between meetings.

## 5. Backups
- Database: `docker compose -f docker-compose.prod.yml exec postgres pg_dump -U milo milo | gzip > milo-$(date +%F).sql.gz`
- Recordings: the `appdata` volume (`/data/storage`). The search model in `/data/models` re-downloads if lost.
Do both on a schedule (cron) and copy them off the machine.

## 6. Troubleshooting
- `docker compose ... logs -f web worker bot`
- `GET /api/health` returns `{"ok":true}` when web can reach the database.
- Nothing summarised? Look at the worker log for "quota": Gemini's free tier is limited per day; set `GROQ_API_KEY` and
  `LLM_FALLBACK_PROVIDER=groq` for short meetings, or enable billing.

## Known limits
- Storage is the local disk volume (`STORAGE_PROVIDER=local`). The S3 variables in `.env.example` are reserved; an S3 adapter is not built.
- One VM, no high availability. Postgres and the volumes are the state worth backing up.
- Email defaults to files in `/data/outbox`. Set `EMAIL_PROVIDER=resend` for real delivery (verified only against a mock).
- Zoom and Teams selectors are unverified against live calls.

# Meeting bot: real Chrome on a virtual display + virtual audio device, recorded with ffmpeg.
# Build from the repo root:  docker compose build bot
FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb x11vnc x11-utils pulseaudio pulseaudio-utils ffmpeg dbus-x11 xauth procps ca-certificates curl fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
# Chrome refuses to run as root, so everything runs as the image's built-in non-root "node" user (uid 1000).
RUN corepack enable && mkdir -p /app /profile /data && chown -R node:node /app /profile /data
WORKDIR /app
COPY --chown=node:node . .
USER root
RUN pnpm install --frozen-lockfile --filter @milo/bot... \
    && pnpm --filter @milo/bot exec playwright-core install --with-deps chrome \
    && chown -R node:node /app
# Xvfb (running as non-root) needs this directory to exist already.
USER root
RUN mkdir -p /tmp/.X11-unix /work && chmod 1777 /tmp/.X11-unix && chown node:node /work
USER node
ENV BOT_PROFILE_DIR=/profile BOT_DATA_DIR=/data DISPLAY=:99 XDG_RUNTIME_DIR=/tmp/runtime-bot
VOLUME ["/profile", "/data"]
ENTRYPOINT ["/app/apps/bot/entrypoint.sh"]
CMD ["run"]

# Web app and worker share one image (they share the workspace packages); compose picks the command.
#   docker build -t milo-ai-app .
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# The build needs no secrets: every external service is read at runtime.
RUN pnpm --filter @milo/web build
ENV NODE_ENV=production STORAGE_DIR=/data/storage OUTBOX_DIR=/data/outbox MODEL_CACHE_DIR=/data/models
RUN mkdir -p /data && chown -R node:node /data /app
USER node
# Fetch pnpm now so containers never download it at start-up.
RUN corepack prepare pnpm@10.30.3 --activate
VOLUME ["/data"]
EXPOSE 3000
CMD ["pnpm", "--filter", "@milo/web", "exec", "next", "start", "-p", "3000"]

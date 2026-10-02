# syntax=docker/dockerfile:1.7
# The builder runs once, on the build machine's own architecture, and every
# target image copies from it, so nothing is built under emulation.
FROM --platform=$BUILDPLATFORM node:24.11.1-alpine AS builder
WORKDIR /app
RUN corepack enable
# Copy the whole repo: copying only some workspace package.json files trips
# yarn's --immutable check (root package.json lists test/fixtures/* workspaces
# that a partial copy would prune from the lockfile).
# .dockerignore filters out node_modules, .next, .turbo, etc.
COPY . .
# Installs the native packages (esbuild) for both image architectures.
RUN yarn config set supportedArchitectures --json '{"os":["linux"],"cpu":["x64","arm64"],"libc":["musl"]}' \
 && yarn install --immutable
RUN yarn turbo run build --filter=@scoutui/web-app
# Moves each architecture's native packages (named *-x64 or *-arm64) out of the
# standalone output into /native/<architecture>, so each image copies in only
# its own.
RUN cd apps/web-app/.next/standalone \
 && mkdir -p /native/amd64 /native/arm64 \
 && for pair in x64:amd64 arm64:arm64; do \
      find node_modules -mindepth 1 -maxdepth 2 -type d -name "*-${pair%%:*}" -prune \
        -exec sh -c 'mkdir -p "$1/$(dirname "$2")" && mv "$2" "$1/$2"' _ "/native/${pair#*:}" {} \; ; \
    done

FROM node:24.11.1-alpine AS runner
ARG TARGETARCH
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# The server applies pending migrations from here at start.
ENV SCOUTUI_MIGRATIONS_DIR=/app/apps/web-app/drizzle/migrations
COPY --from=builder --chown=node:node /app/apps/web-app/.next/standalone ./
COPY --from=builder --chown=node:node /native/${TARGETARCH} ./
COPY --from=builder --chown=node:node /app/apps/web-app/.next/static ./apps/web-app/.next/static
COPY --from=builder --chown=node:node /app/apps/web-app/drizzle ./apps/web-app/drizzle
COPY --from=builder --chown=node:node /app/apps/web-app/dist/worker.cjs ./apps/web-app/worker.cjs
USER 1000:1000
EXPOSE 3000
CMD ["node", "apps/web-app/server.js"]

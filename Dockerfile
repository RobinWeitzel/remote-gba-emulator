# syntax=docker/dockerfile:1.7

# Play-Together GBA — production image.
#
# Multi-stage build:
#   1. builder: installs all workspace deps and runs `npm run build`
#      (Vite → /client/dist + tsc typecheck of /server). Then prunes
#      devDependencies so node_modules contains only runtime packages.
#   2. runtime: minimal Alpine image with Node 22 and curl (for the
#      HEALTHCHECK). Copies the pruned node_modules, built client, and
#      server/shared TS sources. The server runs via `tsx`, which is a
#      runtime dependency of @gba/server (not a devDep), so no compile
#      step is needed at runtime.

# -------------------- Builder --------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Copy workspace manifests first so dependency installation is layer-cached.
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY shared/package.json ./shared/

# Install everything (dev + prod) so we can run the build.
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Copy the rest of the source.
COPY . .

# Commit SHA stamped into the client build for the footer version display.
# CI passes `github.sha`; local `docker build` callers can override via
# `--build-arg GIT_SHA=...`. Defaults to "docker" when neither is set.
ARG GIT_SHA=docker
ENV GIT_SHA=$GIT_SHA

# Build the client and typecheck the server.
RUN npm run build

# Prune devDeps so the runtime stage gets a slim node_modules tree.
RUN npm prune --omit=dev

# -------------------- Runtime --------------------
FROM node:22-alpine AS runtime

# curl for HEALTHCHECK; otherwise Alpine is minimal.
RUN apk add --no-cache curl

# Non-root user (node:22-alpine already has the `node` user).
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

# Workspace manifests (npm needs these at runtime to resolve workspaces).
COPY --chown=node:node --from=builder /app/package.json /app/package-lock.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules

COPY --chown=node:node --from=builder /app/shared/package.json ./shared/
COPY --chown=node:node --from=builder /app/shared/src ./shared/src

COPY --chown=node:node --from=builder /app/server/package.json ./server/
COPY --chown=node:node --from=builder /app/server/tsconfig.json ./server/
COPY --chown=node:node --from=builder /app/server/src ./server/src

# Test ROM ships in the image so a fresh container has something to play
# with. Real ROMs are added via a bind mount over /app/server/roms.
COPY --chown=node:node --from=builder /app/server/roms ./server/roms

# Persistent save data lives under /app/server/data. Pre-create it so the
# directory exists when bind-mounted with an empty host directory.
RUN mkdir -p /app/server/data/saves && chown -R node:node /app/server/data

# Vite-built client; /client/public/* (incl. the vendored mGBA WASM core)
# is copied verbatim into /client/dist/ during the build.
COPY --chown=node:node --from=builder /app/client/package.json ./client/
COPY --chown=node:node --from=builder /app/client/dist ./client/dist

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/api/roms > /dev/null || exit 1

CMD ["npm", "start"]

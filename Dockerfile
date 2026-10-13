# SideBro AI — single image: NestJS backend that also serves the built React client on one port.

# ---------------------------------------------
# Build Stage (client + server)
# ---------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Electron is a root devDependency for the desktop shell only; skip its binary download
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

# Copy workspace manifests first so the dependency layer is cached between code changes
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN npm ci

# package-lock.json was generated on macOS and only lists the darwin native binaries of rollup
# and esbuild (npm/cli#4828). Install the Linux binaries matching the locked versions.
RUN set -e; \
  ARCH=$(node -p "process.arch"); \
  ROLLUP_V=$(node -p "require('./client/node_modules/rollup/package.json').version"); \
  ESBUILD_V=$(node -p "require('./client/node_modules/esbuild/package.json').version"); \
  mkdir -p /tmp/native && cd /tmp/native && npm init -y >/dev/null; \
  npm install --no-save --no-package-lock --force \
    "@rollup/rollup-linux-${ARCH}-musl@${ROLLUP_V}" "@esbuild/linux-${ARCH}@${ESBUILD_V}"; \
  mkdir -p /app/client/node_modules/@rollup /app/client/node_modules/@esbuild; \
  cp -R node_modules/@rollup/* /app/client/node_modules/@rollup/; \
  cp -R node_modules/@esbuild/* /app/client/node_modules/@esbuild/; \
  rm -rf /tmp/native

# Copy sources (client imports the shared type definitions)
COPY shared ./shared
COPY server ./server
COPY client ./client

# Build NestJS into server/dist and Vite assets into client/dist
RUN npm run build

# ---------------------------------------------
# Production Runtime Stage
# ---------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0
# SQLite lives in the mounted volume below
ENV DATA_DIR=/app/server/data

# Install server production dependencies only
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN npm ci --omit=dev --workspace=server && npm cache clean --force

# Compiled backend + static client (served by the backend from ../../client/dist)
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist

RUN mkdir -p /app/server/data && chown -R node:node /app/server/data
USER node

VOLUME ["/app/server/data"]

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1

WORKDIR /app/server
CMD ["node", "dist/main.js"]

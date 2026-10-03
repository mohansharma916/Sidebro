FROM node:22-alpine AS builder

WORKDIR /app

# Copy root workspace configurations
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/

# Install dependencies for building
RUN npm install

# Copy server source code and config
COPY server ./server

# Build NestJS TypeScript artifacts into server/dist
RUN npm run build --workspace=server

# ---------------------------------------------
# Production Runtime Stage
# ---------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Copy package manifests
COPY package*.json ./
COPY server/package*.json ./server/

# Install production dependencies
RUN npm install --omit=dev --workspace=server

# Copy compiled JavaScript distribution
COPY --from=builder /app/server/dist ./server/dist

# Ensure SQLite storage directory exists
RUN mkdir -p /app/server/data

VOLUME ["/app/server/data"]

EXPOSE 3001

WORKDIR /app/server
CMD ["node", "dist/main.js"]

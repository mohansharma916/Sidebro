FROM node:22-alpine AS builder

WORKDIR /app

# Copy root workspace configurations
COPY package*.json ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/

# Install build dependencies
RUN npm install

# Copy client source code
COPY client ./client

# Build Vite static assets
RUN npm run build --workspace=client

# ---------------------------------------------
# Production Web Server Stage (Nginx)
# ---------------------------------------------
FROM nginx:alpine AS runner

COPY --from=builder /app/client/dist /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

# ENotebook Server Dockerfile
# Multi-stage build for optimized production image

# ============================================
# Stage 1: Build stage
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (bcrypt, etc.)
RUN apk add --no-cache python3 make g++ 

# Copy workspace root files
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./

# Copy workspace package definitions
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/

# Note: node-adodb is Windows-only (for MS Access imports) - moved to optionalDependencies
# The server handles this gracefully with a fallback error message
RUN npm install --ignore-scripts

# Copy source code
COPY packages/shared/ ./packages/shared/
COPY apps/server/ ./apps/server/

# Build shared package
WORKDIR /app/packages/shared
RUN npm run build

# Generate Prisma client and build server
WORKDIR /app/apps/server
RUN npx prisma generate
RUN npm run build

# ============================================
# Stage 2: Production stage
# ============================================
FROM node:20-alpine AS production

WORKDIR /app

# Install runtime dependencies for native modules and puppeteer
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    python3

# Set Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy workspace root files
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./

# Copy package definitions
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/

# Install production dependencies only (skip optional Windows-only packages)
RUN npm install --omit=dev --ignore-scripts

# Rebuild native modules for production (bcrypt)
RUN npm rebuild bcrypt --build-from-source || true

# Copy built artifacts from builder stage
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/node_modules/.prisma ./apps/server/node_modules/.prisma

# Copy Prisma schema for migrations
COPY apps/server/prisma ./apps/server/prisma

# Copy entrypoint script
COPY apps/server/docker-entrypoint.sh ./apps/server/docker-entrypoint.sh
RUN chmod +x /app/apps/server/docker-entrypoint.sh

# Create data directories
RUN mkdir -p /app/apps/server/data/attachments \
    /app/apps/server/data/imports \
    /app/apps/server/data/inventory_attachments \
    /app/apps/server/data/reports \
    /app/apps/server/data/sync \
    /app/apps/server/logs

WORKDIR /app/apps/server

# Expose the server port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4000/readyz || exit 1

# Start the server via entrypoint
CMD ["/app/apps/server/docker-entrypoint.sh"]

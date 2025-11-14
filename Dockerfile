# ============================================================================
# Multi-stage Dockerfile optimized for Raspberry Pi 5 (ARM64)
# ============================================================================

# ============================================================================
# Stage 1: Build TypeScript
# ============================================================================
FROM node:20-alpine AS builder

WORKDIR /build

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# ============================================================================
# Stage 2: Production runtime
# ============================================================================
FROM node:20-alpine AS runtime

# Install wget for healthcheck
RUN apk add --no-cache wget

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev && \
    npm cache clean --force

# Copy compiled code from builder
COPY --from=builder /build/dist ./dist

# Copy templates (needed at runtime)
COPY src/templates ./dist/templates

# Copy static files
COPY public ./public

# Copy version information (generated before build)
COPY VERSION ./dist/VERSION

# Create cache directory with proper permissions
RUN mkdir -p /app/.cache && \
    chown -R node:node /app

# Switch to non-root user for security
USER node

# Expose port (internal to container)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/about || exit 1

# Start application
CMD ["node", "dist/api-server.js"]

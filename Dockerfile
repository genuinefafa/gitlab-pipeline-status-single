# ============================================================================
# Dockerfile — Bun runtime (multi-arch: arm64 + amd64)
# ============================================================================

FROM oven/bun:1-alpine

# wget viene con busybox en alpine — necesario para healthcheck
WORKDIR /app

# Instalar dependencias (copiar lock primero para cache de layers)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copiar código fuente y archivos estáticos
COPY src/ ./src/
COPY public/ ./public/
COPY tsconfig.json ./

# Info de versión inyectada al build
ARG APP_VERSION=dev
ARG APP_COMMIT=local
ARG APP_BUILD_DATE=unknown
ENV APP_VERSION=${APP_VERSION} \
    APP_COMMIT=${APP_COMMIT} \
    APP_BUILD_DATE=${APP_BUILD_DATE}

# Cache directory
RUN mkdir -p /app/.cache && \
    chown -R bun:bun /app

USER bun

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/version || exit 1

CMD ["bun", "run", "src/index.ts"]

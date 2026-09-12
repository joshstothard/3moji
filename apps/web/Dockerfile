FROM node:24-alpine AS builder
WORKDIR /app

COPY package*.json package-lock.json turbo.json ./
COPY apps/web/package*.json apps/web/
COPY packages/ packages/

# Every workspace apps/web imports must be listed here, or its dependencies are
# absent from the image and `next build` fails with module-not-found.
RUN npm ci --ignore-scripts --workspace=apps/web --workspace=packages/core --workspace=packages/shared --workspace=packages/ui --include-workspace-root

COPY apps/web/ apps/web/
COPY packages/ packages/

ARG APP_VERSION=0.0.0
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION
ENV NEXT_TELEMETRY_DISABLED=1
ENV COREPACK_ENABLE_STRICT=0
ENV SKIP_YARN_COREPACK_CHECK=1

# Local packages must be built before the app that imports them: apps/web
# resolves @template/core to its dist output, which does not exist until now.
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/core
RUN npm run build --workspace=apps/web

# ── Production image ──────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ARG APP_VERSION=0.0.0
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# The base image bundles npm, which is not needed at runtime. Its vendored tar
# (7.5.15) carries CVE-2026-59873, which the blocking Trivy CRITICAL gate flags
# and which cannot be fixed from our package.json. Dropping npm removes it.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]

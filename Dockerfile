# syntax=docker/dockerfile:1
# Standalone Next.js app image for local runs. Hosted releases use ops/app/Dockerfile.
FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.8.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Inlined into the client bundle; runtime APP_URL and NEXT_PUBLIC_APP_URL must match it.
ARG NEXT_PUBLIC_APP_URL=http://localhost:3010
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
# Builds with synthetic configuration only; runtime secrets come from --env-file.
RUN node ops/app/build.mjs

FROM node:22.23.4-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.local-data/manufacturing-search-index.json ./.local-data/manufacturing-search-index.json
RUN mkdir -p .next/cache && chown node:node .next/cache
USER node
EXPOSE 3000
# ECS overrides HOSTNAME with the task hostname; bind all interfaces so loopback health checks reach the server.
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 exec node server.js"]

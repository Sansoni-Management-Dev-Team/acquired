# syntax=docker/dockerfile:1
# This image contains Acquire's communications host composition, not a generic SDK daemon.
FROM node:22.23.1-bookworm-slim AS build
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN npm install --global npm@12.2.0 pnpm@11.8.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY communications ./communications
COPY scripts/build-communications-service.mjs scripts/build-communications-production.mjs scripts/communications-service-entry.ts ./scripts/
COPY ops/communications/production/service/configuration-preflight.ts ./ops/communications/production/service/
RUN node scripts/build-communications-production.mjs

FROM node:22.23.1-bookworm-slim AS dependencies
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN npm install --global npm@12.2.0 pnpm@11.8.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:22.23.1-bookworm-slim AS runtime
RUN npm install --global npm@12.2.0
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ARG SOURCE_COMMIT
LABEL org.opencontainers.image.title="Acquire communications host" org.opencontainers.image.revision=$SOURCE_COMMIT
ENV NODE_ENV=production COMMUNICATIONS_LISTEN_HOST=0.0.0.0 COMMUNICATIONS_PORT=5461
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.local-data/communications/service-build/service.cjs ./service.cjs
COPY --from=build --chown=node:node /app/.local-data/communications/service-build/configuration-preflight.cjs ./configuration-preflight.cjs
COPY --chown=node:node ops/communications/production/service/healthcheck.mjs ops/communications/production/service/runtime.mjs ./
USER node
EXPOSE 5461
CMD ["node", "runtime.mjs", "--serve"]

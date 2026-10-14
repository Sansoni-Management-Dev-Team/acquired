# syntax=docker/dockerfile:1
FROM node:22.23.1-bookworm-slim AS build
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN npm install --global npm@12.2.0 pnpm@11.8.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
RUN node ops/app/build.mjs

FROM node:22.23.1-bookworm-slim AS runtime
RUN npm install --global npm@12.2.0
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.local-data/manufacturing-search-index.json ./.local-data/manufacturing-search-index.json
COPY --chown=node:node ops/app/runtime.mjs ./runtime.mjs
COPY --chown=node:node ops/app/campaign-readiness.mjs ./campaign-readiness.mjs
COPY --chown=node:node scripts/campaign-rollout-readiness.mjs ./campaign-rollout-readiness.mjs
RUN mkdir -p .next/cache && chown node:node .next/cache
USER node
EXPOSE 3000
CMD ["node", "runtime.mjs"]

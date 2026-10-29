FROM node:22.23.1-bookworm-slim AS build
WORKDIR /workspace/services/research
COPY services/research/package*.json ./
RUN npm ci --ignore-scripts
COPY services/research/ ./
COPY cloudflare/research/ /workspace/cloudflare/research/
COPY src/domain/ /workspace/src/domain/
COPY src/adapters/ /workspace/src/adapters/
COPY communications/packages/core/src/operation-trace.ts /workspace/communications/packages/core/src/operation-trace.ts
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22.23.1-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /workspace/services/research/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/services/research/dist ./dist
COPY --chown=node:node services/research/package.json ./
USER node
EXPOSE 8787
CMD ["node", "dist/server.mjs"]

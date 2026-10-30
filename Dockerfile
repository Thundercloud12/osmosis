FROM node:22-bookworm-slim AS workspace

WORKDIR /workspace/osmosis
RUN corepack enable \
    && corepack prepare pnpm@10.33.2 --activate \
    && mkdir -p .pnpm-store \
    && chown node:node .pnpm-store /workspace/osmosis
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --chown=node:node apps/server/package.json apps/server/package.json
COPY --chown=node:node apps/web/package.json apps/web/package.json
COPY --chown=node:node packages/shared/package.json packages/shared/package.json
USER node
RUN pnpm install --frozen-lockfile
COPY --chown=node:node . .

FROM workspace AS server
ENV NODE_ENV=production PORT=2567
EXPOSE 2567
CMD ["pnpm", "--filter", "@osmosis/server", "start"]

FROM workspace AS web
ARG VITE_GAME_SERVER_URL=http://localhost:2567
ENV VITE_GAME_SERVER_URL=${VITE_GAME_SERVER_URL}
RUN pnpm --filter @osmosis/web build
EXPOSE 5173
CMD ["pnpm", "--filter", "@osmosis/web", "exec", "vite", "preview", "--host", "0.0.0.0", "--port", "5173"]

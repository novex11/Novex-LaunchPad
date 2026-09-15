# syntax=docker/dockerfile:1
# Build one service from the monorepo, selected by the SERVICE build arg:
#   docker build --build-arg SERVICE=web       -t compose-web .
#   docker build --build-arg SERVICE=allocator -t compose-allocator .
#   docker build --build-arg SERVICE=quote     -t compose-quote .
#   docker build --build-arg SERVICE=indexer   -t compose-indexer .
#   docker build --build-arg SERVICE=keeper    -t compose-keeper .
#
# On Render, set SERVICE as an environment variable on each service; Render
# passes env vars to `docker build` as build args for every declared ARG.
ARG SERVICE=allocator

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Workspace manifests only, so the install layer is cached across code changes.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY packages/config/package.json packages/config/
COPY packages/sdk/package.json packages/sdk/
COPY packages/ui/package.json packages/ui/
COPY services/allocator/package.json services/allocator/
COPY services/quote/package.json services/quote/
COPY services/indexer/package.json services/indexer/

# ───────────────────────── backend: allocator | quote | indexer ─────────────────────────
FROM manifests AS deps-backend
RUN pnpm install --frozen-lockfile --ignore-scripts \
  --filter "@compose/allocator..." \
  --filter "@compose/quote..." \
  --filter "@compose/indexer..."

FROM deps-backend AS build-backend
COPY tsconfig.base.json ./
COPY packages/config packages/config
COPY packages/sdk packages/sdk
COPY services/allocator services/allocator
COPY services/quote services/quote
COPY services/indexer services/indexer
RUN pnpm --filter @compose/config build \
 && pnpm --filter @compose/sdk build \
 && pnpm --filter @compose/allocator build \
 && pnpm --filter @compose/quote build \
 && pnpm --filter @compose/indexer build

FROM base AS runner-backend
ENV NODE_ENV=production
COPY --from=build-backend --chown=node:node /app /app
ARG SERVICE
WORKDIR /app/services/${SERVICE}
USER node
CMD ["node", "dist/index.js"]

FROM runner-backend AS runner-allocator
FROM runner-backend AS runner-quote
FROM runner-backend AS runner-indexer

# ───────────────────────────────── web (Next.js) ─────────────────────────────────
FROM manifests AS deps-web
RUN pnpm install --frozen-lockfile --ignore-scripts \
  --filter "@compose/web..."

FROM deps-web AS build-web
# next build needs more than Node's default heap on small build machines.
ENV NODE_OPTIONS=--max-old-space-size=4096
# NEXT_PUBLIC_* values are inlined into the client bundle at build time.
# Declared ARGs are visible to RUN as env vars only when a value is supplied,
# so unset ones keep the app's own defaults.
ARG NEXT_PUBLIC_USE_TESTNET=true
ARG NEXT_PUBLIC_PRIVY_APP_ID
ARG NEXT_PUBLIC_VAULT_ADDRESS
ARG NEXT_PUBLIC_RECEIPT_TOKEN_ADDRESS
ARG NEXT_PUBLIC_FACTORY_ADDRESS
ARG NEXT_PUBLIC_PAIR_FACTORY_ADDRESS
ARG NEXT_PUBLIC_PAIR_ROUTER_ADDRESS
ARG NEXT_PUBLIC_CURVE_ROUTER_ADDRESS
ARG NEXT_PUBLIC_COMPOSE_CURVE_ADDRESS
ARG NEXT_PUBLIC_ORACLE_ADAPTER_ADDRESS
ARG NEXT_PUBLIC_USDG_ADDRESS
ARG NEXT_PUBLIC_WETH_ADDRESS
ARG NEXT_PUBLIC_UNISWAP_V3_ROUTER
ARG NEXT_PUBLIC_BASKET_MIN_DEPOSIT_USD
ARG NEXT_PUBLIC_EXPLORER_URL
ARG NEXT_PUBLIC_ALLOCATOR_URL=http://localhost:3001
ARG NEXT_PUBLIC_QUOTE_URL=http://localhost:3002
ARG NEXT_PUBLIC_INDEXER_URL=http://localhost:3003
ARG NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC_URL
ARG NEXT_PUBLIC_ROBINHOOD_RPC_URL
ARG ROBINHOOD_TESTNET_RPC_URL
ARG ROBINHOOD_RPC_URL
ARG ALCHEMY_API_KEY

COPY tsconfig.base.json ./
COPY packages/config packages/config
COPY packages/sdk packages/sdk
COPY packages/ui packages/ui
COPY apps/web apps/web
RUN pnpm --filter @compose/config build \
 && pnpm --filter @compose/sdk build \
 && pnpm --filter @compose/ui build \
 && pnpm --filter @compose/web build

FROM base AS runner-web
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build-web --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build-web --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build-web --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "apps/web/server.js"]

# ─────────────────────────── keeper (mainnet price keeper worker) ───────────────────────────
# Runs scripts/price-keeper.ts straight from source with tsx (a root devDependency),
# importing the feed/updater addresses from packages/config/src/*.json. viem is
# not a root dependency, so it is installed through @compose/indexer and
# public-hoisted to /app/node_modules where the root-level script resolves it.
FROM manifests AS deps-keeper
# Root devDependencies (tsx, viem) plus the config package the keeper imports.
RUN pnpm install --frozen-lockfile --ignore-scripts -w \
  --filter "@compose/config..."

FROM deps-keeper AS runner-keeper
ENV NODE_ENV=production
COPY packages/config/src packages/config/src
COPY scripts/lib scripts/lib
COPY scripts/price-keeper.ts scripts/
USER node
# One pass without sending anything: docker run --rm compose-keeper pnpm keeper:mainnet:dry
CMD ["pnpm", "keeper:mainnet"]

# ───────────────────────────────── final image ─────────────────────────────────
FROM runner-${SERVICE}

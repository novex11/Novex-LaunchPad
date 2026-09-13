# syntax=docker/dockerfile:1
# Build one backend service: allocator | quote | indexer

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY packages/config/package.json packages/config/
COPY packages/sdk/package.json packages/sdk/
COPY packages/ui/package.json packages/ui/
COPY services/allocator/package.json services/allocator/
COPY services/quote/package.json services/quote/
COPY services/indexer/package.json services/indexer/
RUN pnpm install --frozen-lockfile --ignore-scripts \
  --filter "@novex/allocator..." \
  --filter "@novex/quote..." \
  --filter "@novex/indexer..."

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/config packages/config
COPY packages/sdk packages/sdk
COPY services/allocator services/allocator
COPY services/quote services/quote
COPY services/indexer services/indexer
RUN pnpm --filter @novex/config build \
 && pnpm --filter @novex/sdk build \
 && pnpm --filter @novex/allocator build \
 && pnpm --filter @novex/quote build \
 && pnpm --filter @novex/indexer build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
RUN chown -R node:node /app
ARG SERVICE=allocator
WORKDIR /app/services/${SERVICE}
USER node
CMD ["node", "dist/index.js"]

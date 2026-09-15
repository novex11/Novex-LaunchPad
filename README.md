# Novex

Onchain managed-stock basket protocol on Robinhood Chain.

Deposit one tokenized stock, choose a strategy, receive a diversified basket plus Stockback cashback, and keep 100% of portfolio performance.

## Stack

- **Contracts:** Foundry + Solidity (Robinhood Chain)
- **Frontend:** Next.js 15, Privy, wagmi, shadcn/ui
- **Backend:** TypeScript (Hono APIs, Ponder indexer)
- **Shared:** `@novex/sdk`, `@novex/config`, `@novex/ui`

## Getting started

```bash
pnpm install
pnpm dev
```

### Backend with Docker

Allocator, quote, and indexer run as containers. The web and admin apps stay on the host.

Copy `.env.example` to `.env` and set at minimum:

- `DATABASE_URL` — Neon PostgreSQL connection string
- `ROBINHOOD_RPC_URL` — Alchemy mainnet RPC
- `VAULT_CONTRACT_ADDRESS` / `RECEIPT_TOKEN_CONTRACT_ADDRESS` — after deploy

```bash
pnpm docker:up
pnpm --filter @novex/web --filter @novex/admin dev
```

| Service | URL |
| --- | --- |
| Allocator | http://localhost:3001 |
| Quote | http://localhost:3002 |
| Indexer | http://localhost:3003 |
| Analytics | http://localhost:3003/analytics/summary |

Optional local Postgres (instead of Neon):

```bash
pnpm docker:up:local-db   # Postgres on localhost:5433
```

```bash
pnpm docker:logs    # follow backend logs
pnpm docker:ps      # container status
pnpm docker:down    # stop the stack
```

### Production on Render

Every service builds from the root `Dockerfile`; the `SERVICE` build arg picks
`web`, `allocator`, `quote`, or `indexer`. `render.yaml` describes the four
web services as a Blueprint, and `scripts/render-create.sh` creates them from
the CLI with secrets read from your local `.env`:

```bash
brew install render && render login
scripts/render-create.sh all        # or: indexer | allocator | quote | web
render services                     # watch the first deploys
render logs -r novex-indexer --tail # follow a service
```

Postgres stays on Neon (`DATABASE_URL`) and images on Redis Cloud (`REDIS_*`).
`NEXT_PUBLIC_*` values are inlined at build time, so changing one on the web
service requires a redeploy.

## Packages

| Path | Description |
|------|-------------|
| `apps/web` | User-facing Next.js app |
| `apps/admin` | Internal ops console |
| `packages/contracts` | Smart contracts |
| `packages/sdk` | Allocation, NAV, cashback logic |
| `packages/config` | Chain, token, strategy config |
| `packages/ui` | Design tokens and shared UI |
| `services/allocator` | Basket preview API |
| `services/quote` | Swap quote API |
| `services/indexer` | Onchain event indexer |

## Environment

Copy `.env.example` to `.env` and fill in Privy, RPC, and database credentials.

## Documentation

See `docs/` for product plan, design system, risk disclosures, and runbook.

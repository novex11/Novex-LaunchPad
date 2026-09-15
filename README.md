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
- `VAULT_FACTORY_ADDRESS` — the VaultFactory from `deployments-mainnet.json`; the indexer watches every vault it created

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

## Mainnet basket deployment

`packages/contracts/script/DeployMainnet.s.sol` deploys the oracle, allocation controller, cashback reserve, emergency registry, execution router, a Uniswap V3 swap adapter (or the `SWAP_VENUE_ROUTER` you provide), the vault factory, and one vault per deposit asset × strategy (Defensive / Balanced / Aggressive).

1. Set `DEPLOYER_PRIVATE_KEY` and a `FEED_<TICKER>` Chainlink feed for every token in `.env` (the script refuses to run with missing feeds unless `ALLOW_MISSING_FEEDS=true`).
2. Optionally set `MAX_SWAP_SLIPPAGE_BPS` (oracle floor for every swap leg, default 1%) and `VAULT_TVL_CAP_USD`.
3. Run from `packages/contracts`:

```bash
forge script script/DeployMainnet.s.sol --rpc-url robinhood --broadcast --verify
```

4. Copy `factory`, `oracle` and `vault`/`receiptToken` from `deployments-mainnet.json` into `NEXT_PUBLIC_FACTORY_ADDRESS`, `NEXT_PUBLIC_ORACLE_ADAPTER_ADDRESS`, `NEXT_PUBLIC_VAULT_ADDRESS`, `NEXT_PUBLIC_RECEIPT_TOKEN_ADDRESS` (web) and `VAULT_FACTORY_ADDRESS` (indexer).
5. Fund the `CashbackReserve` with reward tokens, then set `NEXT_PUBLIC_USE_TESTNET=false`.

The indexer's `/deposits` and `/redeems` endpoints only accept a wallet and a transaction hash. Every amount, the vault, and the Stockback paid are read from the on-chain receipt, writes are idempotent per transaction, and the chain listener records the same events independently, so nothing in the ledger can be claimed without a matching transaction.

Deposits mint shares for the value that actually lands in the vault after swaps, so `minShares` (web: `NEXT_PUBLIC_BASKET_SLIPPAGE_BPS`, default 1%) bounds the depositor's slippage and existing holders are never diluted. Keep that tolerance above the router's `MAX_SWAP_SLIPPAGE_BPS`.

## Documentation

See `docs/` for product plan, design system, risk disclosures, and runbook.

# Novex Operations Runbook

## Emergency Pause

1. Open admin console at `apps/admin` (port 3004)
2. Toggle pause flags: deposits, swaps, rebalances, cashback independently
3. Onchain: call `EmergencyRegistry.set*Paused(true)` via multisig
4. Withdrawals remain enabled when safely possible

## Oracle Staleness

- Alert when Chainlink `updatedAt` > 3600s
- Auto-pause swaps via EmergencyRegistry
- Allow proportional basket redemption

## Cashback Budget Exhaustion

- Monitor `CashbackReserve.budgetRemaining()`
- Auto-pause at 10% remaining (config: `budgetPauseThreshold`)
- Announce on vault transparency page

## UIMultiplierUpdated (ERC-8056)

1. Indexer captures event within 1 block
2. Reconcile NAV history
3. Block deposits/redeems if pending multiplier within 300s safety window

## Launch Caps

- Global TVL: $1M — enforced in StrategyVault
- Per-user deposit: $50K
- Review daily during first 30 days post-launch

## Monitoring Alerts

- Oracle staleness / negative price
- Vault drift beyond strategy limits
- Rebalance failure / excessive slippage
- Cashback reserve low per ticker
- Abnormal deposit/redemption spikes

## Backend (Docker)

```bash
pnpm docker:up              # allocator, quote, indexer (Neon via .env DATABASE_URL)
pnpm docker:up:local-db     # same + local Postgres on :5433
pnpm docker:logs            # follow logs
pnpm docker:down            # stop
```

Health checks:

- http://localhost:3001/health
- http://localhost:3002/health
- http://localhost:3003/health

Analytics (indexer, requires `DATABASE_URL`):

- http://localhost:3003/analytics/summary
- http://localhost:3003/analytics/tvl
- http://localhost:3003/analytics/volume?days=30
- http://localhost:3003/analytics/swaps

Indexer reads `DATABASE_URL` from `.env` (Neon). Schema and analytics tables are created on startup. Chain listener and mark-to-market require `ROBINHOOD_RPC_URL` and vault contract addresses in `.env`.

## Deployment

```bash
cd packages/contracts
forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast
```

Verify contracts on explorer and publish addresses.

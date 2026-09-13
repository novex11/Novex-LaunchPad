# Novex Smart Contracts

Foundry contracts for Robinhood Chain.

## Contracts

- `VaultFactory` — deploy/register strategy vaults
- `StrategyVault` — ERC-4626-style share accounting, deposit/redeem
- `AllocationController` — onchain strategy limit validation
- `ExecutionRouter` — swap routing with slippage controls
- `CashbackReserve` — Deposit + Allocation Stockback inventory
- `OracleAdapter` — Chainlink reads with staleness checks
- `ReceiptToken` — non-transferable vault shares (nNVDA-B)
- `EmergencyRegistry` — independent pause flags

## Test

```bash
forge test
```

## Deploy (Robinhood testnet)

```bash
export DEPLOYER_PRIVATE_KEY=0x...
export ROBINHOOD_TESTNET_RPC_URL=https://...
forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast
```

Publish addresses in `docs/AUDIT_CHECKLIST.md` after deployment.

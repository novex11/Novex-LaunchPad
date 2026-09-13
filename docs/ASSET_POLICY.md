# Asset Policy

## MVP Whitelist (8 tokens)

NVDA, AAPL, MSFT, SPY, QQQ, GOOGL, AMZN, TSLA (+ SNDK for preferences demo)

## Onboarding Checklist

Before adding a new Stock Token:

1. Contract authenticity verified on Robinhood Chain registry
2. Chainlink price feed available and tested
3. Liquidity on Rialto propAMM or RFQ routes
4. ERC-8056 multiplier behavior documented
5. AllocationController approval set onchain
6. Cashback rate configured (if eligible)

## Sync with RHJ API

```typescript
import { fetchRhjAssets, mergeRhjAssetsWithConfig } from "@novex/config";
```

Run periodically to update contract addresses from `https://api.robinhood.com/rhj/assets`.

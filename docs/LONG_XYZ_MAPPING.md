# Long.xyz Launchpad Mapping

How Long.xyz's stock-paired launchpad architecture was analyzed and what was
merged into Novex's pair launchpad to make execution smoother and more accurate.

---

## Sources

| Source | URL | What it covers |
|--------|-----|----------------|
| Mobula integration guide | https://docs.mobula.io/almanac/robinhood-launchpads/longxyz | Factory, Airlock, ABI, epochs, pricing |
| Robinhood Stock Tokens | https://docs.robinhood.com/chain/stock-tokens/ | ERC-20 mechanics, ERC-8056 multiplier, trading hours |
| Robinhood Stock Token APIs | https://docs.robinhood.com/chain/stock-token-apis/ | /assets, /prices, /corporate-actions |
| @longdotxyz/shared (npm) | https://www.npmjs.com/package/@longdotxyz/shared | REST + GraphQL contracts, pathfinding, quotes |
| Doppler/Airlock (GitHub) | https://github.com/whetstoneresearch/doppler | Airlock.sol, AssetData struct, factory |
| Gate Learn explainer | https://www.gate.com/learn/articles/what-is-long-xyz-stock-paired-launchpad | Product overview, Community Mode, LongX |

## Long.xyz contracts (Robinhood Chain)

| Role | Address |
|------|---------|
| Factory | `0x22e99278308b393ea1260859b181ad7e78f5eeed` |
| Airlock | `0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862` |
| Uniswap v4 PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` |
| Universal Router | `0x8876789976dEcBfCbBbe364623C63652db8C0904` |

## Long.xyz vs Novex architecture

| Dimension | Long.xyz | Novex pair launchpad |
|-----------|----------|---------------------|
| What launches | New ERC-20 community token | Vault over two approved stocks |
| Quote asset | Stock Token (NVDA, AAPL, TSLA, SPCX) | USDG for deposit/redeem; both legs are stocks |
| Market | Uniswap v4 concentrated liquidity pool | ExecutionRouter swaps into a weighted basket |
| Completion | Time epoch (epochStart -> epochEnd) | Vault lives indefinitely |
| Uniqueness | 24h ticker reservation + factory validation | Sorted (tokenA, tokenB) key |
| Fees | V4 hook / Community Mode vault routing | Creator fee 1-5% on USDG deposits |
| Analytics | GraphQL API (auction_pool, swap volume) | Indexer with DB aggregates |

## What was merged

### 1. Oracle-guarded slippage protection (PairVault.sol)

**Problem:** `_executePairSwaps` and `_redeemToUsdg` passed `minAmountOut = 0` to
every swap — zero slippage protection.

**Long.xyz equivalent:** Uniswap v4 sqrtPriceX96 + tick-based concentrated
liquidity bounds prevent execution at arbitrarily bad prices.

**Fix:** Added `_oracleMinOut()` that computes a fair output from Chainlink prices
and applies `SWAP_SLIPPAGE_BPS = 200` (2%) tolerance. Every swap now has a
price floor.

### 2. Corporate action / multiplier guard (PairVault.sol)

**Problem:** `OracleAdapter.isMultiplierPending()` existed but was never called
before swaps. A stock split mid-transaction could cause massive mispricing.

**Long.xyz equivalent:** Airlock epochs pause the pool around lifecycle events;
corporate actions are handled through the multiplier update process.

**Fix:** Added `_requireNoMultiplierPending()` check at the top of both
`_deposit()` and `redeem()`. If either leg has a pending ERC-8056 multiplier
change, the transaction reverts.

### 3. Trading hours + tokenization window awareness (config + UI)

**Problem:** Users had no indication when US markets are closed or when the
Robinhood tokenization window is shut. Off-hours deposits hit thinner liquidity.

**Long.xyz equivalent:** Long.xyz documents "session mismatch risk" as a primary
risk factor — 24/7 DEX trading vs equity session hours.

**Fix:**
- Added `isUSMarketHours()` and `isTokenizationWindowOpen()` to `@novex/config`
- Added `tradingHours` metadata to each `StockToken` entry
- Pair deposit page now shows amber/red warnings when markets are closed or
  tokenization window is shut

### 4. Numeraire / quote stock concept (config)

**Problem:** Both pair legs were treated identically. No concept of which stock
"anchors" the pair's value — unlike Long.xyz where the stock IS the quote asset.

**Fix:**
- Added `numeraire: boolean` flag to `StockToken` interface
- Added `numeraireTokens()` helper to filter tokens suitable as quote legs
- Major stocks (NVDA, AAPL, MSFT, SPY, QQQ, GOOGL, AMZN, TSLA) marked as
  numeraire-eligible
- Schema stores `numeraire_ticker` per pair so the UI can highlight the anchor

### 5. Pair metadata + description (schema)

**Problem:** Pairs had no description or metadata — just raw ticker/weight data.

**Long.xyz equivalent:** tokenURI() + IPFS JSON metadata on every launched token.

**Fix:** Added `description` and `numeraire_ticker` columns to the
`launched_pairs` schema. Launch input accepts optional description from creator.

### 6. 24h volume tracking (indexer)

**Problem:** No volume metrics — couldn't sort pairs by activity. Long.xyz's
GraphQL API provides full per-pool volume data.

**Fix:**
- Added `volume_24h_usd` column to `launched_pairs`
- `refresh24hVolume()` function recomputes rolling 24h from deposit + redeem tables
- Called automatically after every deposit and redeem
- New "Hot" sort option in the launchpad UI (sorts by 24h volume)
- `getLaunchpadStats()` now returns `totalVolume24hUsd`

### 7. RHJ API merge enrichment (config)

**Problem:** `mergeRhjAssetsWithConfig()` only updated contract addresses.

**Fix:** Now also populates `logoUrl` (from Robinhood CDN pattern) and
`tradingHours` from RHJ API `tradingCapabilities`. Keeps token config
automatically in sync with the on-chain registry.

## Not merged (out of scope for stock-stock pair vaults)

| Long.xyz feature | Why not merged |
|-----------------|----------------|
| New community token minting | Novex launches vaults, not tokens |
| Uniswap v4 pool creation | Novex uses ExecutionRouter, not AMM pools |
| Airlock epoch + migration | Novex vaults are perpetual, no graduation |
| Ticker reservation (24h anti-snipe) | Sorted key uniqueness is sufficient for stock pairs |
| Community Mode fee vaults | Creator fee model already exists |
| LongX leveraged wrappers (NVDA3x) | Explicitly excluded from MVP scope |
| @longdotxyz/shared SDK | UNLICENSED; we built our own |

## Future options

1. **Long-style token launchpad** — mint new tokens paired vs stocks (full Airlock/v4 stack)
2. **Stock-denominated deposits** — deposit NVDA directly instead of only USDG
3. **Hybrid** — keep pair vaults + add a separate `/launch/token` product

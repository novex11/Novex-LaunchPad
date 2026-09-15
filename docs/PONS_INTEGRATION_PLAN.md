# Pons v2 integration: one market, two lenses

Written 2026-09-16. Contracts in `packages/contracts/src/pons/`, tests in
`test/PonsLaunchpad.t.sol` (mock) and `test/PonsForkMainnet.t.sol` (real factory).

## What was verified on-chain (Robinhood Chain 4663)

Pons v2 launch factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`
(verified source on Sourcify: `PonsV2LaunchFactory`, solc 0.8.35).

| Check | Result |
|---|---|
| `canLaunch(x)` | `launchEnabled \|\| whitelistedLaunchers[x]`; `launchEnabled()` is **true**, so any address (contracts included) can launch. The docs' "whitelist only" note is stale. |
| Launches, blocks 63.90M–63.99M | 3,193 `TokenLaunched` events from 2,316 distinct deployers |
| `launchFee()` | 0.0005 ETH |
| Launch config 0 | 1B supply, 1% curve fee, 1.68 ETH phantom / 4.2 ETH threshold (ETH quote), tick spacing 200 |
| Approved quote tokens | 43 ERC-20s: the **Robinhood stock tokens** (NVDA, TSLA, AAPL, SPY, GME, GLD, SGOV, …) plus USDG. 41 of them are in `packages/config/src/mainnet-manifest.json`. |
| Stock economics | e.g. NVDA: phantom 16.64, threshold 41.6 (18 dec); USDG: phantom 3,236, threshold 8,090 (6 dec) |
| Snipe tax | 99% in the launch second, decaying to 0 over 3 s; launcher, creator fee recipient and up to 32 declared wallets are exempt |
| `maxCreatorTaxBps()` | 1,000 |

The gate is owner-controlled (`setLaunchEnabled`), so Pons can close it later.
`PonsLauncher.launch` checks `canLaunch(address(this))` and fails with a clear
reason if that happens; the fallback is asking Pons to whitelist the launcher.

## Design

A token can only have one market. To make price and volume identical on Pons
and Compose, the **Pons v2 bonding curve is the single venue** and Compose is
a second lens on it:

- **`PonsLauncher.launch(pair, …)`** — only the pair creator, once per pair.
  Calls `PonsV2LaunchFactory.launchToken` with the pair's receipt name/symbol
  (same identity as `ComposeCurve.createToken`), the creator as
  `creatorFeeRecipient`, and one of the pair's two stocks (or USDG) as the
  quote asset. Forwards the 0.0005 ETH launch fee, optional snipe-tax
  exemptions and an optional untaxed dev buy in the same transaction. Records
  pair ↔ token ↔ curve.
- **`PonsRouter`** — every trade lands on the Pons curve:
  - `buy` / `sell`: quote stock (direct), USDG or ETH (swap along a v3 path
    floored at the oracle price, like `PairRouter`).
  - `buyWithShares`: redeem pair shares → both stocks → swap the non-quote leg
    → curve. `sellForShares`: curve → quote → split at the vault's reserve
    ratio → both stocks → `depositFor` → shares to the seller (router must be
    fee-exempt on `PairFactory`).
  - Views: `priceInQuote`, `priceUsd8`, `priceInShares`, `marketCapUsd8`,
    `progressBps`, `quoteBuy`, `quoteSell`. `priceInShares × sharePrice ==
    priceUsd8` holds exactly; the "two stocks" price is a unit conversion of
    the Pons price, not a second market.

What changes versus `ComposeCurve`: the curve reserve is one stock (or USDG)
held by Pons, not the pair share, so token buys no longer create demand for
both stocks. Compose's 30% protocol share of curve fees goes away (Pons takes
its own protocol cut and pays the creator directly); a splitter as
`creatorFeeRecipient` or a router fee can restore it later. Fees on the Pons
side: 1% curve fee (protocol / buyback / creator per Pons policy) plus an
optional creator tax up to 10%.

## Deploy

```
bash scripts/deploy-pons.sh mainnet
```
Deploys `PonsLauncher(pairFactory, ponsFactory, usdg)` and
`PonsRouter(launcher, pairRouter)`, sets the router fee-exempt when the deployer
owns `PairFactory`, and writes `packages/contracts/deployments-pons-4663.json`.
Pons v2 has no known testnet deployment; pass `PONS_FACTORY` explicitly.

## Follow-ups (not in this change)

1. **Indexer**: ingest `CurveBuy` / `CurveSell` from each launched curve
   (topics from `IPonsV2BondingCurve`) and convert quote → USD → pair shares
   for candles and volume; add `TokenLaunched` from `PonsLauncher`.
2. **Web**: launch page step "launch on Pons" after `launchPair`; token page
   reads `PonsRouter` views; trade widget calls `buy` / `buyWithShares` /
   `sell` / `sellForShares`.
3. **Post-graduation**: Pons moves liquidity into a Uniswap v4 pool with the
   `PonsV2MemeHook`; the router needs a v4 leg for graduated tokens.
4. **Config**: add `ponsFactory`, `ponsLauncher`, `ponsRouter` to the mainnet
   contracts config once deployed.

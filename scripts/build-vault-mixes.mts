/**
 * Compute the fixed target mix of every Balanced basket vault with the same
 * allocator the app previews with, and write it where the Foundry deploy
 * scripts read it (`packages/contracts/vault-mixes-<chainId>.json`).
 *
 *   pnpm mixes:testnet                      # 5 faucet stocks on 46630
 *   pnpm mixes:mainnet                      # every stock in mainnet-onboard.json on 4663
 *   tsx scripts/build-vault-mixes.ts --mainnet --tickers NVDA,AAPL
 *
 * A vault's mix is "deposit ticker + the strategy's default basket" — no
 * preferences, default basket size — so what CreateMainnetVaults /
 * DeployTestnetBaskets put on-chain is exactly what /create shows.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  STRATEGIES,
  TESTNET_TOKENS,
  getActiveStockTokens,
  isBasketEligible,
  type StockToken,
  type StrategyId,
} from "../packages/config/src/index";
import { allocationToMix, computeAllocation } from "../packages/sdk/src/allocation";

const root = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const mainnet = args.includes("--mainnet");
const strategy: StrategyId = "balanced";
const tickerArg = args[args.indexOf("--tickers") + 1];
const only = args.includes("--tickers") && tickerArg ? tickerArg.split(",").map((t) => t.trim().toUpperCase()) : null;

let universe: StockToken[];
let chainId: number;
if (mainnet) {
  process.env.NEXT_PUBLIC_USE_TESTNET = "false";
  chainId = 4663;
  universe = getActiveStockTokens();
} else {
  process.env.NEXT_PUBLIC_USE_TESTNET = "true";
  chainId = 46630;
  universe = TESTNET_TOKENS;
}

// Deposit assets: every equity/ETF with a real contract. On mainnet the onboard
// list (fetch-mainnet-prices.ts) is the set that actually has feeds on-chain.
let depositTickers = universe
  .filter((t) => isBasketEligible(t) && t.category !== "stable" && t.category !== "forex")
  .map((t) => t.ticker);
if (mainnet) {
  const onboardPath = join(root, "packages/contracts/mainnet-onboard.json");
  if (existsSync(onboardPath)) {
    const onboard = JSON.parse(readFileSync(onboardPath, "utf8")) as { tickers: string[]; categories: string[] };
    const withFeed = new Set(
      onboard.tickers.filter((_, i) => !["stable", "crypto"].includes(onboard.categories[i]!)),
    );
    depositTickers = depositTickers.filter((t) => withFeed.has(t));
  }
}
if (only) depositTickers = depositTickers.filter((t) => only.includes(t));

const byTicker = new Map(universe.map((t) => [t.ticker, t]));
const mixes: Record<string, { depositToken: string; tickers: string[]; tokens: string[]; weightsBps: number[] }> = {};
const skipped: string[] = [];

for (const ticker of depositTickers) {
  const result = computeAllocation({ depositTicker: ticker, depositUsd: 10_000, strategy, tokens: universe });
  if (result.violations.length || result.items.length === 0) {
    skipped.push(`${ticker}: ${result.violations.join("; ") || "empty allocation"}`);
    continue;
  }
  const mix = allocationToMix(result, strategy);
  if (mix.weightsBps.length === 0) {
    skipped.push(`${ticker}: weights cannot be rounded under the ${STRATEGIES[strategy].maxSingleStock * 100}% cap`);
    continue;
  }
  const tokens = mix.tickers.map((t) => byTicker.get(t)!.address);
  mixes[ticker] = { depositToken: byTicker.get(ticker)!.address, tickers: mix.tickers, tokens, weightsBps: mix.weightsBps };
}

const outPath = join(root, `packages/contracts/vault-mixes-${chainId}.json`);
writeFileSync(
  outPath,
  JSON.stringify({ chainId, strategy, generatedAt: new Date().toISOString(), mixes }, null, 2) + "\n",
);

console.log(`✅  ${Object.keys(mixes).length} ${strategy} mixes → ${outPath}`);
for (const [ticker, mix] of Object.entries(mixes).slice(0, 8)) {
  console.log(
    `   ${ticker.padEnd(6)} ${mix.tickers.map((t, i) => `${t} ${(mix.weightsBps[i]! / 100).toFixed(2)}%`).join(" · ")}`,
  );
}
if (Object.keys(mixes).length > 8) console.log(`   … ${Object.keys(mixes).length - 8} more`);
for (const line of skipped) console.log(`   skip ${line}`);
if (skipped.length) process.exitCode = 0;

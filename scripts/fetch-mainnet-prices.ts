/**
 * Fetches live USD prices for every mainnet manifest token plus WETH (ETH-USD)
 * and USDG (constant $1) and writes packages/contracts/mainnet-onboard.json as
 * parallel arrays forge can parse (vm.parseJson*Array):
 *
 *   { "tickers": [...], "addresses": [...], "prices": [usd8 ...], "categories": [...] }
 *
 * Consumed by DeployMainnetCore (USDG/WETH opening prices), OnboardMainnetTokens
 * and CreateMainnetVaults. Tokens whose price cannot be fetched are omitted and
 * listed on the console so they can be onboarded later.
 *
 *   pnpm prices:mainnet
 *   MAINNET_ONBOARD_FILE=/path/out.json PRICE_CONCURRENCY=6 tsx scripts/fetch-mainnet-prices.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchUsdPrice, toUsd8 } from "./lib/market-prices";

const ROOT = join(import.meta.dirname, "..");
const MANIFEST = join(ROOT, "packages/config/src/mainnet-manifest.json");
const OUT = process.env.MAINNET_ONBOARD_FILE ?? join(ROOT, "packages/contracts/mainnet-onboard.json");
const CONCURRENCY = Math.max(1, Number(process.env.PRICE_CONCURRENCY ?? 6));
const RETRIES = Math.max(1, Number(process.env.PRICE_RETRIES ?? 4));

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";

/**
 * Manifest ticker → Yahoo symbol when they differ (exchange ticker changes).
 * Extend at runtime with YAHOO_SYMBOL_OVERRIDES="SATS=ECHO,OLD=NEW".
 */
const YAHOO_SYMBOL_OVERRIDES: Record<string, string> = {
  SATS: "ECHO", // EchoStar renamed its Nasdaq ticker; the RHJ token keeps SATS
};
for (const pair of (process.env.YAHOO_SYMBOL_OVERRIDES ?? "").split(",")) {
  const [from, to] = pair.split("=").map((s) => s.trim().toUpperCase());
  if (from && to) YAHOO_SYMBOL_OVERRIDES[from] = to;
}
const yahooSymbol = (ticker: string) => YAHOO_SYMBOL_OVERRIDES[ticker] ?? ticker;

interface ManifestToken {
  ticker: string;
  address: `0x${string}`;
  category: string;
}

interface Entry {
  ticker: string;
  address: string;
  symbol: string;
  category: string;
}

interface Priced extends Entry {
  usd8: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(entry: Entry): Promise<number> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      return await fetchUsdPrice(entry.symbol);
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      // Yahoo rate-limits bursts; back off harder on 429.
      const base = /HTTP 429/.test(msg) ? 4_000 : 750;
      await sleep(base * 2 ** attempt + Math.random() * 250);
    }
  }
  throw lastError;
}

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { tokens: ManifestToken[] };
  const entries: Entry[] = [
    { ticker: "USDG", address: USDG, symbol: "USD", category: "stable" },
    { ticker: "WETH", address: WETH, symbol: "ETH-USD", category: "crypto" },
    ...manifest.tokens.map((t) => ({ ticker: t.ticker, address: t.address, symbol: yahooSymbol(t.ticker), category: t.category })),
  ];

  const priced: (Priced | null)[] = new Array(entries.length).fill(null);
  const failed: { ticker: string; reason: string }[] = [];
  let next = 0;
  let done = 0;
  const started = Date.now();

  async function worker() {
    while (next < entries.length) {
      const i = next++;
      const entry = entries[i]!;
      try {
        const price = await fetchWithRetry(entry);
        const usd8 = toUsd8(price);
        if (usd8 <= 0n || usd8 > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${entry.ticker}: price out of range`);
        priced[i] = { ...entry, usd8: Number(usd8) };
      } catch (e) {
        failed.push({ ticker: entry.ticker, reason: e instanceof Error ? e.message : String(e) });
      }
      done++;
      if (done % 25 === 0 || done === entries.length) {
        console.log(`  ${done}/${entries.length} priced (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      }
    }
  }
  console.log(`Fetching ${entries.length} prices (concurrency ${CONCURRENCY})…`);
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));

  const ok = priced.filter((p): p is Priced => p !== null);
  const usdg = ok.find((p) => p.ticker === "USDG");
  if (!usdg || usdg.usd8 !== 100_000_000) throw new Error("USDG must price at exactly 100000000 (1e8)");
  if (!ok.some((p) => p.ticker === "WETH")) throw new Error("WETH (ETH-USD) price is required for DeployMainnetCore");

  const out = {
    chainId: 4663,
    generatedAt: new Date().toISOString(),
    tickers: ok.map((p) => p.ticker),
    addresses: ok.map((p) => p.address),
    prices: ok.map((p) => p.usd8),
    categories: ok.map((p) => p.category),
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

  console.log(`\n✅  ${ok.length} prices written to ${OUT}`);
  if (failed.length) {
    console.log(`⚠️   ${failed.length} token(s) omitted (no price):`);
    for (const f of failed) console.log(`    ${f.ticker.padEnd(8)} ${f.reason}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

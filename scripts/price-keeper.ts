/**
 * Price keeper: pushes live market prices into the launchpad's PushPriceFeeds so
 * launches and trades never hit "OracleAdapter: stale".
 *
 * A feed is updated when its price moved by KEEPER_DEVIATION_BPS or its last
 * update is older than KEEPER_HEARTBEAT_SECONDS (on-chain staleness limit is
 * KEEPER_STALENESS_SECONDS, 3600 by default — see OracleAdapter).
 *
 * Usage:
 *   pnpm keeper:testnet          # loop (Robinhood Chain Testnet, 46630)
 *   pnpm keeper:testnet:once     # single update
 *   pnpm keeper:mainnet          # loop (Robinhood Chain, 4663)
 *   pnpm keeper:mainnet:once     # single update; exits 1 if any feed is left stale
 *   pnpm keeper:mainnet:dry      # single pass, nothing sent (no key needed)
 *
 * Mainnet feeds and the PriceFeedUpdater come from
 * packages/config/src/mainnet-deployments.json (written by `pnpm sync:mainnet`).
 *
 * Env: KEEPER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY), ROBINHOOD_TESTNET_RPC_URL / ROBINHOOD_RPC_URL,
 *      KEEPER_NETWORK (mainnet|testnet), KEEPER_INTERVAL_MS (300000),
 *      KEEPER_HEARTBEAT_SECONDS (1500 testnet / 2400 mainnet),
 *      KEEPER_DEVIATION_BPS (10 testnet / 50 mainnet), KEEPER_STALENESS_SECONDS (3600)
 */
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadRootEnv } from "./lib/load-env";
import { TESTNET_PRICE_SYMBOLS, fetchUsdPrices, toUsd8, yahooSymbolFor } from "./lib/market-prices";
import testnetDeployment from "../packages/config/src/testnet-deployments.json";
import mainnetDeployment from "../packages/config/src/mainnet-deployments.json";

loadRootEnv();

const MAINNET = process.argv.includes("--mainnet") || process.env.KEEPER_NETWORK === "mainnet";
const ONCE = process.argv.includes("--once");
const DRY_RUN = process.argv.includes("--dry-run");
const INTERVAL_MS = Number(process.env.KEEPER_INTERVAL_MS ?? 300_000);
const HEARTBEAT_S = BigInt(process.env.KEEPER_HEARTBEAT_SECONDS ?? (MAINNET ? 2_400 : 1_500));
const DEVIATION_BPS = BigInt(process.env.KEEPER_DEVIATION_BPS ?? (MAINNET ? 50 : 10));
/** OracleAdapter.stalenessThreshold — a feed older than this reverts trades. */
const STALENESS_S = BigInt(process.env.KEEPER_STALENESS_SECONDS ?? 3_600);

/** Max feeds per pushPrices() transaction. */
const PUSH_CHUNK = 40;
/** Max latestRoundData() reads per multicall. */
const READ_CHUNK = 100;
/** Concurrent direct reads when the chain has no multicall3. */
const FALLBACK_READ_CONCURRENCY = 20;
/** Concurrent Yahoo requests. */
const FETCH_CONCURRENCY = 6;
/** Canonical Multicall3 address (same on every EVM chain that has it). */
const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

const label = MAINNET ? "keeper:mainnet" : "keeper";
const stamp = () => new Date().toISOString();
const log = (msg: string) => console.log(`[${label} ${stamp()}] ${msg}`);
const warn = (msg: string) => console.warn(`[${label} ${stamp()}] ${msg}`);
const isAddress = (v: unknown): v is Address => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);

function fail(message: string): never {
  console.error(`[${label}] error: ${message}`);
  process.exit(1);
}

interface KeeperDeployment {
  /** ticker → PushPriceFeed */
  feeds: Record<string, Address>;
  /** ticker → Yahoo symbol */
  symbols: Record<string, string>;
  updater: Address;
  rpcUrl: string;
}

function pickFeeds(raw: Record<string, string>): Record<string, Address> {
  const out: Record<string, Address> = {};
  for (const [ticker, address] of Object.entries(raw)) {
    if (isAddress(address)) out[ticker] = address;
    else warn(`${ticker}: invalid feed address "${address}" — skipped`);
  }
  return out;
}

function loadDeployment(): KeeperDeployment {
  if (MAINNET) {
    const updater = mainnetDeployment.contracts.priceFeedUpdater;
    if (!isAddress(updater)) fail("Mainnet launchpad not deployed. Run: pnpm deploy:mainnet");
    const feeds = pickFeeds(mainnetDeployment.feeds);
    if (Object.keys(feeds).length === 0) fail("Mainnet deployment has no feeds. Run: pnpm sync:mainnet");
    const symbols = Object.fromEntries(Object.keys(feeds).map((t) => [t, yahooSymbolFor(t)]));
    return { feeds, symbols, updater, rpcUrl: process.env.ROBINHOOD_RPC_URL || mainnetDeployment.rpcUrl };
  }
  const updater = testnetDeployment.contracts.priceFeedUpdater;
  if (!isAddress(updater)) fail("Testnet launchpad not deployed. Run: pnpm deploy:testnet");
  const feeds = pickFeeds(testnetDeployment.feeds);
  const symbols = Object.fromEntries(
    Object.entries(TESTNET_PRICE_SYMBOLS).filter(([ticker]) => ticker in feeds),
  );
  return {
    feeds,
    symbols,
    updater,
    rpcUrl: process.env.ROBINHOOD_TESTNET_RPC_URL || testnetDeployment.rpcUrl,
  };
}

const { feeds, symbols, updater, rpcUrl } = loadDeployment();
if (!rpcUrl) fail(MAINNET ? "Set ROBINHOOD_RPC_URL for the mainnet keeper" : "Set ROBINHOOD_TESTNET_RPC_URL");

const rawKey = process.env.KEEPER_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY;
if (!rawKey && !DRY_RUN) fail("Set KEEPER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) in the environment");
// Dry runs never sign anything, so a throwaway account is enough to simulate with.
const account = privateKeyToAccount(rawKey ? (`0x${rawKey.replace(/^0x/, "")}` as Hex) : generatePrivateKey());

const chain = {
  id: MAINNET ? 4663 : 46630,
  name: MAINNET ? "Robinhood Chain" : "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
} as const;
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
]);
const updaterAbi = parseAbi(["function pushPrices(address[] feeds, int256[] answers)"]);

interface Round {
  answer: bigint;
  updatedAt: bigint;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Whether multicall3 is usable on this chain; decided on the first read. */
let multicallSupported: boolean | undefined;

async function readRoundsMulticall(addresses: Address[]): Promise<Map<Address, Round | null>> {
  const out = new Map<Address, Round | null>();
  for (const chunk of chunks(addresses, READ_CHUNK)) {
    const contracts = chunk.map(
      (address) => ({ address, abi: feedAbi, functionName: "latestRoundData" }) as const,
    );
    const results = await publicClient.multicall({ contracts, multicallAddress: MULTICALL3, allowFailure: true });
    if (multicallSupported === undefined) {
      // A missing multicall3 surfaces as every call in the batch failing with
      // the same error; a healthy chain never fails all feeds at once.
      if (results.every((r) => r.status === "failure")) {
        const reason = results[0]?.error?.message.split("\n")[0] ?? "unknown";
        throw new Error(`multicall3 unavailable at ${MULTICALL3} (${reason})`);
      }
      multicallSupported = true;
    }
    results.forEach((r, i) => {
      out.set(chunk[i], r.status === "success" ? { answer: r.result[1], updatedAt: r.result[3] } : null);
    });
  }
  return out;
}

async function readRoundsDirect(addresses: Address[]): Promise<Map<Address, Round | null>> {
  const out = new Map<Address, Round | null>();
  for (const chunk of chunks(addresses, FALLBACK_READ_CONCURRENCY)) {
    await Promise.all(
      chunk.map(async (address) => {
        try {
          const [, answer, , updatedAt] = await publicClient.readContract({
            address,
            abi: feedAbi,
            functionName: "latestRoundData",
          });
          out.set(address, { answer, updatedAt });
        } catch {
          out.set(address, null);
        }
      }),
    );
  }
  return out;
}

async function readRounds(addresses: Address[]): Promise<Map<Address, Round | null>> {
  if (multicallSupported === false) return readRoundsDirect(addresses);
  try {
    return await readRoundsMulticall(addresses);
  } catch (e) {
    if (multicallSupported === true) throw e;
    multicallSupported = false;
    warn(`${e instanceof Error ? e.message : e} — falling back to per-feed reads`);
    return readRoundsDirect(addresses);
  }
}

interface Candidate {
  ticker: string;
  feed: Address;
  answer: bigint;
}

const usd = (v: bigint) => `$${(Number(v) / 1e8).toFixed(2)}`;

async function tick(): Promise<{ staleAfter: number }> {
  const tickers = Object.keys(feeds);
  const feedAddresses = tickers.map((t) => feeds[t]);

  // 1. Market prices (bounded concurrency, one retry; failures are skipped).
  const uniqueSymbols = [...new Set(tickers.map((t) => symbols[t]).filter(Boolean))];
  const { prices, failed: fetchFailures } = await fetchUsdPrices(uniqueSymbols, FETCH_CONCURRENCY);
  for (const [symbol, reason] of fetchFailures) warn(`${symbol}: price fetch failed — ${reason}`);

  // 2. On-chain state.
  const block = await publicClient.getBlock();
  const rounds = await readRounds(feedAddresses);

  const candidates: Candidate[] = [];
  const ageBefore = new Map<string, bigint | null>();
  let skipped = 0;
  let failed = 0;
  let staleBefore = 0;

  for (const ticker of tickers) {
    const feed = feeds[ticker];
    const round = rounds.get(feed) ?? null;
    if (!round) {
      ageBefore.set(ticker, null);
      staleBefore += 1;
      failed += 1;
      warn(`${ticker}: latestRoundData() failed on ${feed} — skipped`);
      continue;
    }
    const age = block.timestamp > round.updatedAt ? block.timestamp - round.updatedAt : 0n;
    ageBefore.set(ticker, age);
    if (age > STALENESS_S) staleBefore += 1;

    const symbol = symbols[ticker];
    const market = symbol ? prices.get(symbol) : undefined;
    if (market === undefined) {
      if (!symbol) warn(`${ticker}: no price symbol — skipped`);
      failed += 1;
      continue;
    }
    const price = toUsd8(market);
    if (price <= 0n) {
      warn(`${ticker}: non-positive price ${price} — skipped`);
      failed += 1;
      continue;
    }
    const diff = price > round.answer ? price - round.answer : round.answer - price;
    const deviationBps = round.answer > 0n ? (diff * 10_000n) / round.answer : 10_000n;
    if (age >= HEARTBEAT_S || deviationBps >= DEVIATION_BPS) {
      candidates.push({ ticker, feed, answer: price });
      log(
        `${ticker.padEnd(6)} ${usd(price)} (was ${usd(round.answer)}, ${deviationBps} bps, age ${age}s)${DRY_RUN ? " [dry-run]" : ""}`,
      );
    } else {
      skipped += 1;
    }
  }

  // 3. Push in bounded chunks, one transaction at a time.
  const pushedTickers = new Set<string>();
  const batches = chunks(candidates, PUSH_CHUNK);
  for (const [i, batch] of batches.entries()) {
    const tag = `chunk ${i + 1}/${batches.length} (${batch.length} feeds)`;
    const addresses = batch.map((c) => c.feed);
    const answers = batch.map((c) => c.answer);
    if (DRY_RUN) {
      log(`would push ${tag}: ${batch.map((c) => c.ticker).join(" ")}`);
      for (const c of batch) pushedTickers.add(c.ticker);
      continue;
    }
    try {
      const { request } = await publicClient.simulateContract({
        account,
        address: updater,
        abi: updaterAbi,
        functionName: "pushPrices",
        args: [addresses, answers],
      });
      const hash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        failed += batch.length;
        warn(`${tag} reverted · ${hash} · gas ${receipt.gasUsed}`);
        continue;
      }
      for (const c of batch) pushedTickers.add(c.ticker);
      log(`pushed ${tag} · ${hash} · gas ${receipt.gasUsed}`);
    } catch (e) {
      failed += batch.length;
      warn(`${tag} failed — ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    }
  }

  // 4. Feeds still (or unknowably) stale once this tick's pushes have landed.
  let staleAfter = 0;
  for (const ticker of tickers) {
    if (pushedTickers.has(ticker)) continue;
    const age = ageBefore.get(ticker);
    if (age === null || age === undefined || age > STALENESS_S) {
      staleAfter += 1;
      warn(`${ticker}: still stale (age ${age ?? "unknown"}s > ${STALENESS_S}s)`);
    }
  }

  log(
    `summary${DRY_RUN ? " (dry-run)" : ""}: pushed=${pushedTickers.size} skipped=${skipped} failed=${failed} stale_before=${staleBefore} stale_after=${staleAfter} feeds=${tickers.length}`,
  );
  return { staleAfter };
}

let running = false;
async function safeTick(): Promise<{ staleAfter: number } | undefined> {
  if (running) {
    warn("previous tick still running — skipping this interval");
    return undefined;
  }
  running = true;
  try {
    return await tick();
  } catch (e) {
    console.error(`[${label} ${stamp()}] update failed:`, e instanceof Error ? e.message : e);
    return undefined;
  } finally {
    running = false;
  }
}

async function main() {
  log(
    `${chain.name} (${chain.id}) · ${Object.keys(feeds).length} feeds · updater ${updater} · keeper ${account.address}` +
      ` · heartbeat ${HEARTBEAT_S}s · deviation ${DEVIATION_BPS} bps · staleness ${STALENESS_S}s${DRY_RUN ? " · DRY RUN" : ""}`,
  );
  const first = await safeTick();
  if (ONCE) {
    // Non-zero when a cron/health check should notice: the tick errored or
    // left at least one feed past the on-chain staleness threshold.
    process.exit(first === undefined || first.staleAfter > 0 ? 1 : 0);
  }
  log(`running every ${Math.round(INTERVAL_MS / 1000)}s (Ctrl+C to stop)`);
  setInterval(() => void safeTick(), INTERVAL_MS);
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}

void main();

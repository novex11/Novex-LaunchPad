/**
 * Price keeper for Robinhood Chain Testnet: pushes live market prices into the
 * launchpad's PushPriceFeeds so launches never hit "OracleAdapter: stale".
 *
 * A feed is updated when its price moved by KEEPER_DEVIATION_BPS or its last
 * update is older than KEEPER_HEARTBEAT_SECONDS (on-chain staleness limit is 1h).
 *
 * Usage:
 *   pnpm keeper:testnet          # loop
 *   pnpm keeper:testnet:once     # single update
 *
 * Env: DEPLOYER_PRIVATE_KEY (or KEEPER_PRIVATE_KEY), ROBINHOOD_TESTNET_RPC_URL,
 *      KEEPER_INTERVAL_MS (300000), KEEPER_HEARTBEAT_SECONDS (1500),
 *      KEEPER_DEVIATION_BPS (10)
 */
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadRootEnv } from "./lib/load-env";
import { TESTNET_PRICE_SYMBOLS, fetchUsdPrice, toUsd8 } from "./lib/market-prices";
import deployment from "../packages/config/src/testnet-deployments.json";

loadRootEnv();

const INTERVAL_MS = Number(process.env.KEEPER_INTERVAL_MS ?? 300_000);
const HEARTBEAT_S = BigInt(process.env.KEEPER_HEARTBEAT_SECONDS ?? 1_500);
const DEVIATION_BPS = BigInt(process.env.KEEPER_DEVIATION_BPS ?? 10);
const ONCE = process.argv.includes("--once");

const rawKey = process.env.KEEPER_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY;
if (!rawKey) throw new Error("Set KEEPER_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY in .env");
const account = privateKeyToAccount(`0x${rawKey.replace(/^0x/, "")}` as Hex);

const feeds = deployment.feeds as Record<string, string>;
const updater = deployment.contracts.priceFeedUpdater as Address;
if (!/^0x[0-9a-fA-F]{40}$/.test(updater ?? "")) {
  throw new Error("Testnet launchpad not deployed. Run: pnpm deploy:testnet");
}

const rpcUrl = process.env.ROBINHOOD_TESTNET_RPC_URL || deployment.rpcUrl;
const chain = {
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
} as const;
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
]);
const updaterAbi = parseAbi(["function pushPrices(address[] feeds, int256[] answers)"]);

const stamp = () => new Date().toISOString();

async function tick(): Promise<void> {
  const block = await publicClient.getBlock();
  const toPush: Address[] = [];
  const answers: bigint[] = [];

  for (const [ticker, symbol] of Object.entries(TESTNET_PRICE_SYMBOLS)) {
    const feed = feeds[ticker] as Address | undefined;
    if (!feed) continue;
    let price: bigint;
    try {
      price = toUsd8(await fetchUsdPrice(symbol));
    } catch (e) {
      console.warn(`[keeper ${stamp()}] ${ticker}: price fetch failed — ${(e as Error).message}`);
      continue;
    }
    const [, answer, , updatedAt] = await publicClient.readContract({
      address: feed,
      abi: feedAbi,
      functionName: "latestRoundData",
    });
    const age = block.timestamp - updatedAt;
    const diff = price > answer ? price - answer : answer - price;
    const deviationBps = answer > 0n ? (diff * 10_000n) / answer : 10_000n;
    if (age >= HEARTBEAT_S || deviationBps >= DEVIATION_BPS) {
      toPush.push(feed);
      answers.push(price);
      console.log(
        `[keeper ${stamp()}] ${ticker.padEnd(5)} $${(Number(price) / 1e8).toFixed(2)} (was $${(Number(answer) / 1e8).toFixed(2)}, age ${age}s)`,
      );
    }
  }

  if (toPush.length === 0) {
    console.log(`[keeper ${stamp()}] all feeds fresh`);
    return;
  }

  const { request } = await publicClient.simulateContract({
    account,
    address: updater,
    abi: updaterAbi,
    functionName: "pushPrices",
    args: [toPush, answers],
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`[keeper ${stamp()}] pushed ${toPush.length} feeds · ${receipt.status} · ${hash}`);
}

async function safeTick() {
  try {
    await tick();
  } catch (e) {
    console.error(`[keeper ${stamp()}] update failed:`, e instanceof Error ? e.message : e);
  }
}

async function main() {
  await safeTick();
  if (ONCE) return;
  console.log(`[keeper] running every ${Math.round(INTERVAL_MS / 1000)}s (Ctrl+C to stop)`);
  setInterval(() => void safeTick(), INTERVAL_MS);
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}

void main();

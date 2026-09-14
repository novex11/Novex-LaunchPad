/**
 * Refresh the MockOracle price feeds behind the testnet OracleAdapter.
 *
 * The current testnet deployment (old Deploy.s.sol, addresses in .env) uses
 * `MockOracle` feeds whose `updatedAt` only moves when `setPrice()` is called.
 * OracleAdapter rejects anything older than `stalenessThreshold` (1h), so a
 * few hours after deploy every vault deposit fails with "OracleAdapter: stale"
 * and the web app shows "Cannot determine deposit token price".
 *
 * `pnpm keeper:testnet` cannot help here: it targets PushPriceFeeds listed in
 * packages/config/src/testnet-deployments.json, which is empty for this deploy.
 *
 * Usage:
 *   pnpm feeds:refresh:testnet                 # loop, re-stamp every feed older than HEARTBEAT
 *   pnpm feeds:refresh:testnet --once          # single pass
 *   pnpm feeds:refresh:testnet --dry-run       # read-only report
 *   pnpm feeds:refresh:testnet --threshold 2592000
 *       # also raise oracle.stalenessThreshold (owner only) so feeds stay valid for 30 days
 *
 * Env: DEPLOYER_PRIVATE_KEY (or KEEPER_PRIVATE_KEY), ROBINHOOD_TESTNET_RPC_URL,
 *      KEEPER_INTERVAL_MS (300000), KEEPER_HEARTBEAT_SECONDS (1500)
 */
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadRootEnv } from "./lib/load-env";

loadRootEnv();

const argv = process.argv.slice(2);
const ONCE = argv.includes("--once");
const DRY_RUN = argv.includes("--dry-run");
const thresholdIdx = argv.indexOf("--threshold");
const NEW_THRESHOLD = thresholdIdx >= 0 ? BigInt(argv[thresholdIdx + 1] ?? "0") : 0n;
const INTERVAL_MS = Number(process.env.KEEPER_INTERVAL_MS ?? 300_000);
const HEARTBEAT_S = BigInt(process.env.KEEPER_HEARTBEAT_SECONDS ?? 1_500);

const rpcUrl =
  process.env.ROBINHOOD_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com";
const chain = {
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
} as const;
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

const rawKey = process.env.KEEPER_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY;
if (!rawKey && !DRY_RUN) throw new Error("Set KEEPER_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY in .env");
const account = rawKey ? privateKeyToAccount(`0x${rawKey.replace(/^0x/, "")}` as Hex) : undefined;
const walletClient = account ? createWalletClient({ account, chain, transport: http(rpcUrl) }) : undefined;

/**
 * Current mock deployment on Robinhood Chain Testnet (46630), produced by the
 * old `Deploy.s.sol` (same addresses as NEXT_PUBLIC_ORACLE_ADAPTER_ADDRESS /
 * NEXT_PUBLIC_FACTORY_ADDRESS in .env). Override the oracle with
 * ORACLE_ADAPTER_ADDRESS if you redeploy.
 */
const ORACLE = (process.env.ORACLE_ADAPTER_ADDRESS ??
  process.env.NEXT_PUBLIC_ORACLE_ADAPTER_ADDRESS ??
  "0x17aF1C7892410d419BE9a211831638599bAb535b") as Address;
const tokens: { ticker: string; address: Address }[] = [
  { ticker: "NVDA", address: "0xda49888611F40369D65cE439c93dAb85eD3dcF04" },
  { ticker: "AAPL", address: "0xA3eCf831eD6da9b058E689843D98ffD869AFAb0b" },
  { ticker: "MSFT", address: "0x69cE26371BE50526a9115cD65B7659856C1170B8" },
  { ticker: "SPY", address: "0xB9089C513E38FC9C717E7e36593d93333eA78DBC" },
  { ticker: "QQQ", address: "0x54a755576eFf9aC9Ed1250e34e2792cfdd602D5b" },
  { ticker: "GOOGL", address: "0xbdBDf97fe07d1fb9593c0f700d38ED76174A2DE3" },
  { ticker: "AMZN", address: "0x1be34265bbd154109a79175aB9EcF4d3E09F9aC5" },
  { ticker: "TSLA", address: "0x538C10dC06450819E8E9eb552c87bF17cFBab702" },
  { ticker: "SNDK", address: "0x2df262a920bF91853694a29DEaE1eAf36b8726eB" },
  { ticker: "USDG", address: "0xe5F00A9e04eD6D86Dc53BFcD8dE4BaD22e4fe5E4" },
  { ticker: "EURUSD", address: "0x895B0D493F97904f1C17C8aE11AA6f9Fe0E9ad95" },
  { ticker: "GBPUSD", address: "0x273Cb738FE4eF162BCDFb603c89DA224e1b67b0E" },
  { ticker: "AUDUSD", address: "0x00386a9076dEC1873668682610c0117AfaA87bc4" },
  { ticker: "NZDUSD", address: "0xA28AEa69fb5EFA7CC9fef4DC3178f443f19174B6" },
  { ticker: "USDCAD", address: "0xC18f28d7258459bc1cdF705895e096bE9D7DF906" },
  { ticker: "USDCHF", address: "0x6ac3c7A91b8417CD58A0a109a3d9Bc2344685848" },
  { ticker: "WRHT", address: "0xD9Ad96aD45c8ffe1C6ee019f0D48F11cfdCE9553" },
];

const oracleAbi = parseAbi([
  "function priceFeeds(address) view returns (address)",
  "function stalenessThreshold() view returns (uint256)",
  "function owner() view returns (address)",
  "function setStalenessThreshold(uint256)",
]);
const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function setPrice(int256)",
]);
const ZERO = "0x0000000000000000000000000000000000000000";
const stamp = () => new Date().toISOString();

async function maybeRaiseThreshold(): Promise<void> {
  if (NEW_THRESHOLD <= 0n) return;
  const current = await publicClient.readContract({ address: ORACLE, abi: oracleAbi, functionName: "stalenessThreshold" });
  if (current === NEW_THRESHOLD) return;
  const owner = await publicClient.readContract({ address: ORACLE, abi: oracleAbi, functionName: "owner" });
  if (!account || owner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`--threshold needs the oracle owner key (${owner}); signer is ${account?.address ?? "none"}`);
  }
  console.log(`[feeds ${stamp()}] stalenessThreshold ${current}s -> ${NEW_THRESHOLD}s`);
  if (DRY_RUN || !walletClient) return;
  const hash = await walletClient.writeContract({ address: ORACLE, abi: oracleAbi, functionName: "setStalenessThreshold", args: [NEW_THRESHOLD] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`[feeds ${stamp()}] threshold updated · ${receipt.status} · ${hash}`);
}

async function tick(): Promise<void> {
  const block = await publicClient.getBlock();
  const threshold = await publicClient.readContract({ address: ORACLE, abi: oracleAbi, functionName: "stalenessThreshold" });
  let refreshed = 0;
  for (const { ticker, address } of tokens) {
    const feed = await publicClient.readContract({ address: ORACLE, abi: oracleAbi, functionName: "priceFeeds", args: [address] });
    if (feed === ZERO) {
      console.log(`[feeds ${stamp()}] ${ticker.padEnd(6)} no feed registered`);
      continue;
    }
    const [, answer, , updatedAt] = await publicClient.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" });
    const age = block.timestamp - updatedAt;
    const stale = age > threshold;
    if (age < HEARTBEAT_S) continue;
    console.log(
      `[feeds ${stamp()}] ${ticker.padEnd(6)} $${(Number(answer) / 1e8).toFixed(2)} age ${age}s${stale ? " STALE" : ""} -> refresh`,
    );
    if (DRY_RUN || !walletClient) continue;
    const hash = await walletClient.writeContract({ address: feed, abi: feedAbi, functionName: "setPrice", args: [answer] });
    await publicClient.waitForTransactionReceipt({ hash });
    refreshed++;
  }
  console.log(`[feeds ${stamp()}] ${DRY_RUN ? "dry run · " : ""}refreshed ${refreshed}/${tokens.length} feeds (threshold ${threshold}s)`);
}

async function safeTick() {
  try {
    await tick();
  } catch (e) {
    console.error(`[feeds ${stamp()}] update failed:`, e instanceof Error ? e.message : e);
  }
}

async function main() {
  await maybeRaiseThreshold();
  await safeTick();
  if (ONCE || DRY_RUN) return;
  console.log(`[feeds] running every ${Math.round(INTERVAL_MS / 1000)}s (Ctrl+C to stop)`);
  setInterval(() => void safeTick(), INTERVAL_MS);
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}

void main();

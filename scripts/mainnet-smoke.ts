/**
 * Read-only smoke check of the mainnet stack: for every manifest token verifies
 * the oracle feed, launchpad listing, basket approvals and the Balanced vault.
 *
 *   pnpm smoke:mainnet
 *   tsx scripts/mainnet-smoke.ts --rpc http://127.0.0.1:8546 --config packages/contracts/broadcast/fork/mainnet-deployments.synced.json \
 *       --baskets packages/contracts/broadcast/fork/deployments-mainnet-baskets.json
 *
 * Addresses come from packages/config/src/mainnet-deployments.json unless
 * --config points elsewhere; the RPC is --rpc, ROBINHOOD_RPC_URL or the config's rpcUrl.
 * The basket stack is also cross-checked against deployments-mainnet-baskets.json
 * (--baskets, default packages/contracts/deployments-mainnet-baskets.json) and each
 * of its contracts must answer on-chain.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createPublicClient, encodeAbiParameters, http, keccak256, parseAbi, zeroAddress, type Address } from "viem";
import { loadRootEnv } from "./lib/load-env";

loadRootEnv();

const ROOT = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

interface Deployment {
  chainId: number;
  rpcUrl: string;
  feeds: Record<string, string>;
  contracts: Record<string, string>;
  vaults?: Record<string, { vault: string; receipt: string }>;
}
interface ManifestToken {
  ticker: string;
  address: Address;
  category: string;
}

const configPath = resolve(ROOT, flag("--config") ?? "packages/config/src/mainnet-deployments.json");
const deployment = JSON.parse(readFileSync(configPath, "utf8")) as Deployment;
const manifest = JSON.parse(readFileSync(join(ROOT, "packages/config/src/mainnet-manifest.json"), "utf8")) as {
  tokens: ManifestToken[];
};
const rpcUrl = flag("--rpc") ?? process.env.ROBINHOOD_RPC_URL ?? deployment.rpcUrl;

const USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const WETH: Address = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const BALANCED = 1; // AllocationController.Strategy.Balanced

const isAddress = (v: string | undefined): v is Address => /^0x[0-9a-fA-F]{40}$/.test(v ?? "");
const c = deployment.contracts;
for (const key of ["oracle", "pairFactory", "allocationController", "executionRouter", "vaultFactory"]) {
  if (!isAddress(c[key])) {
    console.error(`❌  contracts.${key} missing in ${configPath} (run pnpm sync:mainnet)`);
    process.exit(1);
  }
}
const oracle = c.oracle as Address;
const pairFactory = c.pairFactory as Address;
const controller = c.allocationController as Address;
const execRouter = c.executionRouter as Address;
const vaultFactory = c.vaultFactory as Address;

// The baskets record must agree with the synced config.
const BASKET_KEYS = ["allocationController", "cashbackReserve", "swapAdapter", "executionRouter", "vaultFactory"] as const;
const basketsPath = resolve(ROOT, flag("--baskets") ?? "packages/contracts/deployments-mainnet-baskets.json");
const basketsRecord = existsSync(basketsPath)
  ? ((JSON.parse(readFileSync(basketsPath, "utf8")) as { contracts?: Record<string, string> }).contracts ?? {})
  : undefined;
if (!basketsRecord) console.warn(`⚠️   ${basketsPath} not found; skipping the baskets-record cross-check`);

const chain = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
} as const;
const client = createPublicClient({ chain, transport: http(rpcUrl, { batch: { batchSize: 40 } }) });

const oracleAbi = parseAbi(["function hasFeed(address) view returns (bool)"]);
const factoryAbi = parseAbi([
  "function isListed(address) view returns (bool)",
  "function poolQuoteToken() view returns (address)",
  "function oracle() view returns (address)",
]);
const controllerAbi = parseAbi(["function approvedAssets(address) view returns (bool)"]);
const execRouterAbi = parseAbi([
  "function approvedTokens(address) view returns (bool)",
  "function authorizedCallers(address) view returns (bool)",
  "function swapRouter() view returns (address)",
  "function emergency() view returns (address)",
]);
const vaultFactoryAbi = parseAbi([
  "function vaultByKey(bytes32) view returns (address)",
  "function vaultCount() view returns (uint256)",
  "function usdStableAsset() view returns (address)",
  "function oracle() view returns (address)",
  "function controller() view returns (address)",
  "function cashbackReserve() view returns (address)",
  "function emergency() view returns (address)",
  "function executionRouter() view returns (address)",
]);
const adapterAbi = parseAbi(["function authorizedCallers(address) view returns (bool)"]);
const cashbackAbi = parseAbi(["function paused() view returns (bool)", "function budgetRemaining() view returns (uint256)"]);
const ownableAbi = parseAbi(["function owner() view returns (address)"]);
const eq = (a: string | undefined, b: string | undefined) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

const vaultKey = (asset: Address) =>
  keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint8" }], [asset, BALANCED]));

interface Row {
  ticker: string;
  feed: boolean;
  listed: boolean;
  approved: boolean;
  execApproved: boolean;
  vault: Address;
  vaultAuthorized: boolean;
}

async function checkToken(t: ManifestToken): Promise<Row> {
  const [feed, listed, approved, execApproved, vault] = await Promise.all([
    client.readContract({ address: oracle, abi: oracleAbi, functionName: "hasFeed", args: [t.address] }),
    client.readContract({ address: pairFactory, abi: factoryAbi, functionName: "isListed", args: [t.address] }),
    client.readContract({ address: controller, abi: controllerAbi, functionName: "approvedAssets", args: [t.address] }),
    client.readContract({ address: execRouter, abi: execRouterAbi, functionName: "approvedTokens", args: [t.address] }),
    client.readContract({ address: vaultFactory, abi: vaultFactoryAbi, functionName: "vaultByKey", args: [vaultKey(t.address)] }),
  ]);
  const vaultAuthorized =
    vault !== zeroAddress
      ? await client.readContract({ address: execRouter, abi: execRouterAbi, functionName: "authorizedCallers", args: [vault] })
      : false;
  return { ticker: t.ticker, feed, listed, approved, execApproved, vault, vaultAuthorized };
}

async function main() {
  const chainId = await client.getChainId();
  console.log(`\nMainnet smoke check · chain ${chainId} · ${rpcUrl}\n  config ${configPath}\n`);
  if (chainId !== 4663) throw new Error(`RPC chain ${chainId} is not Robinhood Chain (4663)`);

  // Core wiring
  const [usdgFeed, wethFeed, wethListed, quote, usdStable, execSwapRouter, execEmergency, vaultCount] = await Promise.all([
    client.readContract({ address: oracle, abi: oracleAbi, functionName: "hasFeed", args: [USDG] }),
    client.readContract({ address: oracle, abi: oracleAbi, functionName: "hasFeed", args: [WETH] }),
    client.readContract({ address: pairFactory, abi: factoryAbi, functionName: "isListed", args: [WETH] }),
    client.readContract({ address: pairFactory, abi: factoryAbi, functionName: "poolQuoteToken" }),
    client.readContract({ address: vaultFactory, abi: vaultFactoryAbi, functionName: "usdStableAsset" }),
    client.readContract({ address: execRouter, abi: execRouterAbi, functionName: "swapRouter" }),
    client.readContract({ address: execRouter, abi: execRouterAbi, functionName: "emergency" }),
    client.readContract({ address: vaultFactory, abi: vaultFactoryAbi, functionName: "vaultCount" }),
  ]);
  const adapterAuthorized = isAddress(c.swapAdapter)
    ? await client.readContract({ address: c.swapAdapter as Address, abi: adapterAbi, functionName: "authorizedCallers", args: [execRouter] })
    : false;
  const core: [string, boolean][] = [
    ["USDG feed", usdgFeed],
    ["WETH feed", wethFeed],
    ["WETH listed", wethListed],
    ["pool quote = USDG", eq(quote, USDG)],
    ["vault stable = USDG", eq(usdStable, USDG)],
    ["execRouter → swapAdapter", eq(execSwapRouter, c.swapAdapter)],
    ["swapAdapter authorizes execRouter", adapterAuthorized],
    ["execRouter emergency set", eq(execEmergency, c.emergency)],
  ];
  console.log("Core:");
  for (const [label, ok] of core) console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  console.log(`  vaults on-chain: ${vaultCount}\n`);

  // Basket stack: every contract in the baskets record answers and is wired to the launchpad.
  const oracleOwner = await client.readContract({ address: oracle, abi: ownableAbi, functionName: "owner" });
  const [vfOracle, vfController, vfCashback, vfEmergency, vfExecRouter, usdgApproved, wethApproved, usdgExecApproved, wethExecApproved, cashbackPaused] =
    await Promise.all([
      client.readContract({ address: vaultFactory, abi: vaultFactoryAbi, functionName: "oracle" }),
      client.readContract({ address: vaultFactory, abi: vaultFactoryAbi, functionName: "controller" }),
      client.readContract({ address: vaultFactory, abi: vaultFactoryAbi, functionName: "cashbackReserve" }),
      client.readContract({ address: vaultFactory, abi: vaultFactoryAbi, functionName: "emergency" }),
      client.readContract({ address: vaultFactory, abi: vaultFactoryAbi, functionName: "executionRouter" }),
      client.readContract({ address: controller, abi: controllerAbi, functionName: "approvedAssets", args: [USDG] }),
      client.readContract({ address: controller, abi: controllerAbi, functionName: "approvedAssets", args: [WETH] }),
      client.readContract({ address: execRouter, abi: execRouterAbi, functionName: "approvedTokens", args: [USDG] }),
      client.readContract({ address: execRouter, abi: execRouterAbi, functionName: "approvedTokens", args: [WETH] }),
      client.readContract({ address: c.cashbackReserve as Address, abi: cashbackAbi, functionName: "paused" }),
    ]);
  const basketOwners = await Promise.all(
    BASKET_KEYS.map((key) => client.readContract({ address: c[key] as Address, abi: ownableAbi, functionName: "owner" })),
  );
  const baskets: [string, boolean][] = [
    ...BASKET_KEYS.map((key, i): [string, boolean] => [`${key} owned by launchpad owner`, eq(basketOwners[i], oracleOwner)]),
    ...(basketsRecord ? BASKET_KEYS.map((key): [string, boolean] => [`${key} matches baskets record`, eq(c[key], basketsRecord[key])]) : []),
    ["vaultFactory → launchpad oracle", eq(vfOracle, oracle)],
    ["vaultFactory → controller", eq(vfController, controller)],
    ["vaultFactory → cashbackReserve", eq(vfCashback, c.cashbackReserve)],
    ["vaultFactory → emergency", eq(vfEmergency, c.emergency)],
    ["vaultFactory → executionRouter", eq(vfExecRouter, execRouter)],
    ["controller approves USDG + WETH", usdgApproved && wethApproved],
    ["execRouter approves USDG + WETH", usdgExecApproved && wethExecApproved],
    ["cashbackReserve not paused", !cashbackPaused],
  ];
  console.log("Baskets:");
  for (const [label, ok] of baskets) console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  console.log("");
  core.push(...baskets);

  // Per-token checks in chunks
  const rows: Row[] = [];
  const CHUNK = 8;
  for (let i = 0; i < manifest.tokens.length; i += CHUNK) {
    const chunk = manifest.tokens.slice(i, i + CHUNK);
    rows.push(...(await Promise.all(chunk.map(checkToken))));
    process.stdout.write(`\r  checked ${Math.min(i + CHUNK, manifest.tokens.length)}/${manifest.tokens.length}`);
  }
  process.stdout.write("\n\n");

  // Vaults are created for a chosen set of deposit assets (the rest on demand),
  // so a vault is only required where the synced config lists one.
  const configVaults = deployment.vaults ?? {};
  const vaultRows = rows.filter((r) => r.ticker in configVaults);
  const missing = (from: Row[], pick: (r: Row) => boolean) => from.filter((r) => !pick(r)).map((r) => r.ticker);
  const report: [string, string[], number][] = [
    ["oracle feed", missing(rows, (r) => r.feed), rows.length],
    ["launchpad listing", missing(rows, (r) => r.listed), rows.length],
    ["controller approval", missing(rows, (r) => r.approved), rows.length],
    ["execRouter approval", missing(rows, (r) => r.execApproved), rows.length],
    ["Balanced vault (configured)", missing(vaultRows, (r) => r.vault !== zeroAddress && eq(r.vault, configVaults[r.ticker]?.vault)), vaultRows.length],
    ["vault authorized on execRouter", missing(vaultRows, (r) => r.vaultAuthorized), vaultRows.length],
  ];
  const onChainVaults = rows.filter((r) => r.vault !== zeroAddress).length;
  console.log(
    `Tokens: ${rows.length} in manifest · ${Object.keys(deployment.feeds).length} feeds in config · ${Object.keys(configVaults).length} vaults in config · ${onChainVaults} Balanced vaults on-chain (others on demand)`,
  );
  let failures = core.filter(([, ok]) => !ok).length;
  for (const [label, tickers, total] of report) {
    const ok = total - tickers.length;
    console.log(`  ${tickers.length === 0 ? "✓" : "✗"} ${label.padEnd(32)} ${ok}/${total}${tickers.length ? `  missing: ${tickers.join(", ")}` : ""}`);
    failures += tickers.length;
  }
  console.log("");
  if (failures) {
    console.log(`❌  ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("✅  All checks passed");
}

main().catch((e) => {
  console.error("\nSmoke check failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

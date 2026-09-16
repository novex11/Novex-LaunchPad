#!/usr/bin/env node
/**
 * Merges the mainnet deployment records
 *   packages/contracts/deployments-mainnet-launchpad.json  (DeployMainnetLaunchpad — live, authoritative)
 *   <dir>/deployments-mainnet-baskets.json                 (DeployMainnetBaskets)
 *   <dir>/deployments-mainnet-feeds.json                   (OnboardMainnetTokens)
 *   <dir>/deployments-mainnet-vaults.json                  (CreateMainnetVaults)
 * into packages/config/src/mainnet-deployments.json (MainnetDeployment in
 * packages/config/src/mainnet.ts) and points .env at the mainnet stack.
 *
 *   node scripts/sync-mainnet-deployments.mjs                  # real sync (config + .env)
 *   node scripts/sync-mainnet-deployments.mjs --dry            # write <dir>/mainnet-deployments.synced.json only
 *   --dir <path>        directory holding the baskets/feeds/vaults files (default packages/contracts)
 *   --out <path>        output path for --dry (default <dir>/mainnet-deployments.synced.json)
 *   --launchpad <path>  launchpad json (default packages/contracts/deployments-mainnet-launchpad.json)
 *   --launchpad-broadcast <path>
 *                       DeployMainnetLaunchpad run-latest.json used for startBlock
 *                       (default packages/contracts/broadcast/DeployMainnetLaunchpad.s.sol/4663/run-latest.json)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
};
const dry = args.includes("--dry");
const dir = resolve(root, flag("--dir") ?? "packages/contracts");
const configPath = join(root, "packages/config/src/mainnet-deployments.json");
const outPath = dry ? resolve(root, flag("--out") ?? join(dir, "mainnet-deployments.synced.json")) : configPath;
const envPath = join(root, ".env");
const launchpadPath = resolve(root, flag("--launchpad") ?? "packages/contracts/deployments-mainnet-launchpad.json");
const launchpadBroadcastPath = resolve(
  root,
  flag("--launchpad-broadcast") ?? "packages/contracts/broadcast/DeployMainnetLaunchpad.s.sol/4663/run-latest.json",
);
const basketsPath = join(dir, "deployments-mainnet-baskets.json");
const feedsPath = join(dir, "deployments-mainnet-feeds.json");
const vaultsPath = join(dir, "deployments-mainnet-vaults.json");

if (!existsSync(launchpadPath)) {
  console.error(`❌  ${launchpadPath} not found (the live launchpad deployment record)`);
  process.exit(1);
}

const asObject = (v) => (typeof v === "string" ? JSON.parse(v) : (v ?? {}));
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {});
const isAddress = (v) => /^0x[0-9a-fA-F]{40}$/.test(v ?? "");
const sortKeys = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

const launchpad = readJson(launchpadPath);
const lp = asObject(launchpad.contracts);
const launchpadFeeds = asObject(launchpad.feeds);
if (Number(launchpad.chainId) !== 4663 || !isAddress(lp.pairFactory) || !isAddress(lp.oracle)) {
  console.error(`❌  ${launchpadPath} is not a chain-4663 launchpad record`);
  process.exit(1);
}

const baskets = asObject(readJson(basketsPath).contracts);
if (!existsSync(basketsPath)) console.warn(`⚠️   ${basketsPath} not found; basket addresses stay empty`);
const onboardFeeds = asObject(readJson(feedsPath));
const rawVaults = asObject(readJson(vaultsPath));

// Launchpad feeds are authoritative for their tickers; the onboard file adds the rest.
const feeds = sortKeys({ ...onboardFeeds, ...launchpadFeeds });
const vaults = sortKeys(
  Object.fromEntries(
    Object.entries(rawVaults).map(([ticker, v]) => {
      const o = asObject(v);
      return [ticker, { vault: o.vault ?? "", receipt: o.receipt ?? "" }];
    }),
  ),
);

// block.number inside forge scripts is the parent-chain block on Arbitrum
// Orbit chains; the launchpad's real L2 deployment block comes from its receipts.
const previous = readJson(configPath);
let startBlock = Number(launchpad.startBlock ?? previous.startBlock ?? 0);
if (existsSync(launchpadBroadcastPath)) {
  const receipts = JSON.parse(readFileSync(launchpadBroadcastPath, "utf8")).receipts ?? [];
  const blocks = receipts.map((r) => parseInt(r.blockNumber, 16)).filter(Number.isFinite);
  if (blocks.length) startBlock = Math.min(...blocks);
} else {
  console.warn(`⚠️   ${launchpadBroadcastPath} not found; startBlock stays ${startBlock}`);
}

const addr = (v) => (isAddress(v) ? v : "");
const config = {
  chainId: 4663,
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  startBlock,
  feeds,
  contracts: {
    pairFactory: addr(lp.pairFactory),
    oracle: addr(lp.oracle),
    emergency: addr(lp.emergency),
    priceFeedUpdater: addr(lp.priceFeedUpdater),
    pairDeployer: addr(lp.pairDeployer),
    pairRouter: addr(lp.pairRouter),
    swapRouter: addr(lp.swapRouter),
    usdg: addr(lp.usdg) || "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    usdgFeed: addr(feeds.USDG),
    // Older launchpad records used the pre-rebrand key.
    composeCurve: addr(lp.composeCurve ?? lp.novexCurve),
    curveRouter: addr(lp.curveRouter),
    ponsFactory: addr(lp.ponsFactory),
    ponsLauncher: addr(lp.ponsLauncher),
    ponsRouter: addr(lp.ponsRouter),
    allocationController: addr(baskets.allocationController),
    cashbackReserve: addr(baskets.cashbackReserve),
    executionRouter: addr(baskets.executionRouter),
    swapAdapter: addr(baskets.swapAdapter),
    vaultFactory: addr(baskets.vaultFactory),
  },
  vaults,
  syncedAt: new Date().toISOString(),
};

writeFileSync(outPath, JSON.stringify(config, null, 2) + "\n");
console.log(`✅  ${dry ? "Dry run: wrote" : "Updated"} ${outPath}`);

if (!dry && existsSync(envPath)) {
  let env = readFileSync(envPath, "utf8");
  const set = (key, val) => {
    if (!val) return; // never blank an existing value
    const re = new RegExp(`^${key}=.*$`, "m");
    const line = `${key}=${val}`;
    env = re.test(env) ? env.replace(re, line) : env + `\n${line}`;
  };
  const weth = asObject(launchpad.tokens).WETH ?? "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";

  set("NEXT_PUBLIC_USE_TESTNET", "false");
  set("NEXT_PUBLIC_PAIR_FACTORY_ADDRESS", config.contracts.pairFactory);
  set("PAIR_FACTORY_ADDRESS", config.contracts.pairFactory);
  set("NEXT_PUBLIC_ORACLE_ADAPTER_ADDRESS", config.contracts.oracle);
  set("NEXT_PUBLIC_PAIR_ROUTER_ADDRESS", config.contracts.pairRouter);
  set("NEXT_PUBLIC_COMPOSE_CURVE_ADDRESS", config.contracts.composeCurve);
  set("NEXT_PUBLIC_CURVE_ROUTER_ADDRESS", config.contracts.curveRouter);
  set("NEXT_PUBLIC_FACTORY_ADDRESS", config.contracts.vaultFactory);
  set("NEXT_PUBLIC_USDG_ADDRESS", config.contracts.usdg);
  set("NEXT_PUBLIC_WETH_ADDRESS", weth);
  set("NEXT_PUBLIC_UNISWAP_V3_ROUTER", config.contracts.swapRouter);
  set("INDEXER_START_BLOCK", String(config.startBlock));
  set("NEXT_PUBLIC_EXPLORER_URL", "https://robinhoodchain.blockscout.com");
  if (!env.endsWith("\n")) env += "\n";
  writeFileSync(envPath, env);
  console.log("✅  Updated .env with mainnet addresses");
} else if (dry) {
  console.log("ℹ️   Dry run: config and .env left untouched");
}

console.log("\n📋  Mainnet stack (chain 4663):");
const row = (label, value) => console.log(`   ${label.padEnd(22)} ${value || "-"}`);
row("PairFactory:", config.contracts.pairFactory);
row("OracleAdapter:", config.contracts.oracle);
row("EmergencyRegistry:", config.contracts.emergency);
row("PriceFeedUpdater:", config.contracts.priceFeedUpdater);
row("PairRouter:", config.contracts.pairRouter);
row("ComposeCurve:", config.contracts.composeCurve);
row("CurveRouter:", config.contracts.curveRouter);
row("AllocationController:", config.contracts.allocationController);
row("CashbackReserve:", config.contracts.cashbackReserve);
row("ExecutionRouter:", config.contracts.executionRouter);
row("UniswapV3SwapAdapter:", config.contracts.swapAdapter);
row("VaultFactory:", config.contracts.vaultFactory);
row("USDG / feed:", `${config.contracts.usdg} / ${config.contracts.usdgFeed}`);
row("Feeds:", `${Object.keys(feeds).length} (${Object.keys(launchpadFeeds).length} from launchpad)`);
row("Vaults:", String(Object.keys(vaults).length));
row("Start block:", String(config.startBlock));

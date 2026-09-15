#!/usr/bin/env node
/**
 * Reads packages/contracts/deployments-testnet.json (written by DeployTestnet)
 * and syncs addresses into:
 *   - packages/config/src/testnet-deployments.json
 *   - .env (testnet launchpad vars; clears addresses left from the old mock deploy)
 */
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const deployPath = join(root, "packages/contracts/deployments-testnet.json");
const configPath = join(root, "packages/config/src/testnet-deployments.json");
const envPath = join(root, ".env");

if (!existsSync(deployPath)) {
  console.error("❌  deployments-testnet.json not found. Run: pnpm deploy:testnet");
  process.exit(1);
}

const asObject = (v) => (typeof v === "string" ? JSON.parse(v) : (v ?? {}));
const d = JSON.parse(readFileSync(deployPath, "utf8"));
const tokens = asObject(d.tokens);
const feeds = asObject(d.feeds);
const contracts = asObject(d.contracts);

// block.number inside forge scripts is the parent-chain block on Arbitrum
// Orbit chains; take the real L2 deployment block from the broadcast receipts.
let startBlock = Number(d.startBlock ?? 0);
const broadcastPath = join(root, "packages/contracts/broadcast/DeployTestnet.s.sol/46630/run-latest.json");
if (existsSync(broadcastPath)) {
  const receipts = JSON.parse(readFileSync(broadcastPath, "utf8")).receipts ?? [];
  const blocks = receipts.map((r) => parseInt(r.blockNumber, 16)).filter(Number.isFinite);
  if (blocks.length) startBlock = Math.min(...blocks);
}

const config = {
  chainId: Number(d.chainId ?? 46630),
  rpcUrl: "https://rpc.testnet.chain.robinhood.com",
  startBlock,
  tokens,
  feeds,
  contracts: {
    pairFactory: contracts.pairFactory ?? "",
    oracle: contracts.oracle ?? "",
    emergency: contracts.emergency ?? "",
    priceFeedUpdater: contracts.priceFeedUpdater ?? "",
    pairRouter: "",
    swapRouter: "",
    usdg: "",
    usdgFeed: "",
    composeCurve: "",
    curveRouter: "",
  },
  syncedAt: new Date().toISOString(),
};

// DeployTestnetRouter (USDG/ETH buy & sell) deploys a newer PairFactory on the
// same oracle. Only apply it if it is newer than the base deployment.
const routerPath = join(root, "packages/contracts/deployments-testnet-router.json");
if (existsSync(routerPath) && statSync(routerPath).mtimeMs >= statSync(deployPath).mtimeMs) {
  const r = JSON.parse(readFileSync(routerPath, "utf8"));
  config.contracts.pairFactory = r.pairFactory;
  config.contracts.pairRouter = r.pairRouter;
  config.contracts.swapRouter = r.swapRouter;
  config.contracts.usdg = r.usdg;
  config.contracts.usdgFeed = r.usdgFeed;
  const routerBroadcast = join(root, "packages/contracts/broadcast/DeployTestnetRouter.s.sol/46630/run-latest.json");
  if (existsSync(routerBroadcast)) {
    const receipts = JSON.parse(readFileSync(routerBroadcast, "utf8")).receipts ?? [];
    const blocks = receipts.map((rc) => parseInt(rc.blockNumber, 16)).filter(Number.isFinite);
    if (blocks.length) config.startBlock = Math.min(...blocks);
  }
}

// DeployTestnetCurve (bonding curve) deploys a newer PairFactory + PairRouter
// with transferable pair shares; apply it when it is the most recent deployment.
const curvePath = join(root, "packages/contracts/deployments-testnet-curve.json");
const newestOther = Math.max(
  statSync(deployPath).mtimeMs,
  existsSync(routerPath) ? statSync(routerPath).mtimeMs : 0,
);
if (existsSync(curvePath) && statSync(curvePath).mtimeMs >= newestOther) {
  const cv = JSON.parse(readFileSync(curvePath, "utf8"));
  config.contracts.pairFactory = cv.pairFactory;
  config.contracts.pairRouter = cv.pairRouter;
  config.contracts.composeCurve = cv.composeCurve;
  config.contracts.curveRouter = cv.curveRouter;
  const curveBroadcast = join(root, "packages/contracts/broadcast/DeployTestnetCurve.s.sol/46630/run-latest.json");
  if (existsSync(curveBroadcast)) {
    const receipts = JSON.parse(readFileSync(curveBroadcast, "utf8")).receipts ?? [];
    const blocks = receipts.map((rc) => parseInt(rc.blockNumber, 16)).filter(Number.isFinite);
    if (blocks.length) config.startBlock = Math.min(...blocks);
  }
}

writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
console.log("✅  Updated", configPath);

if (existsSync(envPath)) {
  let env = readFileSync(envPath, "utf8");
  const set = (key, val) => {
    const re = new RegExp(`^${key}=.*$`, "m");
    const line = `${key}=${val}`;
    env = re.test(env) ? env.replace(re, line) : env + `\n${line}`;
  };

  set("NEXT_PUBLIC_USE_TESTNET", "true");
  set("NEXT_PUBLIC_PAIR_FACTORY_ADDRESS", config.contracts.pairFactory);
  set("PAIR_FACTORY_ADDRESS", config.contracts.pairFactory);
  set("NEXT_PUBLIC_ORACLE_ADAPTER_ADDRESS", config.contracts.oracle);
  set("INDEXER_START_BLOCK", String(config.startBlock));
  // Old mock deployment (USDG/Zap/mock vaults) and the mainnet WETH address do
  // not exist on testnet; leaving them set breaks testnet reads.
  for (const key of [
    "NEXT_PUBLIC_LAUNCHPAD_ZAP_ADDRESS",
    "NEXT_PUBLIC_USDG_ADDRESS",
    "NEXT_PUBLIC_WETH_ADDRESS",
    "NEXT_PUBLIC_UNISWAP_V3_ROUTER",
    "NEXT_PUBLIC_FACTORY_ADDRESS",
    "NEXT_PUBLIC_VAULT_ADDRESS",
    "NEXT_PUBLIC_RECEIPT_TOKEN_ADDRESS",
    "VAULT_CONTRACT_ADDRESS",
    "RECEIPT_TOKEN_CONTRACT_ADDRESS",
  ]) {
    if (new RegExp(`^${key}=`, "m").test(env)) set(key, "");
  }

  writeFileSync(envPath, env);
  console.log("✅  Updated .env with testnet launchpad addresses");
}

console.log("\n📋  Testnet launchpad:");
console.log("   PairFactory:      ", config.contracts.pairFactory);
console.log("   OracleAdapter:    ", config.contracts.oracle);
console.log("   PriceFeedUpdater: ", config.contracts.priceFeedUpdater);
if (config.contracts.pairRouter) {
  console.log("   PairRouter:       ", config.contracts.pairRouter);
  console.log("   SwapRouter (test):", config.contracts.swapRouter);
  console.log("   TestUSDG:         ", config.contracts.usdg);
}
console.log("   Start block:      ", config.startBlock);
console.log("\n   Restart dev servers: pnpm dev:testnet");

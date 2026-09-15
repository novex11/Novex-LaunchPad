/**
 * Verifies, on the block explorer, the two implementation contracts every
 * launched pair and token delegates to (PairVault, CreatorToken) and then
 * reports the explorer status of every launched pair and curve token.
 *
 * Launched contracts are EIP-1167 minimal proxies: the explorer resolves them to
 * the implementation and shows them as verified — name, symbol, ABI, source —
 * the moment they exist. So nothing is ever submitted per launch; only these
 * two, once per deployment. Safe to re-run.
 *
 * Usage: pnpm verify:implementations            (testnet, 46630)
 *        pnpm verify:implementations:mainnet    (mainnet, 4663)
 *
 * Mainnet's explorer API sits behind bot protection that refuses non-browser
 * clients; when that happens the script prints the addresses to verify from the
 * explorer's "Verify & publish" page (standard JSON input, no constructor args).
 */
import {
  createPublicClient,
  http,
  parseAbi,
  type Address,
  type PublicClient,
} from "viem";
import { join } from "node:path";
import { loadRootEnv } from "./lib/load-env";
import testnetDeployment from "../packages/config/src/testnet-deployments.json";
import mainnetDeployment from "../packages/config/src/mainnet-deployments.json";
import {
  launchedContractStatus,
  verifyLaunchImplementations,
} from "../services/indexer/src/contract-verifier";

loadRootEnv();

const MAINNET = process.argv.includes("--mainnet");
const deployment = MAINNET ? mainnetDeployment : testnetDeployment;
const chainId = MAINNET ? 4663 : 46630;
const rpcUrl =
  (MAINNET
    ? process.env.ROBINHOOD_RPC_URL
    : process.env.ROBINHOOD_TESTNET_RPC_URL) || deployment.rpcUrl;
const explorerUrl = MAINNET
  ? "https://robinhoodchain.blockscout.com"
  : "https://explorer.testnet.chain.robinhood.com";
const explorerApiUrl = (
  process.env.EXPLORER_API_URL || `${explorerUrl}/api`
).replace(/\/$/, "");
const factory = deployment.contracts.pairFactory as Address;
const curve = (deployment.contracts.composeCurve || undefined) as
  Address | undefined;

const factoryAbi = parseAbi([
  "function pairCount() view returns (uint256)",
  "function pairs(uint256) view returns (address pair, address receiptToken, address tokenA, address tokenB, uint16 weightABps, uint16 creatorFeeBps, address creator)",
]);
const curveAbi = parseAbi([
  "function tokenCount() view returns (uint256)",
  "function allTokens(uint256) view returns (address)",
]);

function describe(status: {
  verified: boolean;
  implementation: Address | null;
}) {
  const state = status.verified ? "verified ✅" : "not verified";
  const note = status.implementation
    ? ""
    : "  (not a clone: launched before the clone upgrade)";
  return `${state}${note}`;
}

async function main() {
  const client = createPublicClient({
    chain: {
      id: chainId,
      name: MAINNET ? "Robinhood Chain" : "Robinhood Chain Testnet",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    transport: http(rpcUrl),
  }) as PublicClient;

  console.log(
    `Factory ${factory}${curve ? `, curve ${curve}` : ""} on ${explorerApiUrl}\n`,
  );
  const { implementations, outcomes } = await verifyLaunchImplementations(
    client,
    {
      explorerApiUrl,
      inputsDir: join(process.cwd(), "services/indexer/verification"),
      log: (m: string) => console.log(`  … ${m}`),
    },
    { factory, curve },
  );

  let failed = 0;
  for (const name of ["PairVault", "CreatorToken"] as const) {
    const address = implementations[name];
    if (!address) continue;
    console.log(`  ${name.padEnd(13)} ${address}  ${outcomes[name]}`);
    if (outcomes[name] === "failed" || outcomes[name] === "skipped") failed++;
  }

  console.log("\nLaunched contracts (EIP-1167 clones):");
  const pairCount = await client.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "pairCount",
  });
  let unverified = 0;
  for (let i = 0n; i < pairCount; i++) {
    const info = await client.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: "pairs",
      args: [i],
    });
    const status = await launchedContractStatus(
      client,
      explorerApiUrl,
      info[0],
    );
    if (!status.verified) unverified++;
    console.log(`  vault  ${info[0]}  ${describe(status)}`);
  }
  if (curve) {
    const tokenCount = await client.readContract({
      address: curve,
      abi: curveAbi,
      functionName: "tokenCount",
    });
    for (let i = 0n; i < tokenCount; i++) {
      const token = await client.readContract({
        address: curve,
        abi: curveAbi,
        functionName: "allTokens",
        args: [i],
      });
      const status = await launchedContractStatus(
        client,
        explorerApiUrl,
        token,
      );
      if (!status.verified) unverified++;
      console.log(`  token  ${token}  ${describe(status)}`);
    }
  }

  if (failed) {
    console.log(`\n${failed} implementation(s) not verified.`);
    console.log(
      `Verify them from a browser at ${explorerUrl}/address/<implementation>/contract-verification`,
    );
    console.log(
      "  method: Solidity (Standard JSON input), no constructor arguments,",
    );
    console.log(
      "  compiler + file: services/indexer/verification/compiler.json and <Contract>.input.json",
    );
    process.exit(1);
  }
  console.log(
    unverified
      ? `\n${unverified} launched contract(s) predate the clone upgrade`
      : "\nEverything verified ✅",
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

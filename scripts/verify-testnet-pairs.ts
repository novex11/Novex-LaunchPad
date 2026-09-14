/**
 * Verifies the source of every pair launched on the testnet PairFactory
 * (PairVault + ReceiptToken) on the Robinhood Chain Testnet explorer.
 * Safe to re-run: already-verified contracts are skipped.
 *
 * Usage: pnpm verify:testnet-pairs [pairAddress]
 */
import { createPublicClient, http, parseAbi, type Address, type PublicClient } from "viem";
import { join } from "node:path";
import { loadRootEnv } from "./lib/load-env";
import deployment from "../packages/config/src/testnet-deployments.json";
import { verifyPairContracts } from "../services/indexer/src/contract-verifier";

loadRootEnv();

const rpcUrl = process.env.ROBINHOOD_TESTNET_RPC_URL || deployment.rpcUrl;
const explorerApiUrl = (process.env.EXPLORER_API_URL || "https://explorer.testnet.chain.robinhood.com/api").replace(/\/$/, "");
const factory = deployment.contracts.pairFactory as Address;

const factoryAbi = parseAbi([
  "function pairCount() view returns (uint256)",
  "function pairs(uint256) view returns (address pair, address receiptToken, address tokenA, address tokenB, uint16 weightABps, uint16 creatorFeeBps, address creator)",
]);

async function main() {
  const client = createPublicClient({
    chain: {
      id: 46630,
      name: "Robinhood Chain Testnet",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    transport: http(rpcUrl),
  }) as PublicClient;

  let pairs: Address[];
  if (process.argv[2]) {
    pairs = [process.argv[2] as Address];
  } else {
    const count = await client.readContract({ address: factory, abi: factoryAbi, functionName: "pairCount" });
    pairs = [];
    for (let i = 0n; i < count; i++) {
      const info = await client.readContract({ address: factory, abi: factoryAbi, functionName: "pairs", args: [i] });
      pairs.push(info[0]);
    }
  }

  console.log(`Verifying ${pairs.length} pair(s) on ${explorerApiUrl}\n`);
  const opts = {
    explorerApiUrl,
    inputsDir: join(process.cwd(), "services/indexer/verification"),
    log: (m: string) => console.log(`  … ${m}`),
  };
  let failed = 0;
  for (const pair of pairs) {
    const result = await verifyPairContracts(client, opts, pair);
    console.log(`  ${pair}  vault: ${result.vault}  receipt: ${result.receipt}`);
    if (result.vault === "failed" || result.receipt === "failed" || result.vault === "skipped") failed++;
  }
  console.log(failed ? `\n${failed} pair(s) not fully verified` : "\nAll pairs verified ✅");
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

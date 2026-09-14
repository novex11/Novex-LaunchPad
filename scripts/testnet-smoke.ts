/**
 * End-to-end smoke test on Robinhood Chain Testnet with real transactions:
 * launch a pair with faucet Stock Tokens, deposit into it, redeem from it.
 *
 * Usage: pnpm smoke:testnet [TICKER_A] [TICKER_B] [seedUsd]
 * Default: first two listed tokens with no existing pair, $20 seed.
 */
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadRootEnv } from "./lib/load-env";
import deployment from "../packages/config/src/testnet-deployments.json";

loadRootEnv();

const rawKey = process.env.DEPLOYER_PRIVATE_KEY;
if (!rawKey) throw new Error("DEPLOYER_PRIVATE_KEY missing in .env");
const account = privateKeyToAccount(`0x${rawKey.replace(/^0x/, "")}` as Hex);

const rpcUrl = process.env.ROBINHOOD_TESTNET_RPC_URL || deployment.rpcUrl;
const chain = {
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
} as const;
const client = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });

const tokens = deployment.tokens as Record<string, Address>;
const factory = deployment.contracts.pairFactory as Address;
const oracle = deployment.contracts.oracle as Address;
const explorer = "https://explorer.testnet.chain.robinhood.com/tx/";

const erc20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const oracleAbi = parseAbi(["function getPrice(address) view returns (uint256)"]);
const factoryAbi = parseAbi([
  "struct LaunchParams { address tokenA; address tokenB; uint16 weightABps; uint16 creatorFeeBps; string receiptName; string receiptSymbol; uint256 amountA; uint256 amountB; uint256 minShares; }",
  "function launchPair(LaunchParams p) payable returns (address pair, address receipt, uint256 shares)",
  "function pairByKey(bytes32) view returns (address)",
  "function computePairKey(address, address) pure returns (bytes32)",
]);
const vaultAbi = parseAbi([
  "function tokenA() view returns (address)",
  "function receiptToken() view returns (address)",
  "function navUsd8() view returns (uint256)",
  "function sharePrice() view returns (uint256)",
  "function quoteDeposit(uint256 valueUsd8) view returns (uint256 amountA, uint256 amountB, uint256 shares)",
  "function deposit(uint256 maxA, uint256 maxB, uint256 minShares) payable returns (uint256)",
  "function redeem(uint256 shares, uint256 minA, uint256 minB) returns (uint256, uint256)",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function send(label: string, request: any) {
  const { request: sim } = await client.simulateContract({ account, ...request });
  const gas = await client.estimateContractGas({ account, ...request });
  const hash = await wallet.writeContract({ ...sim, gas: (gas * 13n) / 10n });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`  ✓ ${label.padEnd(28)} gas ${receipt.gasUsed.toString().padStart(8)}  ${explorer}${hash}`);
  return receipt;
}

async function pickPair(): Promise<[string, string]> {
  if (process.argv[2] && process.argv[3]) return [process.argv[2].toUpperCase(), process.argv[3].toUpperCase()];
  const tickers = Object.keys(tokens).filter((t) => t !== "WETH");
  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const key = await client.readContract({ address: factory, abi: factoryAbi, functionName: "computePairKey", args: [tokens[tickers[i]!]!, tokens[tickers[j]!]!] });
      const existing = await client.readContract({ address: factory, abi: factoryAbi, functionName: "pairByKey", args: [key] });
      if (existing === zeroAddress) return [tickers[i]!, tickers[j]!];
    }
  }
  throw new Error("Every stock pair is already launched");
}

async function main() {
  const [tickerA, tickerB] = await pickPair();
  const seedUsd = Number(process.argv[4] ?? 20);
  const tokenA = tokens[tickerA]!;
  const tokenB = tokens[tickerB]!;
  console.log(`\nSmoke test: ${tickerA}/${tickerB} 50/50, $${seedUsd} seed · wallet ${account.address}\n`);

  const [priceA, priceB] = await Promise.all([
    client.readContract({ address: oracle, abi: oracleAbi, functionName: "getPrice", args: [tokenA] }),
    client.readContract({ address: oracle, abi: oracleAbi, functionName: "getPrice", args: [tokenB] }),
  ]);
  const half = BigInt(Math.round((seedUsd / 2) * 1e8));
  const amountA = (half * 10n ** 18n) / priceA;
  const amountB = (half * 10n ** 18n) / priceB;
  console.log(`  prices ${tickerA} $${formatUnits(priceA, 8)} · ${tickerB} $${formatUnits(priceB, 8)}`);
  console.log(`  seed   ${formatUnits(amountA, 18)} ${tickerA} + ${formatUnits(amountB, 18)} ${tickerB}`);

  await send(`approve ${tickerA}`, { address: tokenA, abi: erc20, functionName: "approve", args: [factory, amountA] });
  await send(`approve ${tickerB}`, { address: tokenB, abi: erc20, functionName: "approve", args: [factory, amountB] });
  const symbol = `SMK${Date.now().toString().slice(-6)}`;
  const launch = await send("launchPair", {
    address: factory,
    abi: factoryAbi,
    functionName: "launchPair",
    args: [{ tokenA, tokenB, weightABps: 5000, creatorFeeBps: 200, receiptName: `Smoke ${tickerA}/${tickerB}`, receiptSymbol: symbol, amountA, amountB, minShares: 0n }],
  });

  const pairKey = await client.readContract({ address: factory, abi: factoryAbi, functionName: "computePairKey", args: [tokenA, tokenB] });
  const pair = await client.readContract({ address: factory, abi: factoryAbi, functionName: "pairByKey", args: [pairKey] });
  const receipt = await client.readContract({ address: pair, abi: vaultAbi, functionName: "receiptToken" });
  console.log(`  pair   ${pair} (block ${launch.blockNumber})`);

  const [depA, depB] = await client.readContract({ address: pair, abi: vaultAbi, functionName: "quoteDeposit", args: [5n * 10n ** 8n] });
  await send("approve pair leg A", { address: await client.readContract({ address: pair, abi: vaultAbi, functionName: "tokenA" }), abi: erc20, functionName: "approve", args: [pair, depA] });
  const vaultTokenA = await client.readContract({ address: pair, abi: vaultAbi, functionName: "tokenA" });
  const vaultTokenB = vaultTokenA.toLowerCase() === tokenA.toLowerCase() ? tokenB : tokenA;
  await send("approve pair leg B", { address: vaultTokenB, abi: erc20, functionName: "approve", args: [pair, depB] });
  await send("deposit $5", { address: pair, abi: vaultAbi, functionName: "deposit", args: [depA, depB, 0n] });

  const shares = await client.readContract({ address: receipt, abi: erc20, functionName: "balanceOf", args: [account.address] });
  await send("redeem half", { address: pair, abi: vaultAbi, functionName: "redeem", args: [shares / 2n, 0n, 0n] });

  const [nav, price] = await Promise.all([
    client.readContract({ address: pair, abi: vaultAbi, functionName: "navUsd8" }),
    client.readContract({ address: pair, abi: vaultAbi, functionName: "sharePrice" }),
  ]);
  console.log(`\n  NAV $${formatUnits(nav, 8)} · share price $${formatUnits(price, 8)} · smoke test passed ✅\n`);
}

main().catch((e) => {
  console.error("\nSmoke test failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

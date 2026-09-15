/**
 * End-to-end smoke test of the managed baskets on Robinhood Chain Testnet with
 * real transactions: deposit a faucet stock into its Balanced vault (swapped
 * into the fixed target mix through the oracle-priced router), then redeem
 * half as the proportional basket and the rest back to the deposit asset.
 *
 * Usage: pnpm smoke:baskets:testnet [TICKER] [depositUsd]
 * Default: TSLA, $20.
 */
import { createPublicClient, createWalletClient, formatUnits, http, parseAbi, type Address, type Hex } from "viem";
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
const explorer = "https://explorer.testnet.chain.robinhood.com/tx/";

const tokens = deployment.tokens as Record<string, Address>;
const vaults = (deployment as { vaults?: Record<string, { vault: string; receipt: string }> }).vaults ?? {};
const oracle = deployment.contracts.oracle as Address;

const erc20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const oracleAbi = parseAbi(["function getPrice(address) view returns (uint256)"]);
const vaultAbi = parseAbi([
  "function receiptToken() view returns (address)",
  "function navUsd8() view returns (uint256)",
  "function sharePrice() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function targetMix() view returns (address[] tokens, uint256[] weightsBps)",
  "function deposit(uint256 amount, uint256 minShares) returns (uint256)",
  "function redeem(uint256 shares, uint8 mode, uint256 minOut)",
  "event Deposited(address indexed user, uint256 amountIn, uint256 sharesMinted, uint256 valueUsd8)",
  "event Redeemed(address indexed user, uint256 sharesBurned, uint8 mode, uint256 valueUsd8)",
]);

const ticker = (process.argv[2] ?? "TSLA").toUpperCase();
const depositUsd = Number(process.argv[3] ?? 20);
const entry = vaults[ticker];
if (!entry) throw new Error(`No basket vault for ${ticker} in testnet-deployments.json (have: ${Object.keys(vaults).join(", ")})`);
const vault = entry.vault as Address;
const receipt = entry.receipt as Address;
const token = tokens[ticker]!;
const symbolOf = (a: string) => Object.entries(tokens).find(([, v]) => v.toLowerCase() === a.toLowerCase())?.[0] ?? a;

async function send(label: string, fn: () => Promise<Hex>) {
  const hash = await fn();
  const rc = await client.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${label} reverted: ${explorer}${hash}`);
  console.log(`   ${label}: ${explorer}${hash}`);
  return rc;
}

async function main() {
  console.log(`Basket smoke: ${ticker} → t${ticker}-B (${vault}) as ${account.address}\n`);

  const [mixTokens, mixWeights] = await client.readContract({ address: vault, abi: vaultAbi, functionName: "targetMix" });
  console.log("Target mix:", mixTokens.map((t, i) => `${symbolOf(t)} ${(Number(mixWeights[i]) / 100).toFixed(2)}%`).join(" · "));

  const price = await client.readContract({ address: oracle, abi: oracleAbi, functionName: "getPrice", args: [token] });
  const amount = (BigInt(Math.round(depositUsd * 1e8)) * 10n ** 18n) / price;
  const bal = await client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [account.address] });
  if (bal < amount) throw new Error(`Need ${formatUnits(amount, 18)} ${ticker}, have ${formatUnits(bal, 18)}`);

  const sharePrice = await client.readContract({ address: vault, abi: vaultAbi, functionName: "sharePrice" });
  const expectedShares = ((amount * price) / 10n ** 18n) * 10n ** 18n / sharePrice;
  const minShares = (expectedShares * 98n) / 100n;
  console.log(`\nDepositing ${formatUnits(amount, 18)} ${ticker} (~$${depositUsd}), minShares ${formatUnits(minShares, 18)}`);

  await send("approve", () => wallet.writeContract({ address: token, abi: erc20, functionName: "approve", args: [vault, amount] }));
  const dep = await send("deposit", () => wallet.writeContract({ address: vault, abi: vaultAbi, functionName: "deposit", args: [amount, minShares] }));
  const shares = await client.readContract({ address: receipt, abi: erc20, functionName: "balanceOf", args: [account.address] });
  const nav = await client.readContract({ address: vault, abi: vaultAbi, functionName: "navUsd8" });
  console.log(`   shares: ${formatUnits(shares, 18)}  vault NAV: $${formatUnits(nav, 8)}  gas: ${dep.gasUsed}`);
  for (const t of mixTokens) {
    const b = await client.readContract({ address: t, abi: erc20, functionName: "balanceOf", args: [vault] });
    console.log(`   vault holds ${formatUnits(b, 18)} ${symbolOf(t)}`);
  }
  if (shares < minShares) throw new Error("minted fewer shares than the floor");

  const half = shares / 2n;
  const value8 = (nav * half) / (await client.readContract({ address: vault, abi: vaultAbi, functionName: "totalShares" }));
  console.log(`\nRedeeming ${formatUnits(half, 18)} shares as the proportional basket (≥ $${formatUnits((value8 * 98n) / 100n, 8)})`);
  await send("redeem (basket)", () =>
    wallet.writeContract({ address: vault, abi: vaultAbi, functionName: "redeem", args: [half, 1, (value8 * 98n) / 100n] }),
  );

  const rest = await client.readContract({ address: receipt, abi: erc20, functionName: "balanceOf", args: [account.address] });
  const expectedOut = ((value8 * 10n ** 18n) / price * 97n) / 100n;
  console.log(`\nRedeeming ${formatUnits(rest, 18)} shares back to ${ticker} (≥ ${formatUnits(expectedOut, 18)} ${ticker})`);
  const before = await client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [account.address] });
  await send("redeem (original asset)", () =>
    wallet.writeContract({ address: vault, abi: vaultAbi, functionName: "redeem", args: [rest, 0, expectedOut] }),
  );
  const after = await client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [account.address] });
  console.log(`   received ${formatUnits(after - before, 18)} ${ticker}`);
  const left = await client.readContract({ address: receipt, abi: erc20, functionName: "balanceOf", args: [account.address] });
  if (left !== 0n) throw new Error(`still holding ${formatUnits(left, 18)} shares`);
  console.log("\n✅  Basket deposit + both redeem modes succeeded on testnet");
}

main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});

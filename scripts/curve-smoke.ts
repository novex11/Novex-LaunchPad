/**
 * End-to-end smoke test of the creator-token flow on Robinhood Chain Testnet
 * with real transactions from the deployer wallet:
 *
 *   launch pair → createToken (2% dev buy) → buy with ETH → buy with stocks
 *   → sell 25% for ETH → sell 25% for stocks → guard simulations → indexer checks
 *
 * Every step prints the tx hash with a Blockscout link and asserts balances;
 * the script stops at the first failure.
 *
 * Usage: pnpm smoke:curve:testnet [TICKER_A] [TICKER_B]
 * Default: first two listed stocks with no existing pair on the current factory.
 *
 * Non-creator paths cannot be exercised with a single key, so the public
 * deposit guard and the creator-only launch guard are verified with eth_call
 * simulations from a random address instead.
 */
import {
  createPublicClient,
  createWalletClient,
  encodePacked,
  formatEther,
  formatUnits,
  http,
  parseAbi,
  parseEther,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadRootEnv } from "./lib/load-env";
import testnetDeployment from "../packages/config/src/testnet-deployments.json";
import mainnetDeployment from "../packages/config/src/mainnet-deployments.json";

loadRootEnv();

// `--mainnet` runs the same flow on Robinhood Chain (4663) with real stocks the
// wallet already holds; everything else defaults to testnet.
const MAINNET = process.argv.includes("--mainnet");
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const deployment = MAINNET ? mainnetDeployment : testnetDeployment;

const rawKey = process.env.DEPLOYER_PRIVATE_KEY;
if (!rawKey) throw new Error("DEPLOYER_PRIVATE_KEY missing in .env");
const account = privateKeyToAccount(`0x${rawKey.replace(/^0x/, "")}` as Hex);

const rpcUrl = (MAINNET ? process.env.ROBINHOOD_RPC_URL : process.env.ROBINHOOD_TESTNET_RPC_URL) || deployment.rpcUrl;
const chain = {
  id: MAINNET ? 4663 : 46630,
  name: MAINNET ? "Robinhood Chain" : "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
} as const;
const client = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });

// Testnet config carries a ticker → address map; on mainnet it is read from the factory below.
const tokens: Record<string, Address> = MAINNET ? {} : ((testnetDeployment as { tokens: Record<string, Address> }).tokens);
const factory = deployment.contracts.pairFactory as Address;
const oracle = deployment.contracts.oracle as Address;
const curve = deployment.contracts.composeCurve as Address;
const curveRouter = deployment.contracts.curveRouter as Address;
const indexerUrl = (
  process.env.SMOKE_INDEXER_URL ||
  (MAINNET ? "https://compose-indexer.onrender.com" : process.env.NEXT_PUBLIC_INDEXER_URL || "https://novex-indexer.onrender.com")
).replace(/\/$/, "");
const explorer = MAINNET ? "https://robinhoodchain.blockscout.com/tx/" : "https://explorer.testnet.chain.robinhood.com/tx/";

const SUPPLY = 10n ** 27n;
const POOL_FEE = 3000;
const MAX_SLIPPAGE_BPS = 300;
const CURVE_FEE_BPS = 100n;
const ETH_BUY = parseEther("0.0005");

const erc20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
]);
const oracleAbi = parseAbi(["function getPrice(address) view returns (uint256)"]);
const factoryAbi = parseAbi([
  "struct LaunchParams { address tokenA; address tokenB; uint16 weightABps; uint16 creatorFeeBps; string receiptName; string receiptSymbol; uint256 amountA; uint256 amountB; uint256 minShares; }",
  "function launchPair(LaunchParams p) payable returns (address pair, address receipt, uint256 shares)",
  "function pairByKey(bytes32) view returns (address)",
  "function computePairKey(address, address) pure returns (bytes32)",
  "function isPair(address) view returns (bool)",
  "function weth() view returns (address)",
  "function listedTokens() view returns (address[])",
]);
const vaultAbi = parseAbi([
  "function tokenA() view returns (address)",
  "function tokenB() view returns (address)",
  "function receiptToken() view returns (address)",
  "function creator() view returns (address)",
  "function sharePrice() view returns (uint256)",
  "function creatorFeeShares() view returns (uint256)",
  "function quoteDeposit(uint256 valueUsd8) view returns (uint256 amountA, uint256 amountB, uint256 shares)",
  "function depositFor(address recipient, uint256 maxA, uint256 maxB, uint256 minShares) payable returns (uint256)",
]);
const curveAbi = parseAbi([
  "function createToken(address pair, uint256 devBuyShares, uint256 minDevTokens) returns (address token, uint256 devTokens)",
  "function tokenOfPair(address pair) view returns (address)",
  "function startMarketCapUsd8() view returns (uint256)",
]);
const routerAbi = parseAbi([
  "struct BuyParams { address token; address payToken; uint256 amountIn; bytes pathA; bytes pathB; uint256 minTokensOut; uint16 maxSlippageBps; uint256 deadline; }",
  "struct SellParams { address token; uint256 tokensIn; address receiveToken; bytes pathA; bytes pathB; uint256 minAmountOut; uint16 maxSlippageBps; bool unwrapEth; uint256 deadline; }",
  "function buy(BuyParams p) payable returns (uint256 tokensOut)",
  "function sell(SellParams p) returns (uint256 amountOut)",
  "function buyWithStocks(address token, uint256 maxA, uint256 maxB, uint256 minTokensOut) returns (uint256 tokensOut)",
  "function sellForStocks(address token, uint256 tokensIn, uint256 minAmountA, uint256 minAmountB) returns (uint256 amountA, uint256 amountB)",
]);

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${message}`);
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Single-hop Uniswap v3 path; empty when no swap is needed. */
function path(from: Address, to: Address): Hex {
  if (same(from, to)) return "0x";
  return encodePacked(["address", "uint24", "address"], [from, POOL_FEE, to]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function send(label: string, request: any) {
  const { request: sim } = await client.simulateContract({ account, ...request });
  const gas = await client.estimateContractGas({ account, ...request });
  const hash = await wallet.writeContract({ ...sim, gas: (gas * 13n) / 10n });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`  ✓ ${label.padEnd(30)} gas ${receipt.gasUsed.toString().padStart(8)}  ${explorer}${hash}`);
  return receipt;
}

/** Expect an eth_call simulation to revert with `reason`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function expectRevert(label: string, request: any, reason: string) {
  try {
    await client.simulateContract(request);
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    assert(text.includes(reason), `${label}: reverted, but not with "${reason}":\n${text.slice(0, 400)}`);
    console.log(`  ✓ ${label.padEnd(30)} reverts "${reason}"`);
    return;
  }
  throw new Error(`${label}: expected revert "${reason}" but the call succeeded`);
}

const balanceOf = (token: Address, owner: Address) =>
  client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [owner] });

async function loadListedTokens() {
  const listed = await client.readContract({ address: factory, abi: factoryAbi, functionName: "listedTokens" });
  for (const addr of listed) {
    const symbol = await client.readContract({ address: addr, abi: erc20, functionName: "symbol" });
    tokens[symbol.toUpperCase()] = addr;
  }
}

async function pickPair(): Promise<[string, string]> {
  if (MAINNET) await loadListedTokens();
  if (positional[0] && positional[1]) return [positional[0].toUpperCase(), positional[1].toUpperCase()];
  const tickers = Object.keys(tokens).filter((t) => t !== "WETH");
  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const key = await client.readContract({ address: factory, abi: factoryAbi, functionName: "computePairKey", args: [tokens[tickers[i]!]!, tokens[tickers[j]!]!] });
      const existing = await client.readContract({ address: factory, abi: factoryAbi, functionName: "pairByKey", args: [key] });
      if (existing === zeroAddress) return [tickers[i]!, tickers[j]!];
    }
  }
  throw new Error("Every stock pair is already launched on this factory");
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" } as RequestInit);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const [tickerA, tickerB] = await pickPair();
  const seedUsd = 20;
  const inA = tokens[tickerA]!;
  const inB = tokens[tickerB]!;
  const weth = await client.readContract({ address: factory, abi: factoryAbi, functionName: "weth" });
  console.log(`\nCurve smoke test: ${tickerA}/${tickerB} 50/50, $${seedUsd} seed · wallet ${account.address}`);
  console.log(`  factory ${factory} · curve ${curve} · router ${curveRouter}\n`);

  // ── 1. Launch a fresh pair ────────────────────────────────
  console.log("1. Launch pair");
  const [priceInA, priceInB] = await Promise.all([
    client.readContract({ address: oracle, abi: oracleAbi, functionName: "getPrice", args: [inA] }),
    client.readContract({ address: oracle, abi: oracleAbi, functionName: "getPrice", args: [inB] }),
  ]);
  const half = BigInt(Math.round((seedUsd / 2) * 1e8));
  const seedA = (half * 10n ** 18n) / priceInA;
  const seedB = (half * 10n ** 18n) / priceInB;
  console.log(`  prices ${tickerA} $${formatUnits(priceInA, 8)} · ${tickerB} $${formatUnits(priceInB, 8)}`);
  await send(`approve ${tickerA} → factory`, { address: inA, abi: erc20, functionName: "approve", args: [factory, seedA] });
  await send(`approve ${tickerB} → factory`, { address: inB, abi: erc20, functionName: "approve", args: [factory, seedB] });
  const receiptName = `Smoke ${tickerA}/${tickerB}`;
  const receiptSymbol = `SMK${Date.now().toString().slice(-6)}`;
  await send("launchPair", {
    address: factory,
    abi: factoryAbi,
    functionName: "launchPair",
    args: [{ tokenA: inA, tokenB: inB, weightABps: 5000, creatorFeeBps: 0, receiptName, receiptSymbol, amountA: seedA, amountB: seedB, minShares: 0n }],
  });

  // ── 2. Pair assertions ────────────────────────────────────
  console.log("2. Verify pair");
  const pairKey = await client.readContract({ address: factory, abi: factoryAbi, functionName: "computePairKey", args: [inA, inB] });
  const pair = await client.readContract({ address: factory, abi: factoryAbi, functionName: "pairByKey", args: [pairKey] });
  assert(pair !== zeroAddress, "pair was not registered");
  assert(await client.readContract({ address: factory, abi: factoryAbi, functionName: "isPair", args: [pair] }), "factory.isPair");
  const [share, creator, tokenA, tokenB] = await Promise.all([
    client.readContract({ address: pair, abi: vaultAbi, functionName: "receiptToken" }),
    client.readContract({ address: pair, abi: vaultAbi, functionName: "creator" }),
    client.readContract({ address: pair, abi: vaultAbi, functionName: "tokenA" }),
    client.readContract({ address: pair, abi: vaultAbi, functionName: "tokenB" }),
  ]);
  const [shareName, shareSymbol] = await Promise.all([
    client.readContract({ address: share, abi: erc20, functionName: "name" }),
    client.readContract({ address: share, abi: erc20, functionName: "symbol" }),
  ]);
  assert(shareName === receiptName && shareSymbol === receiptSymbol, `receipt identity (${shareName} / ${shareSymbol})`);
  assert(same(creator, account.address), "creator == deployer");
  const legA = same(tokenA, inA) ? tickerA : tickerB;
  const legB = same(tokenB, inB) ? tickerB : tickerA;
  console.log(`  ✓ pair ${pair} · receipt ${share} (${shareSymbol}) · legs ${legA}/${legB}`);

  // ── 3. createToken with a 2% dev buy ──────────────────────
  console.log("3. Create token (2% dev buy)");
  const [startMcap8, sharePrice8] = await Promise.all([
    client.readContract({ address: curve, abi: curveAbi, functionName: "startMarketCapUsd8" }),
    client.readContract({ address: pair, abi: vaultAbi, functionName: "sharePrice" }),
  ]);
  assert(sharePrice8 > 0n, "share price > 0");
  const q0 = (startMcap8 * 10n ** 18n) / sharePrice8;
  const targetBps = 200n;
  const net = (q0 * targetBps) / (10_000n - targetBps);
  const devBuyShares = ceilDiv(net * 10_000n, 10_000n - CURVE_FEE_BPS);
  const fee = (devBuyShares * CURVE_FEE_BPS) / 10_000n;
  const expectedDevTokens = SUPPLY - ceilDiv(q0 * SUPPLY, q0 + devBuyShares - fee);
  const minDevTokens = (expectedDevTokens * 99n) / 100n;
  const myShares = await balanceOf(share, account.address);
  assert(myShares >= devBuyShares, `enough shares for the dev buy (have ${formatUnits(myShares, 18)}, need ${formatUnits(devBuyShares, 18)})`);
  console.log(`  start mcap $${formatUnits(startMcap8, 8)} · q0 ${formatUnits(q0, 18)} shares · dev buy ${formatUnits(devBuyShares, 18)} shares ≈ ${formatUnits(expectedDevTokens, 18)} tokens`);
  await send("approve shares → curve", { address: share, abi: erc20, functionName: "approve", args: [curve, devBuyShares] });
  await send("createToken", { address: curve, abi: curveAbi, functionName: "createToken", args: [pair, devBuyShares, minDevTokens] });

  const token = await client.readContract({ address: curve, abi: curveAbi, functionName: "tokenOfPair", args: [pair] });
  assert(token !== zeroAddress, "tokenOfPair(pair) is set");
  const [tokenName, tokenSymbol, curveBal, devBal] = await Promise.all([
    client.readContract({ address: token, abi: erc20, functionName: "name" }),
    client.readContract({ address: token, abi: erc20, functionName: "symbol" }),
    balanceOf(token, curve),
    balanceOf(token, account.address),
  ]);
  assert(tokenName === shareName && tokenSymbol === shareSymbol, `token identity matches receipt (${tokenName} / ${tokenSymbol})`);
  assert(curveBal + devBal === SUPPLY, `curve + dev == 1B (curve ${curveBal}, dev ${devBal})`);
  assert(devBal <= (SUPPLY * 500n) / 10_000n, "dev buy ≤ 5% of supply");
  assert(devBal >= minDevTokens, "dev buy ≥ minDevTokens");
  console.log(`  ✓ token ${token} ($${tokenSymbol}) · dev holds ${formatUnits(devBal, 18)} (${(Number((devBal * 10_000n) / SUPPLY) / 100).toFixed(2)}%) · curve holds ${formatUnits(curveBal, 18)}`);
  await expectRevert(
    "second createToken",
    { account, address: curve, abi: curveAbi, functionName: "createToken", args: [pair, 0n, 0n] },
    "pair already has a token",
  );
  console.log("  · non-creator createToken is checked by simulation in step 8 (only one key available)");

  // Launch protection: for 30s after createToken buys are capped at 5.5% per tx
  // and 5% per wallet. Wait it out so the larger test buys below are allowed.
  const LAUNCH_WINDOW_MS = 32_000;
  console.log(`  · waiting ${LAUNCH_WINDOW_MS / 1000}s for the launch-protection window to close`);
  await new Promise((r) => setTimeout(r, LAUNCH_WINDOW_MS));

  // ── 4. Buy with ETH ───────────────────────────────────────
  console.log("4. Buy with ETH via CurveRouter.buy");
  const feeSharesBefore = await client.readContract({ address: pair, abi: vaultAbi, functionName: "creatorFeeShares" });
  const tokensBefore4 = await balanceOf(token, account.address);
  await send(`buy with ${formatEther(ETH_BUY)} ETH`, {
    address: curveRouter,
    abi: routerAbi,
    functionName: "buy",
    args: [{ token, payToken: weth, amountIn: ETH_BUY, pathA: path(weth, tokenA), pathB: path(weth, tokenB), minTokensOut: 0n, maxSlippageBps: MAX_SLIPPAGE_BPS, deadline: deadline() }],
    value: ETH_BUY,
  });
  const tokensAfter4 = await balanceOf(token, account.address);
  assert(tokensAfter4 > tokensBefore4, "token balance increased after ETH buy");
  const feeSharesAfter4 = await client.readContract({ address: pair, abi: vaultAbi, functionName: "creatorFeeShares" });
  assert(feeSharesAfter4 === feeSharesBefore, `no pair deposit fee on the ETH buy (creatorFeeShares ${feeSharesBefore} → ${feeSharesAfter4})`);
  console.log(`  ✓ received ${formatUnits(tokensAfter4 - tokensBefore4, 18)} ${tokenSymbol} · creatorFeeShares unchanged`);

  // ── 5. Buy with stocks ────────────────────────────────────
  console.log("5. Buy with stocks via CurveRouter.buyWithStocks");
  const [maxA, maxB] = await client.readContract({ address: pair, abi: vaultAbi, functionName: "quoteDeposit", args: [4n * 10n ** 8n] });
  assert(maxA > 0n && maxB > 0n, "quoteDeposit($4) returned both legs");
  await send(`approve ${legA} → router`, { address: tokenA, abi: erc20, functionName: "approve", args: [curveRouter, maxA] });
  await send(`approve ${legB} → router`, { address: tokenB, abi: erc20, functionName: "approve", args: [curveRouter, maxB] });
  const tokensBefore5 = tokensAfter4;
  await send("buyWithStocks ($4)", { address: curveRouter, abi: routerAbi, functionName: "buyWithStocks", args: [token, maxA, maxB, 0n] });
  const tokensAfter5 = await balanceOf(token, account.address);
  assert(tokensAfter5 > tokensBefore5, "token balance increased after stock buy");
  const feeSharesAfter5 = await client.readContract({ address: pair, abi: vaultAbi, functionName: "creatorFeeShares" });
  assert(feeSharesAfter5 === feeSharesBefore, `no pair deposit fee on the stock buy (creatorFeeShares ${feeSharesBefore} → ${feeSharesAfter5})`);
  console.log(`  ✓ received ${formatUnits(tokensAfter5 - tokensBefore5, 18)} ${tokenSymbol} · creatorFeeShares unchanged`);

  // ── 6. Sell 25% for ETH ───────────────────────────────────
  console.log("6. Sell 25% for ETH via CurveRouter.sell");
  const sellEth = tokensAfter5 / 4n;
  const ethBefore = await client.getBalance({ address: account.address });
  await send("approve token → router", { address: token, abi: erc20, functionName: "approve", args: [curveRouter, sellEth] });
  const sellReceipt = await send("sell 25% for ETH", {
    address: curveRouter,
    abi: routerAbi,
    functionName: "sell",
    args: [{ token, tokensIn: sellEth, receiveToken: weth, pathA: path(tokenA, weth), pathB: path(tokenB, weth), minAmountOut: 0n, maxSlippageBps: MAX_SLIPPAGE_BPS, unwrapEth: true, deadline: deadline() }],
  });
  const tokensAfter6 = await balanceOf(token, account.address);
  assert(tokensAfter6 === tokensAfter5 - sellEth, "token balance decreased by the sold amount");
  const ethAfter = await client.getBalance({ address: account.address });
  const gasPaid = sellReceipt.gasUsed * sellReceipt.effectiveGasPrice;
  const ethNet = ethAfter - ethBefore + gasPaid;
  assert(ethNet > 0n, `ETH received net of gas (${formatEther(ethNet)})`);
  console.log(`  ✓ received ${formatEther(ethNet)} ETH (net of gas, before the approve tx)`);

  // ── 7. Sell 25% for stocks ────────────────────────────────
  console.log("7. Sell 25% for stocks via CurveRouter.sellForStocks");
  const sellStocks = tokensAfter6 / 4n;
  const [aBefore, bBefore] = await Promise.all([balanceOf(tokenA, account.address), balanceOf(tokenB, account.address)]);
  await send("approve token → router", { address: token, abi: erc20, functionName: "approve", args: [curveRouter, sellStocks] });
  await send("sellForStocks 25%", { address: curveRouter, abi: routerAbi, functionName: "sellForStocks", args: [token, sellStocks, 0n, 0n] });
  const [aAfter, bAfter, tokensAfter7] = await Promise.all([balanceOf(tokenA, account.address), balanceOf(tokenB, account.address), balanceOf(token, account.address)]);
  assert(aAfter > aBefore, `${legA} balance increased`);
  assert(bAfter > bBefore, `${legB} balance increased`);
  assert(tokensAfter7 === tokensAfter6 - sellStocks, "token balance decreased by the sold amount");
  console.log(`  ✓ received ${formatUnits(aAfter - aBefore, 18)} ${legA} + ${formatUnits(bAfter - bBefore, 18)} ${legB}`);

  // ── 8. Guard simulations from a random address ────────────
  console.log("8. Guards (eth_call from a random address)");
  const stranger = privateKeyToAccount(generatePrivateKey());
  await expectRevert(
    "public depositFor",
    { account: stranger, address: pair, abi: vaultAbi, functionName: "depositFor", args: [stranger.address, maxA, maxB, 0n] },
    "PairVault: creator only",
  );
  await expectRevert(
    "non-creator createToken",
    { account: stranger, address: curve, abi: curveAbi, functionName: "createToken", args: [pair, 0n, 0n] },
    "only pair creator",
  );

  // ── 9. Indexer ────────────────────────────────────────────
  console.log(`9. Indexer (${indexerUrl})`);
  const tokenUrl = `${indexerUrl}/launchpad/token/${token.toLowerCase()}`;
  let tradesCount = 0;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 90_000) {
    try {
      const json = (await fetchJson(tokenUrl)) as { token?: { tradesCount?: number } };
      tradesCount = Number(json.token?.tradesCount ?? 0);
      if (tradesCount >= 5) break;
    } catch {
      /* not indexed yet */
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  assert(tradesCount >= 5, `indexer saw ≥ 5 trades within 90s (saw ${tradesCount})`);
  const history = (await fetchJson(`${tokenUrl}/history?range=all`)) as { points?: Array<{ txHash?: string; marketCapUsd: number }> };
  const points = history.points ?? [];
  assert(points.length >= 6, `history has ≥ 6 points (launch + 5 trades + now; got ${points.length})`);
  const lastTrade = [...points].reverse().find((p) => p.txHash);
  assert(lastTrade?.txHash, "last trade point carries a txHash");
  console.log(`  ✓ tradesCount ${tradesCount} · history ${points.length} points · last trade ${lastTrade!.txHash} · mcap $${points[points.length - 1]!.marketCapUsd.toFixed(2)}`);

  console.log(`\n  token page: /token/${token} · pair page: /pair/${pair}`);
  console.log("  curve smoke test passed ✅\n");
}

main().catch((e) => {
  console.error("\nCurve smoke test failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

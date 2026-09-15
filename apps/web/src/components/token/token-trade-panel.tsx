"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { useBalance, useReadContract } from "wagmi";
import {
  ArrowRight,
  CheckCircle,
  CircleNotch,
  Drop,
  Info,
  ShieldCheck,
  Wallet,
  WarningCircle,
} from "@phosphor-icons/react";
import { TESTNET_FAUCET_URL, isTestnetMode } from "@compose/config";
import { Button } from "@/components/ui/button";
import { EthLogo, UsdgLogo } from "@/components/ui/asset-logo";
import { DualLogoStack } from "@/components/launchpad/dual-logo-stack";
import { AssetSelect, type AssetOption } from "@/components/token/asset-select";
import { cn, explorerUrl, formatUsd } from "@/lib/utils";
import { SWAP_ROUTER_ADDRESS, USDG_ADDRESS, WETH_ADDRESS, erc20Abi, pairVaultAbi, usdgReady } from "@/lib/contracts";
import { useOraclePrices, useTokenBalances, type PairOnchainState } from "@/hooks/use-pair-launchpad";
import {
  DEFAULT_SLIPPAGE_BPS,
  quoteAssetDecimals,
  quoteTokenAddress,
  useBuyQuote,
  useSellQuote,
  useUsdgFaucet,
  type QuoteAsset,
  type TradeStage,
} from "@/hooks/use-pair-trade";
import { useCurveQuoteBuy, useCurveQuoteSell, useCurveTrade } from "@/hooks/use-curve-token";

const SLIPPAGE_OPTIONS = [100, 200, 300];
/** ETH and USDG swap into the pair's stocks through Uniswap; Stocks deposit directly. */
type TradeMethod = QuoteAsset | "STOCKS";
const SELL_PRESETS = [25, 50, 75, 100];
const ETH_GAS_RESERVE = 500_000_000_000_000n;
const LAUNCH_WINDOW_SECONDS = 30;

function compactTokens(amount: bigint): string {
  const n = Number(formatUnits(amount, 18));
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatAmount(amount: bigint, decimals: number): string {
  const n = Number(formatUnits(amount, decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: n !== 0 && n < 1 ? 6 : 4 });
}

export interface TokenTradePanelProps {
  token: Address;
  /** The creator token's pair vault (its stock-backed quote). */
  pair: Address;
  symbol: string;
  chain: PairOnchainState;
  tickerA: string;
  tickerB: string;
  decA: number;
  decB: number;
  priceA8?: bigint;
  priceB8?: bigint;
  launchTime: number;
  account?: Address;
  authenticated: boolean;
  walletReady: boolean;
  onLogin: () => void;
  onDone: () => void;
}

/** Pons-style Buy/Sell panel for a creator token, paid and settled in ETH or USDG. */
export function TokenTradePanel(props: TokenTradePanelProps) {
  const {
    token,
    pair,
    symbol,
    chain,
    tickerA,
    tickerB,
    decA,
    decB,
    priceA8,
    priceB8,
    launchTime,
    account,
    authenticated,
    walletReady,
    onLogin,
    onDone,
  } = props;

  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [method, setMethod] = useState<TradeMethod>("ETH");
  const [amount, setAmount] = useState("");
  const [amountAText, setAmountAText] = useState("");
  const [amountBText, setAmountBText] = useState("");
  const [sellPct, setSellPct] = useState(100);
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const stocks = method === "STOCKS";
  // Quote asset for the ETH/USDG (swap) paths; unused while paying with stocks.
  const asset: QuoteAsset = stocks ? "ETH" : method;
  useEffect(() => {
    setAmount("");
    setAmountAText("");
    setAmountBText("");
  }, [method, mode]);
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(id);
  }, []);

  const decimals = quoteAssetDecimals(asset);
  const quoteToken = quoteTokenAddress(asset);

  const native = useBalance({ address: account, query: { enabled: !!account, refetchInterval: 15_000 } });
  const usdgBalance = useReadContract({
    address: USDG_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    query: { enabled: !!account && usdgReady, refetchInterval: 15_000 },
  });
  const tokenBalanceRead = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    query: { enabled: !!account, refetchInterval: 10_000 },
  });
  const tokenBalance = (tokenBalanceRead.data as bigint | undefined) ?? 0n;
  const balance = asset === "ETH" ? (native.data?.value ?? 0n) : ((usdgBalance.data as bigint | undefined) ?? 0n);
  const spendable = asset === "ETH" ? (balance > ETH_GAS_RESERVE ? balance - ETH_GAS_RESERVE : 0n) : balance;

  const { prices } = useOraclePrices(WETH_ADDRESS ? [WETH_ADDRESS] : []);
  const assetPriceUsd = asset === "USDG" ? 1 : Number(prices.get(WETH_ADDRESS.toLowerCase()) ?? 0n) / 1e8;

  const amountIn = useMemo(() => {
    try {
      return amount ? parseUnits(amount, decimals) : 0n;
    } catch {
      return 0n;
    }
  }, [amount, decimals]);
  const amountUsd = Number(formatUnits(amountIn, decimals)) * assetPriceUsd;
  const sellTokens = (tokenBalance * BigInt(sellPct)) / 100n;

  // ─── Stocks path: deposit tokenA + tokenB straight into the pair, no swap ───
  const stockBalances = useTokenBalances(account, [chain.tokenA, chain.tokenB]);
  const balanceA = stockBalances.balances.get(chain.tokenA.toLowerCase()) ?? 0n;
  const balanceB = stockBalances.balances.get(chain.tokenB.toLowerCase()) ?? 0n;
  const amountA = useMemo(() => {
    try {
      return amountAText ? parseUnits(amountAText, decA) : 0n;
    } catch {
      return 0n;
    }
  }, [amountAText, decA]);
  const amountB = useMemo(() => {
    try {
      return amountBText ? parseUnits(amountBText, decB) : 0n;
    } catch {
      return 0n;
    }
  }, [amountBText, decB]);
  const stocksIn = stocks && mode === "buy" && (amountA > 0n || amountB > 0n);
  const stockPreview = useReadContract({
    address: pair,
    abi: pairVaultAbi,
    functionName: "previewDeposit",
    args: [amountA, amountB],
    query: { enabled: stocksIn, refetchInterval: 15_000 },
  });
  const pv = stockPreview.data as readonly [bigint, bigint, bigint] | undefined;
  // The CurveRouter is fee-exempt on the pair, so no creator deposit fee comes off.
  const stockShares = pv?.[0];
  const usedA = pv?.[1];
  const usedB = pv?.[2];
  const stockUsd =
    priceA8 && priceB8 && usedA !== undefined && usedB !== undefined
      ? Number(formatUnits(usedA, decA)) * (Number(priceA8) / 1e8) + Number(formatUnits(usedB, decB)) * (Number(priceB8) / 1e8)
      : undefined;
  const stockBuyQuote = useCurveQuoteBuy(token, stocksIn ? stockShares : undefined);

  // Buy: ETH/USDG → pair shares → tokens
  const sharesQuote = useBuyQuote({
    pair,
    tokenA: chain.tokenA,
    tokenB: chain.tokenB,
    reserveA: chain.reserveA,
    reserveB: chain.reserveB,
    priceA8,
    priceB8,
    decA,
    decB,
    asset,
    amountIn: mode === "buy" ? amountIn : 0n,
    feeBps: chain.creatorFeeBps,
    isCreator: false,
    feeExempt: true,
  });
  const buyQuote = useCurveQuoteBuy(token, mode === "buy" ? sharesQuote.shares : undefined);

  // Sell: tokens → pair shares → ETH/USDG
  const sellCurve = useCurveQuoteSell(token, mode === "sell" ? sellTokens : 0n);
  const sellQuote = useSellQuote({
    pair,
    tokenA: chain.tokenA,
    tokenB: chain.tokenB,
    shares: mode === "sell" && !stocks ? (sellCurve.sharesOut ?? 0n) : 0n,
    asset,
  });
  const stockRedeem = useReadContract({
    address: pair,
    abi: pairVaultAbi,
    functionName: "quoteRedeem",
    args: [sellCurve.sharesOut ?? 0n],
    query: { enabled: stocks && mode === "sell" && !!sellCurve.sharesOut && sellCurve.sharesOut > 0n, refetchInterval: 15_000 },
  });
  const rq = stockRedeem.data as readonly [bigint, bigint, bigint] | undefined;
  const outA = rq?.[0];
  const outB = rq?.[1];
  const minOutA = outA !== undefined ? (outA * BigInt(10_000 - slippageBps)) / 10_000n : 0n;
  const minOutB = outB !== undefined ? (outB * BigInt(10_000 - slippageBps)) / 10_000n : 0n;

  const venue = useTokenBalances(isTestnetMode() ? SWAP_ROUTER_ADDRESS : undefined, [chain.tokenA, chain.tokenB, quoteToken]);
  const venueHas = (t: Address) => venue.balances.get(t.toLowerCase()) ?? 0n;

  const trade = useCurveTrade();
  const faucet = useUsdgFaucet();
  const busy = trade.stage === "approve" || trade.stage === "submit";

  const tokensOut = stocks ? stockBuyQuote.tokensOut : buyQuote.tokensOut;
  const minTokensOut = tokensOut !== undefined ? (tokensOut * BigInt(10_000 - slippageBps)) / 10_000n : 0n;
  const amountOut = sellQuote.amountOut;
  const minAmountOut = amountOut !== undefined ? (amountOut * BigInt(10_000 - slippageBps)) / 10_000n : 0n;
  const launchProtected = launchTime > 0 && now < launchTime + LAUNCH_WINDOW_SECONDS;

  let blocker: string | null = null;
  if (mode === "buy" && stocks) {
    if (amountA === 0n && amountB === 0n) blocker = `Enter an amount of ${tickerA} or ${tickerB}`;
    else if (account && (amountA > balanceA || amountB > balanceB)) blocker = `Not enough ${amountA > balanceA ? tickerA : tickerB} in your wallet.`;
    else if (stockPreview.error || stockBuyQuote.error) blocker = "Quote unavailable. Prices may be stale; try again shortly.";
    else if (stockPreview.isLoading || stockShares === undefined || tokensOut === undefined) blocker = "Fetching quote…";
    else if (tokensOut === 0n) blocker = "Amount too small.";
  } else if (mode === "sell" && stocks) {
    if (tokenBalance === 0n) blocker = `You have no ${symbol} to sell.`;
    else if (sellCurve.error || stockRedeem.error) blocker = "Quote unavailable. Prices may be stale; try again shortly.";
    else if (sellCurve.loading || outA === undefined || outB === undefined) blocker = "Fetching quote…";
  } else if (mode === "buy") {
    if (amountIn === 0n) blocker = `Enter an amount of ${asset}`;
    else if (account && amountIn > spendable)
      blocker = asset === "ETH" ? "Not enough ETH (0.0005 ETH is kept for gas)." : "Not enough USDG in your wallet.";
    else if (sharesQuote.error || buyQuote.error) blocker = "Quote unavailable. Prices may be stale; try again shortly.";
    else if (sharesQuote.loading || sharesQuote.shares === undefined || tokensOut === undefined) blocker = "Fetching quote…";
    else if (tokensOut === 0n) blocker = "Amount too small.";
    else if (
      isTestnetMode() &&
      ((sharesQuote.outA !== undefined && chain.tokenA.toLowerCase() !== quoteToken.toLowerCase() && venueHas(chain.tokenA) < sharesQuote.outA) ||
        (sharesQuote.outB !== undefined && chain.tokenB.toLowerCase() !== quoteToken.toLowerCase() && venueHas(chain.tokenB) < sharesQuote.outB))
    )
      blocker = "Testnet swap liquidity is too low for this size. Try a smaller amount.";
  } else {
    if (tokenBalance === 0n) blocker = `You have no ${symbol} to sell.`;
    else if (sellCurve.error || sellQuote.error) blocker = "Quote unavailable. Prices may be stale; try again shortly.";
    else if (sellCurve.loading || amountOut === undefined) blocker = "Fetching quote…";
    else if (isTestnetMode() && venueHas(quoteToken) < amountOut)
      blocker = `Testnet swap liquidity has only ${formatAmount(venueHas(quoteToken), decimals)} ${asset}. Sell less or receive USDG.`;
  }

  async function submit() {
    trade.reset();
    try {
      if (stocks && mode === "buy") {
        await trade.buyWithStocks({ token, tokenA: chain.tokenA, tokenB: chain.tokenB, amountA, amountB, minTokensOut });
        setAmountAText("");
        setAmountBText("");
      } else if (stocks) {
        await trade.sellForStocks({ token, tokensIn: sellTokens, minAmountA: minOutA, minAmountB: minOutB });
      } else if (mode === "buy") {
        await trade.buy({ token, asset, amountIn, tokenA: chain.tokenA, tokenB: chain.tokenB, minTokensOut, slippageBps });
        setAmount("");
      } else {
        await trade.sell({
          token,
          asset,
          tokensIn: sellTokens,
          tokenA: chain.tokenA,
          tokenB: chain.tokenB,
          minAmountOut,
          slippageBps,
        });
      }
      void native.refetch();
      void usdgBalance.refetch();
      void tokenBalanceRead.refetch();
      stockBalances.refetch();
      venue.refetch();
      onDone();
    } catch {
      /* shown in the status list */
    }
  }

  const steps: Array<{ id: TradeStage; label: string }> =
    stocks && mode === "buy"
      ? [
          ...(amountA > 0n ? [{ id: "approve-a" as const, label: `Approve ${tickerA}` }] : []),
          ...(amountB > 0n ? [{ id: "approve-b" as const, label: `Approve ${tickerB}` }] : []),
          { id: "submit", label: `Buy ${symbol} with ${tickerA} + ${tickerB}` },
        ]
      : stocks
        ? [
            { id: "approve", label: `Approve ${symbol}` },
            { id: "submit", label: `Sell ${symbol} for ${tickerA} + ${tickerB}` },
          ]
        : mode === "buy"
          ? [
              ...(asset === "USDG" ? [{ id: "approve" as const, label: "Approve USDG" }] : []),
              { id: "submit", label: `Buy ${symbol} with ${asset}` },
            ]
          : [
              { id: "approve", label: `Approve ${symbol}` },
              { id: "submit", label: `Sell ${symbol} for ${asset}` },
            ];
  const order: TradeStage[] = ["approve", "approve-a", "approve-b", "submit", "done"];

  const noStocks = !!account && balanceA === 0n && balanceB === 0n;
  const prefix = mode === "buy" ? "" : "Receive ";
  const methodOptions: AssetOption<TradeMethod>[] = [
    {
      id: "ETH",
      label: `${prefix}ETH`,
      subtitle: mode === "buy" ? `Swapped into ${tickerA} + ${tickerB} automatically` : `${tickerA} + ${tickerB} swapped to ETH`,
      logo: <EthLogo />,
      balance: account ? `${formatAmount(native.data?.value ?? 0n, 18)} ETH` : undefined,
    },
    {
      id: "USDG",
      label: `${prefix}USDG`,
      subtitle: mode === "buy" ? "Swapped into the pair's stocks" : "The pair's stocks swapped to USDG",
      logo: <UsdgLogo />,
      balance: account ? `${formatAmount((usdgBalance.data as bigint | undefined) ?? 0n, 6)} USDG` : undefined,
    },
    {
      id: "STOCKS",
      label: `${prefix}${tickerA} + ${tickerB}`,
      subtitle: mode === "buy" ? "Pay with the pair's stocks you already hold" : "Get both stocks straight to your wallet",
      logo: <DualLogoStack tickerA={tickerA} tickerB={tickerB} size="sm" />,
      balance: account ? `${formatAmount(balanceA, decA)} / ${formatAmount(balanceB, decB)}` : undefined,
      dimmed: mode === "buy" && noStocks,
      dimmedNote: `No ${tickerA}/${tickerB} in wallet`,
    },
  ];

  return (
    <div className="overflow-hidden rounded-[1.75rem] border border-border bg-surface shadow-float">
      <div className="flex border-b border-border-subtle">
        {(["buy", "sell"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "flex-1 py-3 text-sm font-semibold capitalize transition-colors",
              mode === m
                ? m === "buy"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="p-5">
        <AssetSelect
          className="mb-4"
          label={mode === "buy" ? "Pay with" : "Receive"}
          value={method}
          onChange={setMethod}
          options={methodOptions}
        />

        {mode === "buy" && stocks ? (
          <div className="space-y-3">
            {(
              [
                { ticker: tickerA, text: amountAText, set: setAmountAText, balance: balanceA, dec: decA, id: "token-trade-amount-a" },
                { ticker: tickerB, text: amountBText, set: setAmountBText, balance: balanceB, dec: decB, id: "token-trade-amount-b" },
              ] as const
            ).map((leg) => (
              <div key={leg.id}>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <label htmlFor={leg.id}>You pay · {leg.ticker}</label>
                  {account && (
                    <button
                      type="button"
                      onClick={() => leg.set(formatUnits(leg.balance, leg.dec))}
                      className="font-mono transition-colors hover:text-foreground"
                    >
                      Balance {formatAmount(leg.balance, leg.dec)} {leg.ticker}
                    </button>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2 rounded-2xl border border-border bg-surface px-4 transition-colors focus-within:border-accent">
                  <input
                    id={leg.id}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.0"
                    value={leg.text}
                    onChange={(e) => leg.set(e.target.value.replace(/[^0-9.]/g, ""))}
                    className="h-12 w-full min-w-0 bg-transparent font-mono text-lg outline-none"
                  />
                  <span className="font-mono text-sm font-semibold">{leg.ticker}</span>
                </div>
              </div>
            ))}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Both stocks are deposited at the pair&apos;s weights; whatever isn&apos;t needed on one leg comes straight back
              to your wallet.{stockUsd !== undefined && ` ≈ ${formatUsd(stockUsd)} deposited.`}
            </p>
          </div>
        ) : mode === "buy" ? (
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <label htmlFor="token-trade-amount">You pay</label>
              {account && (
                <button
                  type="button"
                  onClick={() => setAmount(formatUnits(spendable, decimals))}
                  className="font-mono transition-colors hover:text-foreground"
                >
                  Balance {formatAmount(balance, decimals)} {asset}
                </button>
              )}
            </div>
            <div className="mt-2 flex items-center gap-2 rounded-2xl border border-border bg-surface px-4 transition-colors focus-within:border-accent">
              <input
                id="token-trade-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                className="h-14 w-full min-w-0 bg-transparent font-mono text-xl outline-none"
              />
              <span className="font-mono text-sm font-semibold">{asset}</span>
            </div>
            {amountUsd > 0 && <p className="mt-1 text-xs text-muted-foreground">≈ {formatUsd(amountUsd)}</p>}
          </div>
        ) : (
          <div>
            <p className="text-xs text-muted-foreground">Your {symbol}</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{compactTokens(tokenBalance)}</p>
            <div className="mt-3 flex gap-2">
              {SELL_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setSellPct(p)}
                  className={cn(
                    "flex-1 rounded-full border px-3 py-1.5 font-mono text-xs transition-all",
                    sellPct === p
                      ? "border-accent bg-accent-subtle text-accent-strong"
                      : "border-border text-muted-foreground hover:border-accent/40",
                  )}
                >
                  {p}%
                </button>
              ))}
            </div>
          </div>
        )}

        <dl className="mt-4 space-y-1.5 rounded-2xl border border-border bg-surface-muted p-4 font-mono text-xs">
          {mode === "buy" ? (
            <>
              <Row strong label="You receive" value={tokensOut !== undefined ? `≈ ${compactTokens(tokensOut)} ${symbol}` : "—"} />
              <Row label="Minimum received" value={tokensOut !== undefined ? `${compactTokens(minTokensOut)} ${symbol}` : "—"} />
              <Row label="Route" value={stocks ? `${tickerA} + ${tickerB} → ${symbol}` : `${asset} → ${tickerA} + ${tickerB} → ${symbol}`} />
            </>
          ) : stocks ? (
            <>
              <Row
                strong
                label="You receive"
                value={outA !== undefined && outB !== undefined ? `≈ ${formatAmount(outA, decA)} ${tickerA} + ${formatAmount(outB, decB)} ${tickerB}` : "—"}
              />
              {rq && <Row label="Value" value={formatUsd(Number(rq[2]) / 1e8)} />}
              <Row
                label="Minimum received"
                value={outA !== undefined && outB !== undefined ? `${formatAmount(minOutA, decA)} ${tickerA} + ${formatAmount(minOutB, decB)} ${tickerB}` : "—"}
              />
              <Row label="Route" value={`${symbol} → ${tickerA} + ${tickerB}`} />
            </>
          ) : (
            <>
              <Row strong label="You receive" value={amountOut !== undefined ? `≈ ${formatAmount(amountOut, decimals)} ${asset}` : "—"} />
              {amountOut !== undefined && <Row label="Value" value={formatUsd(Number(formatUnits(amountOut, decimals)) * assetPriceUsd)} />}
              <Row label="Minimum received" value={amountOut !== undefined ? `${formatAmount(minAmountOut, decimals)} ${asset}` : "—"} />
              <Row label="Route" value={`${symbol} → ${tickerA} + ${tickerB} → ${asset}`} />
            </>
          )}
          <Row
            label="Fees"
            value={stocks ? "1% curve · no swap · no pair deposit fee" : "1% curve · 0.3% Uniswap swap per leg · no pair deposit fee"}
          />
          <div className="flex items-center justify-between gap-3 pt-1">
            <dt className="text-muted-foreground">Max slippage</dt>
            <dd className="flex gap-1">
              {SLIPPAGE_OPTIONS.map((bps) => (
                <button
                  key={bps}
                  type="button"
                  onClick={() => setSlippageBps(bps)}
                  className={cn(
                    "rounded-full px-2 py-0.5 transition-colors",
                    slippageBps === bps ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {bps / 100}%
                </button>
              ))}
            </dd>
          </div>
        </dl>

        {launchProtected && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <ShieldCheck size={14} weight="fill" className="mt-0.5 shrink-0" />
            Launch protection for {launchTime + LAUNCH_WINDOW_SECONDS - now}s: max 5.5% of supply per buy, 5% per wallet.
          </p>
        )}
        {authenticated && blocker && !busy && trade.stage !== "done" && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info size={14} className="mt-0.5 shrink-0" />
            {blocker}
          </p>
        )}
        {isTestnetMode() && authenticated && asset === "USDG" && mode === "buy" && faucet.available && balance === 0n && (
          <button
            type="button"
            onClick={async () => {
              if (await faucet.claim()) void usdgBalance.refetch();
            }}
            disabled={faucet.pending}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-accent/60 px-4 py-2.5 text-xs font-semibold text-accent-strong transition-colors hover:bg-accent-subtle disabled:opacity-60"
          >
            <Drop size={14} weight="fill" />
            {faucet.pending ? "Claiming test USDG…" : "Get 1,000 test USDG"}
          </button>
        )}
        {isTestnetMode() && authenticated && !stocks && asset === "ETH" && mode === "buy" && balance < ETH_GAS_RESERVE * 2n && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Drop size={14} className="mt-0.5 shrink-0 text-accent-strong" />
            <span>
              Low on testnet ETH? Use the{" "}
              <a href={TESTNET_FAUCET_URL} target="_blank" rel="noopener noreferrer" className="text-accent-strong underline">
                Robinhood faucet ↗
              </a>
            </span>
          </p>
        )}

        {trade.stage !== "idle" && (
          <ol className="mt-4 space-y-2 rounded-2xl border border-border bg-surface p-4 text-xs">
            {steps.map((step) => {
              const current = trade.stage === step.id;
              const passed =
                trade.stage === "done" || (trade.stage !== "error" && order.indexOf(trade.stage) > order.indexOf(step.id));
              return (
                <li key={step.id} className="flex items-center gap-2">
                  {passed ? (
                    <CheckCircle size={16} weight="fill" className="text-success" />
                  ) : current ? (
                    <CircleNotch size={16} className="animate-spin text-accent-strong" />
                  ) : (
                    <span className="h-4 w-4 rounded-full border border-border" />
                  )}
                  <span className={cn(current ? "font-semibold text-foreground" : "text-muted-foreground")}>{step.label}</span>
                </li>
              );
            })}
            {trade.stage === "done" && (
              <li className="pt-1 font-semibold text-success">
                {mode === "buy" ? "Bought" : "Sold"} successfully.{" "}
                {trade.hash && (
                  <a href={explorerUrl("tx", trade.hash)} target="_blank" rel="noopener noreferrer" className="underline">
                    View transaction ↗
                  </a>
                )}
              </li>
            )}
            {trade.stage === "error" && trade.error && (
              <li className="flex items-start gap-1.5 pt-1 text-destructive">
                <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
                {trade.error}
              </li>
            )}
          </ol>
        )}

        {authenticated ? (
          <Button
            className={cn("mt-4 w-full", mode === "buy" ? "bg-emerald-600 hover:bg-emerald-600/90" : "")}
            size="lg"
            variant={mode === "sell" ? "inverse" : undefined}
            disabled={blocker !== null || busy}
            onClick={submit}
          >
            {busy ? "Processing…" : mode === "buy" ? `Buy ${symbol}` : `Sell ${sellPct}% for ${stocks ? `${tickerA} + ${tickerB}` : asset}`}
            {!busy && <ArrowRight size={16} weight="bold" />}
          </Button>
        ) : (
          <Button className="mt-4 w-full" size="lg" onClick={onLogin} disabled={!walletReady}>
            <Wallet size={16} />
            Connect wallet
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", strong && "text-sm")}>
      <dt className={strong ? "font-medium" : "text-muted-foreground"}>{label}</dt>
      <dd className={cn("text-right tabular-nums", strong && "font-medium")}>{value}</dd>
    </div>
  );
}

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
  Wallet,
  WarningCircle,
} from "@phosphor-icons/react";
import { TESTNET_FAUCET_URL, depositAmountError, isTestnetMode } from "@novex/config";
import { Button } from "@/components/ui/button";
import { cn, explorerUrl, formatUsd } from "@/lib/utils";
import {
  erc20Abi,
  pairRouterReady,
  SWAP_ROUTER_ADDRESS,
  USDG_ADDRESS,
  WETH_ADDRESS,
  usdgReady,
} from "@/lib/contracts";
import { useOraclePrices, useTokenBalances, type PairOnchainState } from "@/hooks/use-pair-launchpad";
import {
  DEFAULT_SLIPPAGE_BPS,
  quoteAssetDecimals,
  quoteTokenAddress,
  useBuyQuote,
  usePairTrade,
  useSellQuote,
  useUsdgFaucet,
  type QuoteAsset,
  type TradeStage,
} from "@/hooks/use-pair-trade";

export type TradeMethod = QuoteAsset | "STOCKS";

const SLIPPAGE_OPTIONS = [50, 100, 200, 300];
const SELL_PRESETS = [25, 50, 75, 100];
/** Kept back when paying with ETH so the wallet can still pay gas. */
const ETH_GAS_RESERVE = 500_000_000_000_000n;

function formatAmount(amount: bigint, decimals: number): string {
  const n = Number(formatUnits(amount, decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: n !== 0 && n < 1 ? 6 : 4 });
}

/** Pons-style "Pay with / Receive" switch: ETH · USDG · Stocks. */
export function TradeMethodPicker({
  mode,
  value,
  onChange,
  supported,
}: {
  mode: "buy" | "sell";
  value: TradeMethod;
  onChange: (method: TradeMethod) => void;
  /** Pair was created by the factory PairRouter trusts; undefined while loading. */
  supported: boolean | undefined;
}) {
  if (!pairRouterReady || supported === undefined) return null;
  if (!supported) {
    return (
      <p className="mb-4 flex items-start gap-1.5 rounded-2xl border border-border bg-surface-muted p-3 text-xs text-muted-foreground">
        <Info size={14} className="mt-0.5 shrink-0" />
        This pair was launched before ETH and USDG trading went live, so it only trades in stocks.
        Pairs launched from now on support ETH and USDG.
      </p>
    );
  }
  const options: Array<{ id: TradeMethod; label: string }> = [
    { id: "ETH", label: "ETH" },
    { id: "USDG", label: "USDG" },
    { id: "STOCKS", label: "Stocks" },
  ];
  return (
    <div className="mb-4">
      <p className="mb-2 text-xs text-muted-foreground">{mode === "buy" ? "Pay with" : "Receive"}</p>
      <div className="flex gap-1 rounded-full border border-border bg-surface-muted p-1" role="radiogroup">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
            className={cn(
              "flex-1 rounded-full px-3 py-1.5 font-mono text-xs font-semibold transition-all",
              value === o.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface TradePanelProps {
  mode: "buy" | "sell";
  asset: QuoteAsset;
  pair: Address;
  chain: PairOnchainState;
  symbol: string;
  tickerA: string;
  tickerB: string;
  decA: number;
  decB: number;
  priceA8?: bigint;
  priceB8?: bigint;
  isCreator: boolean;
  userShares: bigint;
  sharePriceUsd?: number;
  account?: Address;
  authenticated: boolean;
  walletReady: boolean;
  onLogin: () => void;
  onDone: () => void;
}

/** Buy a pair with ETH/USDG, or sell it for ETH/USDG, through PairRouter. */
export function TradePanel(props: TradePanelProps) {
  const {
    mode,
    asset,
    pair,
    chain,
    symbol,
    tickerA,
    tickerB,
    decA,
    decB,
    priceA8,
    priceB8,
    isCreator,
    userShares,
    sharePriceUsd,
    account,
    authenticated,
    walletReady,
    onLogin,
    onDone,
  } = props;

  const decimals = quoteAssetDecimals(asset);
  const quoteToken = quoteTokenAddress(asset);
  const [amount, setAmount] = useState("");
  const [sellPct, setSellPct] = useState(100);
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);

  useEffect(() => setAmount(""), [asset, mode]);

  // Wallet balances
  const native = useBalance({ address: account, query: { enabled: !!account, refetchInterval: 15_000 } });
  const usdgBalance = useReadContract({
    address: USDG_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    query: { enabled: !!account && usdgReady, refetchInterval: 15_000 },
  });
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
  const sellShares = (userShares * BigInt(sellPct)) / 100n;

  const buyQuote = useBuyQuote({
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
    isCreator,
  });
  const sellQuote = useSellQuote({
    pair,
    tokenA: chain.tokenA,
    tokenB: chain.tokenB,
    shares: mode === "sell" ? sellShares : 0n,
    asset,
  });

  // Testnet swap venue inventory: the router can only pay out what it holds.
  const venue = useTokenBalances(isTestnetMode() ? SWAP_ROUTER_ADDRESS : undefined, [chain.tokenA, chain.tokenB, quoteToken]);
  const venueHas = (token: Address) => venue.balances.get(token.toLowerCase());

  const trade = usePairTrade(pair);
  const faucet = useUsdgFaucet();
  const busy = trade.stage === "approve" || trade.stage === "operator" || trade.stage === "submit";

  const minShares =
    buyQuote.shares !== undefined ? (buyQuote.shares * BigInt(10_000 - slippageBps)) / 10_000n : 0n;
  const minAmountOut =
    sellQuote.amountOut !== undefined ? (sellQuote.amountOut * BigInt(10_000 - slippageBps)) / 10_000n : 0n;
  const buyValueUsd =
    buyQuote.shares !== undefined && sharePriceUsd != null
      ? Number(formatUnits(buyQuote.shares, 18)) * sharePriceUsd
      : undefined;
  const sellOutUsd =
    sellQuote.amountOut !== undefined ? Number(formatUnits(sellQuote.amountOut, decimals)) * assetPriceUsd : undefined;

  let blocker: string | null = null;
  if (mode === "buy") {
    const legShort = (token: Address, out: bigint | undefined) =>
      isTestnetMode() && out !== undefined && token.toLowerCase() !== quoteToken.toLowerCase() &&
      (venueHas(token) ?? 0n) < out;
    if (amountIn === 0n) blocker = `Enter an amount of ${asset}`;
    else if (account && amountIn > spendable)
      blocker = asset === "ETH" ? "Not enough ETH (0.0005 ETH is kept for gas)." : "Not enough USDG in your wallet.";
    else if (assetPriceUsd > 0 && depositAmountError(amountUsd)) blocker = depositAmountError(amountUsd);
    else if (buyQuote.error) blocker = "Quote unavailable. Prices may be stale; try again shortly.";
    else if (buyQuote.loading || buyQuote.shares === undefined) blocker = "Fetching quote…";
    else if (buyQuote.shares === 0n) blocker = "Amount too small to mint any shares.";
    else if (legShort(chain.tokenA, buyQuote.outA) || legShort(chain.tokenB, buyQuote.outB))
      blocker = "Testnet swap liquidity is too low for this size. Try a smaller amount.";
  } else {
    if (userShares === 0n) blocker = `You have no ${symbol} to sell.`;
    else if (sellQuote.error) blocker = "Quote unavailable. Prices may be stale; try again shortly.";
    else if (sellQuote.loading || sellQuote.amountOut === undefined) blocker = "Fetching quote…";
    else if (isTestnetMode() && (venueHas(quoteToken) ?? 0n) < sellQuote.amountOut)
      blocker = `Testnet swap liquidity has only ${formatAmount(venueHas(quoteToken) ?? 0n, decimals)} ${asset}. Sell less or receive USDG.`;
  }

  async function submit() {
    trade.reset();
    try {
      if (mode === "buy") {
        await trade.buy({
          asset,
          tokenA: chain.tokenA,
          tokenB: chain.tokenB,
          amountIn,
          minShares,
          slippageBps,
        });
        setAmount("");
      } else {
        await trade.sell({
          asset,
          tokenA: chain.tokenA,
          tokenB: chain.tokenB,
          shares: sellShares,
          minAmountOut,
          slippageBps,
        });
      }
      void native.refetch();
      void usdgBalance.refetch();
      venue.refetch();
      onDone();
    } catch {
      /* shown in the status list */
    }
  }

  const steps: Array<{ id: TradeStage; label: string }> =
    mode === "buy"
      ? [
          ...(asset === "USDG" ? [{ id: "approve" as const, label: "Approve USDG" }] : []),
          { id: "submit", label: `Buy ${symbol} with ${asset}` },
        ]
      : [
          { id: "operator", label: "Enable selling (once per pair)" },
          { id: "submit", label: `Sell ${symbol} for ${asset}` },
        ];
  const stageOrder: TradeStage[] = ["approve", "operator", "submit", "done"];

  return (
    <div>
      {mode === "buy" ? (
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <label htmlFor="trade-amount">You pay</label>
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
              id="trade-amount"
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
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{formatAmount(userShares, 18)}</p>
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
            <Row
              label="You receive"
              value={buyQuote.shares !== undefined ? `≈ ${formatAmount(buyQuote.shares, 18)} ${symbol}` : "—"}
              strong
            />
            {buyValueUsd !== undefined && <Row label="Value" value={formatUsd(buyValueUsd)} />}
            <Row label="Minimum received" value={buyQuote.shares !== undefined ? `${formatAmount(minShares, 18)} ${symbol}` : "—"} />
            <Row
              label={`Creator fee (${(chain.creatorFeeBps / 100).toFixed(1)}%)`}
              value={isCreator ? "waived (your pair)" : "paid in shares"}
            />
            <Row label="Route" value={`${asset} → ${tickerA} + ${tickerB}`} />
          </>
        ) : (
          <>
            <Row
              label="You receive"
              value={sellQuote.amountOut !== undefined ? `≈ ${formatAmount(sellQuote.amountOut, decimals)} ${asset}` : "—"}
              strong
            />
            {sellOutUsd !== undefined && <Row label="Value" value={formatUsd(sellOutUsd)} />}
            <Row
              label="Minimum received"
              value={sellQuote.amountOut !== undefined ? `${formatAmount(minAmountOut, decimals)} ${asset}` : "—"}
            />
            <Row label="Route" value={`${tickerA} + ${tickerB} → ${asset}`} />
          </>
        )}
        <Row label="Pool fee" value="0.3% per swap" />
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

      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        {mode === "buy"
          ? `Your ${asset} is swapped into ${tickerA} and ${tickerB}, deposited into the pair, and any leftover stock dust is sent back to your wallet.`
          : `Your ${symbol} is redeemed for ${tickerA} and ${tickerB}, which are swapped to ${asset}. Swaps never fill more than your slippage below the oracle price.`}
      </p>

      {authenticated && blocker && !busy && trade.stage !== "done" && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info size={14} className="mt-0.5 shrink-0" />
          {blocker}
        </p>
      )}

      {isTestnetMode() && authenticated && asset === "USDG" && faucet.available && balance === 0n && (
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
      {faucet.error && <p className="mt-2 text-xs text-destructive">{faucet.error}</p>}
      {isTestnetMode() && authenticated && asset === "ETH" && mode === "buy" && balance < ETH_GAS_RESERVE * 2n && (
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
              trade.stage === "done" ||
              (trade.stage !== "error" && stageOrder.indexOf(trade.stage) > stageOrder.indexOf(step.id));
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
          className="mt-4 w-full"
          size="lg"
          variant={mode === "sell" ? "inverse" : undefined}
          disabled={blocker !== null || busy}
          onClick={submit}
        >
          {busy ? "Processing…" : mode === "buy" ? `Buy ${symbol} with ${asset}` : `Sell ${sellPct}% for ${asset}`}
          {!busy && <ArrowRight size={16} weight="bold" />}
        </Button>
      ) : (
        <Button className="mt-4 w-full" size="lg" onClick={onLogin} disabled={!walletReady}>
          <Wallet size={16} />
          Connect wallet
        </Button>
      )}
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

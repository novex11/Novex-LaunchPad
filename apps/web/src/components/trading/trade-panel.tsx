"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  CheckCircle,
  Wallet,
  WarningCircle,
  Stack,
} from "@phosphor-icons/react";
import { CASHBACK_CONFIG } from "@novex/config";
import type { MarketStock, QuoteData } from "@/lib/markets";
import { isForexPair } from "@/lib/markets";
import { fetchHoldings, recordTrade, type TradeSide, type DirectHolding } from "@/lib/api";
import { useWallet } from "@/hooks/use-wallet";
import { useRewardPreview } from "@/hooks/use-reward-preview";
import { useBackendHealth } from "@/hooks/use-backend-health";
import { formatUsd } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StockLogo } from "@/components/ui/stock-logo";
import { PriceFlash } from "@/components/ui/price-flash";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Skeleton } from "@/components/ui/skeleton";

interface TradePanelProps {
  stock: MarketStock;
  quote: QuoteData | undefined;
  defaultSide?: TradeSide;
  /** Called after a trade is recorded */
  onTraded?: (side: TradeSide) => void;
  className?: string;
  /** Hide the header (used inside sheets that already show the stock) */
  embedded?: boolean;
}

const PRESETS = [100, 250, 500, 1000];
const spring = { type: "spring", stiffness: 100, damping: 20 } as const;

export function TradePanel({
  stock,
  quote,
  defaultSide = "buy",
  onTraded,
  className,
  embedded = false,
}: TradePanelProps) {
  const wallet = useWallet();
  const qc = useQueryClient();
  const { health } = useBackendHealth();
  const [side, setSide] = useState<TradeSide>(defaultSide);
  const [usd, setUsd] = useState("500");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ side: TradeSide; qty: number; usd: number } | null>(null);
  const [holding, setHolding] = useState<DirectHolding | null | undefined>(undefined);

  const price = quote?.price;
  const amount = Number(usd) || 0;
  const qty = price && amount > 0 ? amount / price : 0;
  const forex = isForexPair(stock.ticker);

  // Reward line: what this amount would earn if routed through a basket
  const preview = useRewardPreview(
    side === "buy" && !forex && amount > 0
      ? { depositTicker: stock.ticker, depositUsd: amount, strategy: "balanced" }
      : null,
    wallet.address,
  );

  // Load current holding for sell side
  useEffect(() => {
    if (!wallet.address) {
      setHolding(null);
      return;
    }
    let cancelled = false;
    fetchHoldings(wallet.address)
      .then((r) => {
        if (cancelled) return;
        setHolding(r.holdings.find((h) => h.ticker === stock.ticker) ?? null);
      })
      .catch(() => !cancelled && setHolding(null));
    return () => {
      cancelled = true;
    };
  }, [wallet.address, stock.ticker, done]);

  const maxSellUsd = useMemo(
    () => (holding && price ? holding.qty * price : 0),
    [holding, price],
  );

  const disabledReason = !wallet.authenticated
    ? null
    : !price
      ? "Waiting for a live quote"
      : amount <= 0
        ? "Enter an amount"
        : side === "sell" && amount > maxSellUsd + 0.005
          ? `You hold ${formatUsd(maxSellUsd)} of ${stock.ticker}`
          : !health.indexer
            ? "Indexer offline — trades cannot be recorded"
            : null;

  async function submit() {
    if (!wallet.address || !price || amount <= 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const q = amount / price;
      await recordTrade({
        wallet: wallet.address,
        ticker: stock.ticker,
        side,
        qty: q,
        priceUsd: price,
        valueUsd: amount,
      });
      setDone({ side, qty: q, usd: amount });
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      onTraded?.(side);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trade failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col rounded-3xl border border-border bg-surface shadow-card",
        className,
      )}
    >
      {!embedded && (
        <div className="flex items-start justify-between gap-4 border-b border-border-subtle p-5">
          <div className="flex items-center gap-3">
            <StockLogo ticker={stock.ticker} size="md" />
            <div>
              <p className="text-sm font-semibold leading-tight">{stock.name}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {stock.exchange}:{stock.ticker}
              </p>
            </div>
          </div>
          <div className="text-right">
            {quote ? (
              <>
                <p className="font-mono text-xl font-medium tabular-nums">
                  <PriceFlash value={quote.price}>{formatUsd(quote.price)}</PriceFlash>
                </p>
                <p
                  className={cn(
                    "font-mono text-xs tabular-nums",
                    quote.change >= 0 ? "text-success" : "text-destructive",
                  )}
                >
                  {quote.change >= 0 ? "+" : ""}
                  {quote.change.toFixed(2)} ({quote.changePercent.toFixed(2)}%)
                </p>
              </>
            ) : (
              <>
                <Skeleton className="ml-auto h-6 w-24" />
                <Skeleton className="ml-auto mt-1.5 h-3 w-16" />
              </>
            )}
          </div>
        </div>
      )}

      <div className="p-5">
        {/* Side toggle */}
        <div className="relative grid grid-cols-2 rounded-full bg-surface-muted p-1">
          {(["buy", "sell"] as TradeSide[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSide(s);
                setDone(null);
                setError(null);
              }}
              className={cn(
                "relative z-10 rounded-full py-2 text-sm font-medium capitalize transition-colors",
                side === s ? "text-accent-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {side === s && (
                <motion.span
                  layoutId={`trade-side-${stock.ticker}-${embedded ? "e" : "p"}`}
                  className={cn(
                    "absolute inset-0 rounded-full",
                    s === "buy" ? "bg-accent" : "bg-surface-inverse",
                  )}
                  transition={spring}
                />
              )}
              <span className="relative">{s}</span>
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {done ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={spring}
              className="mt-6 rounded-2xl border border-success/30 bg-success/5 p-5 text-center"
            >
              <CheckCircle size={32} weight="fill" className="mx-auto text-success" />
              <p className="mt-3 text-sm font-semibold">
                {done.side === "buy" ? "Bought" : "Sold"} {done.qty.toFixed(4)} {stock.ticker}
              </p>
              <p className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
                {formatUsd(done.usd)} at {formatUsd(price ?? 0)}
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link href="/portfolio">View portfolio</Link>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDone(null)}>
                  Trade again
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="mt-6"
            >
              <label className="block">
                <span className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">Amount (USD)</span>
                  {side === "sell" && holding !== undefined && (
                    <button
                      type="button"
                      className="font-mono text-xs text-accent-strong hover:underline"
                      onClick={() => setUsd(maxSellUsd.toFixed(2))}
                    >
                      Max {formatUsd(maxSellUsd)}
                    </button>
                  )}
                </span>
                <div className="relative mt-2">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                    $
                  </span>
                  <Input
                    inputMode="decimal"
                    value={usd}
                    onChange={(e) => setUsd(e.target.value.replace(/[^\d.]/g, ""))}
                    className="h-12 pl-7 font-mono text-lg tabular-nums"
                    aria-label="Amount in USD"
                  />
                </div>
              </label>

              <div className="mt-3 flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setUsd(String(p))}
                    className={cn(
                      "rounded-full border px-3 py-1 font-mono text-xs transition-all active:scale-[0.98]",
                      amount === p
                        ? "border-accent bg-accent-subtle text-accent-strong"
                        : "border-border text-muted-foreground hover:border-accent/40",
                    )}
                  >
                    ${p}
                  </button>
                ))}
              </div>

              <dl className="mt-5 space-y-2 rounded-2xl bg-surface-muted p-4 font-mono text-xs">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Est. quantity</dt>
                  <dd className="tabular-nums">{qty ? `${qty.toFixed(4)} ${stock.ticker}` : "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Price</dt>
                  <dd className="tabular-nums">{price ? formatUsd(price) : "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Platform fee</dt>
                  <dd className="tabular-nums text-success">$0.00</dd>
                </div>
                {side === "sell" && holding && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">You hold</dt>
                    <dd className="tabular-nums">
                      {holding.qty.toFixed(4)} · avg {formatUsd(holding.avgPriceUsd)}
                    </dd>
                  </div>
                )}
                {side === "buy" && !forex && (
                  <div className="flex items-start justify-between border-t border-border pt-2">
                    <dt className="text-muted-foreground">
                      Stockback if deposited to a basket
                      <span className="block text-[10px] opacity-70">
                        min {formatUsd(CASHBACK_CONFIG.minEligibleDepositUsd)} ·{" "}
                        {preview.source === "allocator" ? "allocator" : "estimate"}
                      </span>
                    </dt>
                    <dd className="tabular-nums font-medium text-accent-strong">
                      <NumberTicker
                        value={preview.data?.stockback.totalStockbackUsd ?? 0}
                        decimals={2}
                        prefix="+$"
                        startOnView={false}
                        duration={0.5}
                      />
                    </dd>
                  </div>
                )}
              </dl>

              {error && (
                <p className="mt-3 flex items-center gap-2 text-xs text-destructive">
                  <WarningCircle size={14} />
                  {error}
                </p>
              )}
              {disabledReason && wallet.authenticated && (
                <p className="mt-3 text-xs text-muted-foreground">{disabledReason}</p>
              )}

              <div className="mt-5 space-y-2">
                {wallet.authenticated ? (
                  <Button
                    className="w-full"
                    size="lg"
                    variant={side === "buy" ? "default" : "inverse"}
                    disabled={Boolean(disabledReason) || submitting}
                    onClick={submit}
                  >
                    {submitting ? "Recording…" : `${side === "buy" ? "Buy" : "Sell"} ${stock.ticker}`}
                    {!submitting && <ArrowRight size={16} weight="bold" />}
                  </Button>
                ) : (
                  <Button className="w-full" size="lg" onClick={wallet.login}>
                    <Wallet size={16} />
                    {wallet.demo ? "Use demo wallet" : "Connect wallet to trade"}
                  </Button>
                )}
                {!forex && (
                  <Button asChild variant="outline" className="w-full" size="lg">
                    <Link href={`/create?deposit=${stock.ticker}&amount=${amount || 500}`}>
                      <Stack size={16} />
                      Build a basket with {stock.ticker}
                    </Link>
                  </Button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

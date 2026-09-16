"use client";

import { useState } from "react";
import { useParams, notFound } from "next/navigation";
import Link from "next/link";
import { motion } from "motion/react";
import { CaretLeft, Star } from "@phosphor-icons/react";
import { CASHBACK_CONFIG, ALLOCATION_STOCKBACK_RATES, DEFAULT_ALLOCATION_RATE, stockbackTopBand } from "@compose/config";
import { getMarketStock, isForexPair } from "@/lib/markets";
import { useQuote } from "@/hooks/use-quotes";
import { useWatchlist } from "@/hooks/use-watchlist";
import { formatUsd } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { TradingViewChart } from "@/components/trading/trading-view-chart";
import { TradePanel } from "@/components/trading/trade-panel";
import { StockLogo } from "@/components/ui/stock-logo";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/ui/sparkline";

const INTERVALS = [
  { label: "1m", value: "1" as const },
  { label: "5m", value: "5" as const },
  { label: "15m", value: "15" as const },
  { label: "1H", value: "60" as const },
  { label: "1D", value: "D" as const },
  { label: "1W", value: "W" as const },
];

export default function StockDetailPage() {
  const params = useParams();
  const ticker = (params.ticker as string).toUpperCase();
  const stock = getMarketStock(ticker);
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]["value"]>("D");
  const { quote, isLoading, updatedAt } = useQuote(stock?.ticker);
  const watchlist = useWatchlist();

  if (!stock) notFound();

  const forex = isForexPair(ticker);
  const up = (quote?.change ?? 0) >= 0;
  const rate = ALLOCATION_STOCKBACK_RATES[ticker] ?? DEFAULT_ALLOCATION_RATE;
  const starred = watchlist.has(ticker);
  const dayLow = quote ? Math.min(...quote.sparkline) : undefined;
  const dayHigh = quote ? Math.max(...quote.sparkline) : undefined;

  return (
    <div className="container-page min-h-[100dvh] py-6 md:py-8">
      <Link
        href="/markets"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <CaretLeft size={14} />
        All markets
      </Link>

      {/* Header */}
      <div className="mt-5 grid gap-6 md:grid-cols-12 md:items-end">
        <div className="flex items-center gap-4 md:col-span-7">
          <StockLogo ticker={ticker} size="xl" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{stock.name}</h1>
              <button
                type="button"
                onClick={() => watchlist.toggle(ticker)}
                aria-label={starred ? "Remove from watchlist" : "Add to watchlist"}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-full border transition-all active:scale-[0.98]",
                  starred ? "border-gold/40 text-gold" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <Star size={14} weight={starred ? "fill" : "regular"} />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">
                {stock.exchange}:{ticker}
              </span>
              <Badge variant="secondary">{stock.category}</Badge>
              {!forex && <Badge variant="accent">Stockback {(rate * 100).toFixed(1)}%</Badge>}
            </div>
          </div>
        </div>
        <div className="md:col-span-5 md:text-right">
          {quote ? (
            <>
              <p className="font-mono text-3xl font-medium tabular-nums md:text-4xl">
                <NumberTicker value={quote.price} decimals={forex ? 4 : 2} prefix={forex ? "" : "$"} startOnView={false} duration={0.6} />
              </p>
              <p className={cn("mt-1 font-mono text-sm tabular-nums", up ? "text-success" : "text-destructive")}>
                {up ? "+" : ""}
                {quote.change.toFixed(forex ? 4 : 2)} ({up ? "+" : ""}
                {quote.changePercent.toFixed(2)}%) today
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                Updated {new Date(updatedAt).toLocaleTimeString()} · refreshes every 15s
              </p>
            </>
          ) : (
            <div className="space-y-2 md:flex md:flex-col md:items-end">
              <Skeleton className="h-10 w-40" />
              <Skeleton className="h-4 w-28" />
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between">
            <div className="inline-flex rounded-full bg-surface-muted p-1">
              {INTERVALS.map((i) => (
                <button
                  key={i.value}
                  type="button"
                  onClick={() => setInterval(i.value)}
                  className={cn(
                    "relative rounded-full px-3 py-1.5 font-mono text-xs font-medium transition-colors",
                    interval === i.value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {interval === i.value && (
                    <motion.span
                      layoutId="interval-pill"
                      className="absolute inset-0 rounded-full bg-surface shadow-card"
                      transition={{ type: "spring", stiffness: 100, damping: 20 }}
                    />
                  )}
                  <span className="relative z-10">{i.label}</span>
                </button>
              ))}
            </div>
            <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
              Chart by TradingView
            </span>
          </div>

          <TradingViewChart stock={stock} interval={interval} height={520} />

          {/* Stats strip */}
          <dl className="mt-6 grid grid-cols-2 divide-y divide-border-subtle rounded-3xl border border-border bg-surface sm:grid-cols-4 sm:divide-x sm:divide-y-0">
            {[
              ["Day low", dayLow != null ? formatUsd(dayLow) : "—"],
              ["Day high", dayHigh != null ? formatUsd(dayHigh) : "—"],
              ["Stockback rate", forex ? "n/a" : `${(rate * 100).toFixed(2)}%`],
              ["Platform fee", "$0.00"],
            ].map(([k, v]) => (
              <div key={k} className="p-4">
                <dt className="label-caps">{k}</dt>
                <dd className="mt-1 font-mono text-lg font-medium tabular-nums">
                  {isLoading && k?.startsWith("Day") ? <Skeleton className="h-6 w-20" /> : v}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-6 grid gap-6 md:grid-cols-12">
            <div className="rounded-3xl border border-border bg-surface-muted p-6 md:col-span-7">
              <h3 className="text-base font-semibold">About {ticker}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {forex
                  ? `${stock.name} is available as a tokenized forex pair on Robinhood Chain. Forex tokens track live exchange rates via onchain oracles and can be included in a basket for currency diversification.`
                  : `${stock.name} is available as a Robinhood Stock Token on Robinhood Chain. Tokenized exposure tracks the underlying price but does not grant legal rights in the security. Deposits of ${formatUsd(CASHBACK_CONFIG.minEligibleDepositUsd)} or more into a basket earn an instant bonus that grows with size, from ${formatUsd(CASHBACK_CONFIG.depositStockbackUsd)} up to ${formatUsd(stockbackTopBand("balanced").rewardUsd)} on Balanced, plus ${(rate * 100).toFixed(2)}% on the ${ticker} allocation.`}
              </p>
            </div>
            <div className="rounded-3xl border border-border bg-surface p-6 md:col-span-5">
              <p className="label-caps">Intraday</p>
              <div className="mt-3">
                <Sparkline data={quote?.sparkline ?? []} width={280} height={72} positive={up} className="w-full" />
              </div>
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                5-minute bars · {quote?.sparkline.length ?? 0} points
              </p>
            </div>
          </div>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <TradePanel stock={stock} quote={quote} />
        </aside>
      </div>
    </div>
  );
}

"use client";

import { useMemo } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, Stack } from "@phosphor-icons/react";
import { formatUnits } from "viem";
import { formatUsd } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { RECEIPT_SHARE_DECIMALS, useReceiptPositions } from "@/hooks/use-receipt-positions";
import { useWallet } from "@/hooks/use-wallet";
import { usePortfolio, useActivity } from "@/hooks/use-portfolio";
import { useQuotes } from "@/hooks/use-quotes";
import { Button } from "@/components/ui/button";
import { StockLogo } from "@/components/ui/stock-logo";
import { PriceFlash } from "@/components/ui/price-flash";
import { EmptyState, BasketGlyph } from "@/components/ui/empty-state";
import { RowSkeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ConnectGate } from "@/components/app/connect-gate";
import { MetricBand } from "@/components/app/metric-band";
import { ActivityList } from "@/components/app/activity-list";
import { OnChainVerifiedBadge } from "@/components/receipt/on-chain-verified-badge";

const spring = { type: "spring", stiffness: 100, damping: 20 } as const;

export default function PortfolioPage() {
  const wallet = useWallet();
  const { data, isLoading, isError } = usePortfolio(wallet.address);
  const activity = useActivity(wallet.address);

  const onChainPositions = useReceiptPositions(wallet.address);

  const holdings = data?.directHoldings ?? [];
  const tickers = useMemo(
    () => Array.from(new Set([...holdings.map((h) => h.ticker), ...(data?.allocation ?? []).map((a) => a.ticker)])),
    [holdings, data],
  );
  const { byTicker } = useQuotes(tickers);

  // Mark direct holdings to market with live quotes
  const holdingsMtm = holdings.map((h) => {
    const price = byTicker.get(h.ticker)?.price;
    const value = price != null ? h.qty * price : h.costUsd;
    return { ...h, price, value, pnl: value - h.costUsd };
  });
  const holdingsValue = holdingsMtm.reduce((s, h) => s + h.value, 0);
  const holdingsCost = holdingsMtm.reduce((s, h) => s + h.costUsd, 0);

  const chainPositions = onChainPositions.data ?? [];
  const onchainBasketValue = chainPositions.reduce((s, p) => s + p.valueUsd, 0);
  const basketValue =
    chainPositions.length > 0 ? onchainBasketValue : (data?.currentValueUsd ?? 0);
  const totalValue = basketValue + holdingsValue;
  const netPerf = (data?.netPerformanceUsd ?? 0) + (holdingsValue - holdingsCost);
  const primaryReceipt = chainPositions[0];
  // Vault shares are minted at 1e-8 USD scale (see StrategyVault.deposit), not 18 decimals.
  const receiptBalance = primaryReceipt
    ? formatUnits(primaryReceipt.receiptBalance, RECEIPT_SHARE_DECIMALS)
    : (data?.receiptBalance ?? "0");

  const hasBasket =
    chainPositions.length > 0 || Boolean(data && !data.empty && data.depositAsset);
  const hasAnything = hasBasket || holdings.length > 0;
  const onChainVerified = chainPositions.length > 0;

  if (!wallet.authenticated) {
    return (
      <ConnectGate
        eyebrow="Your positions"
        title="Portfolio"
        description="Basket value, direct stock holdings, Stockback earned and every allocation — marked to market with live quotes."
      />
    );
  }

  return (
    <div className="container-page min-h-[100dvh] py-8 md:py-10">
      <div className="grid gap-6 md:grid-cols-12 md:items-end">
        <div className="md:col-span-8">
          <p className="label-caps">Your positions</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">Portfolio</h1>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {wallet.address?.slice(0, 6)}…{wallet.address?.slice(-4)}
          </p>
        </div>
        <div className="flex gap-2 md:col-span-4 md:justify-end">
          <Button asChild variant="outline">
            <Link href="/markets">Trade</Link>
          </Button>
          <Button asChild>
            <Link href="/create">
              New basket
              <ArrowRight size={14} weight="bold" />
            </Link>
          </Button>
        </div>
      </div>

      <MetricBand
        className="mt-8"
        loading={isLoading}
        metrics={[
          { label: "Total value", value: formatUsd(totalValue) },
          {
            label: "Net performance",
            value: `${netPerf >= 0 ? "+" : "−"}${formatUsd(Math.abs(netPerf))}`,
            tone: netPerf >= 0 ? "success" : "destructive",
          },
          { label: "Stockback earned", value: formatUsd(data?.totalStockbackUsd ?? 0), tone: "accent" },
          {
            label: "Receipt tokens",
            value: Number(receiptBalance).toLocaleString(undefined, { maximumFractionDigits: 3 }),
            hint: primaryReceipt
              ? `${primaryReceipt.receiptSymbol} · on-chain`
              : hasBasket
                ? (data?.vaultId ?? undefined)
                : "No basket yet",
          },
        ]}
      />

      {isError && (
        <p className="mt-4 text-sm text-destructive">
          Could not reach the indexer. Start the services with <code className="font-mono">pnpm dev</code>.
        </p>
      )}

      {!isLoading && !isError && !hasAnything && (
        <EmptyState
          illustration={<BasketGlyph />}
          title="Your first basket starts here"
          description="Deposit one stock and the allocator builds a diversified basket with Stockback on every line. Direct stock trades show up here too."
          className="mt-8 py-16"
          action={
            <div className="flex gap-2">
              <Button asChild>
                <Link href="/create">Create a basket</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/markets">Browse markets</Link>
              </Button>
            </div>
          }
        />
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-12">
        {/* Basket */}
        <section className="lg:col-span-7">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">Basket allocation</h2>
            {onChainVerified && <OnChainVerifiedBadge />}
            {hasBasket && !primaryReceipt && (
              <Badge variant="accent">
                <Stack size={12} />
                {data?.vaultId} · {data?.strategy}
              </Badge>
            )}
          </div>

          {chainPositions.length > 0 && (
            <div className="mb-4 grid gap-2">
              {chainPositions.map((pos) => (
                <div
                  key={pos.receiptTokenAddress}
                  className="flex items-center justify-between rounded-2xl border border-border bg-surface-muted/60 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <StockLogo ticker={pos.depositTicker} size="md" />
                    <div>
                      <p className="font-mono text-sm font-semibold">{pos.receiptSymbol}</p>
                      <p className="text-xs capitalize text-muted-foreground">{pos.strategy}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm tabular-nums">{formatUsd(pos.valueUsd)}</p>
                    <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {Number(formatUnits(pos.receiptBalance, RECEIPT_SHARE_DECIMALS)).toFixed(3)} · share{" "}
                      {pos.sharePriceUsd.toFixed(4)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="overflow-hidden rounded-3xl border border-border bg-surface shadow-card">
            {isLoading ? (
              <RowSkeleton rows={5} />
            ) : !hasBasket ? (
              <EmptyState
                icon={Stack}
                title="No basket"
                description="Deposit one stock and the allocator builds a diversified basket for you."
                action={
                  <Button asChild size="sm">
                    <Link href="/create">Create a basket</Link>
                  </Button>
                }
                className="m-4 border-0 bg-transparent py-10"
              />
            ) : (
              <>
                <ul className="divide-y divide-border-subtle">
                  {data!.allocation.map((a, i) => {
                    const q = byTicker.get(a.ticker);
                    return (
                      <motion.li
                        key={a.ticker}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ ...spring, delay: i * 0.03 }}
                        className="grid grid-cols-[2.5rem_1fr_6rem] items-center gap-4 px-5 py-3.5 md:grid-cols-[2.5rem_1fr_7rem_6rem]"
                      >
                        <StockLogo ticker={a.ticker} size="md" />
                        <div className="min-w-0">
                          <div className="flex items-baseline justify-between text-sm">
                            <Link href={`/markets/${a.ticker}`} className="font-semibold hover:underline">
                              {a.ticker}
                            </Link>
                            <span className="font-mono text-xs tabular-nums text-muted-foreground">
                              {(a.weight * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                            <motion.div
                              className="h-full rounded-full bg-accent"
                              initial={{ width: 0 }}
                              animate={{ width: `${a.weight * 100}%` }}
                              transition={{ ...spring, delay: 0.1 + i * 0.03 }}
                            />
                          </div>
                        </div>
                        <p className="hidden text-right font-mono text-xs tabular-nums text-muted-foreground md:block">
                          {q ? <PriceFlash value={q.price}>{formatUsd(q.price)}</PriceFlash> : "—"}
                        </p>
                        <p className="text-right font-mono text-sm tabular-nums">{formatUsd(a.usd)}</p>
                      </motion.li>
                    );
                  })}
                </ul>
                <div className="flex items-center justify-between border-t border-border bg-surface-muted/60 px-5 py-3 text-xs text-muted-foreground">
                  <span>
                    Deposit asset {primaryReceipt?.depositTicker ?? data?.depositAsset} · share price{" "}
                    <span className="font-mono tabular-nums">
                      {(primaryReceipt?.sharePriceUsd ?? data?.sharePrice ?? 1).toFixed(4)}
                    </span>
                    {onChainVerified && " · on-chain NAV"}
                  </span>
                  <Link href="/redeem" className="font-medium text-accent-strong hover:underline">
                    Redeem
                  </Link>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Direct holdings */}
        <section className="lg:col-span-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Direct holdings</h2>
            <span className="font-mono text-xs text-muted-foreground">{formatUsd(holdingsValue)}</span>
          </div>
          <div className="overflow-hidden rounded-3xl border border-border bg-surface shadow-card">
            {isLoading ? (
              <RowSkeleton rows={3} />
            ) : holdingsMtm.length === 0 ? (
              <EmptyState
                title="No direct holdings"
                description="Stocks bought from the markets page appear here, marked to market."
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link href="/markets">Buy a stock</Link>
                  </Button>
                }
                className="m-4 border-0 bg-transparent py-10"
              />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {holdingsMtm.map((h) => (
                  <li key={h.ticker} className="flex items-center gap-3 px-5 py-3.5">
                    <StockLogo ticker={h.ticker} size="md" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/markets/${h.ticker}`} className="text-sm font-semibold hover:underline">
                        {h.ticker}
                      </Link>
                      <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        {h.qty.toFixed(4)} · avg {formatUsd(h.avgPriceUsd)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm tabular-nums">
                        <PriceFlash value={h.price}>{formatUsd(h.value)}</PriceFlash>
                      </p>
                      <p className={cn("font-mono text-[11px] tabular-nums", h.pnl >= 0 ? "text-success" : "text-destructive")}>
                        {h.pnl >= 0 ? "+" : "−"}
                        {formatUsd(Math.abs(h.pnl))}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Recent activity */}
      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Recent activity</h2>
          <Link href="/activity" className="inline-flex items-center gap-1 text-sm font-medium text-accent-strong hover:underline">
            Full ledger
            <ArrowRight size={12} weight="bold" />
          </Link>
        </div>
        <div className="overflow-hidden rounded-3xl border border-border bg-surface shadow-card">
          <ActivityList records={activity.data ?? []} loading={activity.isLoading} limit={5} />
        </div>
      </section>
    </div>
  );
}

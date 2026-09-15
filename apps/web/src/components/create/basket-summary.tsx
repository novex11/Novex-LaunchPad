"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Wallet, WarningCircle, Sparkle, CaretDown } from "@phosphor-icons/react";
import { CASHBACK_CONFIG, STRATEGIES, receiptTokenName, type StrategyId } from "@compose/config";
import type { PreviewResponse } from "@compose/sdk";
import type { DepositCosts } from "@/lib/api";
import { cn, formatUsd } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StockLogo } from "@/components/ui/stock-logo";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Skeleton } from "@/components/ui/skeleton";
import { AllocationDonut, chartColor } from "@/components/ui/allocation-donut";
import { TxStepper, type TxStepperState } from "@/components/ui/tx-stepper";

export const DEPOSIT_STEPS = [
  { id: "approve", label: "Approve token", hint: "Allow the vault to pull your deposit" },
  { id: "deposit", label: "Deposit & build basket", hint: "One transaction swaps into every line" },
  { id: "record", label: "Record & credit Stockback", hint: "Ledger entry and rewards post" },
];

export interface BasketSummaryProps {
  depositTicker: string;
  strategy: StrategyId;
  depositUsd: number;
  data: PreviewResponse | null;
  previewSource: string;
  previewLoading: boolean;
  costs: DepositCosts | null;
  openingNet: number;
  wallet: { authenticated: boolean; login: () => void };
  canConfirm: boolean;
  confirming: boolean;
  onConfirm: () => void;
  stage: TxStepperState;
  failedAt?: string | null;
  txHash?: string | null;
  error?: string | null;
  /** Inline warnings (no vault, indexer offline, …) rendered above the CTA. */
  notices?: React.ReactNode;
  footnote?: React.ReactNode;
  className?: string;
}

/** Sticky "basket card": donut, lines, Stockback, costs and the confirm flow. */
export function BasketSummary(p: BasketSummaryProps) {
  const { data } = p;
  const [hover, setHover] = useState<string | null>(null);
  const [showCosts, setShowCosts] = useState(false);
  const receipt = receiptTokenName(p.depositTicker, p.strategy);
  const stockback = data?.stockback.totalStockbackUsd ?? 0;
  const floor = CASHBACK_CONFIG.minEligibleDepositUsd;
  const gap = Math.max(0, floor - p.depositUsd);
  const eligible = data?.stockback.eligible ?? p.depositUsd >= floor;
  const violations = data?.violations ?? [];
  const busy = p.confirming || (p.stage !== "idle" && p.stage !== "done" && p.stage !== "error");
  const externalTotal =
    p.costs?.estimatedTotalExternalUsd ??
    (data ? data.externalCosts.estimatedGasUsd + data.externalCosts.estimatedMarketCostUsd : 0);

  return (
    <div className={cn("overflow-hidden rounded-[1.75rem] card-floating", p.className)}>
      {/* Header */}
      <div className="relative border-b border-border-subtle px-5 py-4">
        <div className="relative flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <StockLogo ticker={p.depositTicker} size="md" />
            <div>
              <p className="font-mono text-base font-semibold leading-tight">{receipt}</p>
              <p className="text-xs text-muted-foreground">
                {formatUsd(p.depositUsd)} {p.depositTicker} · {STRATEGIES[p.strategy].label}
              </p>
            </div>
          </div>
          <Badge variant={p.previewSource === "allocator" ? "success" : "secondary"}>
            <span className={cn("h-1.5 w-1.5 rounded-full", p.previewSource === "allocator" ? "bg-success" : "bg-muted-foreground", p.previewLoading && "animate-pulse")} />
            {p.previewLoading ? "Recalculating" : p.previewSource === "allocator" ? "Allocator" : "Estimate"}
          </Badge>
        </div>
      </div>

      {/* Donut + lines */}
      <div className="px-5 pt-5">
        <div className="flex items-center gap-5">
          {data ? (
            <AllocationDonut
              items={data.allocation.map((a) => ({ ticker: a.ticker, weight: a.weight }))}
              size={148}
              thickness={14}
              highlight={hover}
              centerValue={`${data.allocation.length}`}
              centerLabel="lines"
            />
          ) : (
            <Skeleton className="h-[148px] w-[148px] rounded-full" />
          )}
          <div className="min-w-0 flex-1">
            <p className="label-caps">Opening net</p>
            <p className="mt-1 font-mono text-3xl font-semibold tabular-nums">
              {data ? <NumberTicker value={p.openingNet} prefix="$" decimals={2} startOnView={false} duration={0.5} /> : "—"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatUsd(p.depositUsd)} deposit{stockback > 0 ? ` + ${formatUsd(stockback)} Stockback` : ""} − {formatUsd(externalTotal)} est. costs
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(data?.allocation ?? []).slice(0, 4).map((a, i) => (
                <span key={a.ticker} className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: chartColor(i) }} />
                  {a.ticker} {Math.round(a.weight * 100)}%
                </span>
              ))}
              {(data?.allocation.length ?? 0) > 4 && (
                <span className="rounded-md bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  +{data!.allocation.length - 4}
                </span>
              )}
            </div>
          </div>
        </div>

        <ul className="mt-5 max-h-64 space-y-1 overflow-y-auto pr-1 no-scrollbar">
          {!data
            ? Array.from({ length: 5 }).map((_, i) => (
                <li key={`s${i}`} className="flex items-center gap-3 py-1.5">
                  <Skeleton className="h-7 w-7 rounded-lg" />
                  <Skeleton className="h-3 flex-1" />
                  <Skeleton className="h-3 w-14" />
                </li>
              ))
            : data.allocation.map((a, i) => {
                const line = data.stockback.allocationLines.find((l) => l.ticker === a.ticker);
                return (
                  <motion.li
                    key={a.ticker}
                    layout
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    onMouseEnter={() => setHover(a.ticker)}
                    onMouseLeave={() => setHover(null)}
                    className={cn(
                      "grid grid-cols-[1.75rem_1fr_auto] items-center gap-3 rounded-lg px-1.5 py-1.5 transition-colors",
                      hover === a.ticker && "bg-surface-muted",
                    )}
                  >
                    <StockLogo ticker={a.ticker} size="xs" className="h-7 w-7" />
                    <div className="min-w-0">
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="font-medium">{a.ticker}</span>
                        <span className="font-mono tabular-nums text-muted-foreground">{(a.weight * 100).toFixed(1)}%</span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-muted">
                        <motion.div className="h-full rounded-full" style={{ background: chartColor(i) }} animate={{ width: `${a.weight * 100}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
                      </div>
                    </div>
                    <div className="text-right font-mono text-xs tabular-nums">
                      <div>{formatUsd(a.usd)}</div>
                      <div className={cn(line && line.bonusUsd > 0 ? "text-accent-strong" : "text-muted-foreground")}>
                        {line && line.bonusUsd > 0 ? `+${formatUsd(line.bonusUsd)}` : "—"}
                      </div>
                    </div>
                  </motion.li>
                );
              })}
        </ul>

        <AnimatePresence>
          {violations.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 overflow-hidden"
            >
              <p className="flex items-start gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
                <WarningCircle size={14} className="mt-0.5 shrink-0" />
                <span>
                  {violations.join(" · ")}. Remove a preferred stock or pick a bigger basket size.
                </span>
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Stockback */}
      <div className="relative mx-5 mt-5 overflow-hidden rounded-2xl border border-accent/30 bg-accent-subtle/60 p-4">
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <p className="label-caps flex items-center gap-1.5">
              <Sparkle size={12} weight="fill" className="text-accent-strong" />
              Stockback
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-accent-strong">
              <NumberTicker value={stockback} decimals={2} prefix="+$" startOnView={false} duration={0.6} />
            </p>
          </div>
          <dl className="space-y-0.5 text-right font-mono text-[11px] tabular-nums">
            <div className="flex justify-end gap-3">
              <dt className="text-muted-foreground">Bonus</dt>
              <dd>{formatUsd(data?.stockback.depositStockbackUsd ?? 0)}</dd>
            </div>
            <div className="flex justify-end gap-3">
              <dt className="text-muted-foreground">Per stock</dt>
              <dd>{formatUsd((data?.stockback.allocationLines ?? []).reduce((s, l) => s + l.bonusUsd, 0))}</dd>
            </div>
          </dl>
        </div>
        {!eligible && gap > 0 && (
          <div className="relative mt-3">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">
                Add <span className="font-mono font-semibold text-foreground">{formatUsd(gap)}</span> to unlock the{" "}
                {formatUsd(CASHBACK_CONFIG.depositStockbackUsd)} bonus
              </span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {formatUsd(p.depositUsd)} / {formatUsd(floor)}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface">
              <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${Math.min(100, (p.depositUsd / floor) * 100)}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
            </div>
          </div>
        )}
        {!eligible && gap === 0 && data && (
          <p className="relative mt-2 text-[11px] text-muted-foreground">Lifetime Stockback cap reached for this wallet.</p>
        )}
      </div>

      {/* Costs (collapsible) */}
      <div className="px-5 pt-4">
        <button
          type="button"
          onClick={() => setShowCosts((s) => !s)}
          className="flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground"
        >
          <span>
            Costs · <span className="font-mono tabular-nums">{formatUsd(externalTotal)}</span>
            {p.costs?.swapLegs ? ` · ${p.costs.swapLegs} legs` : ""}
          </span>
          <CaretDown size={12} className={cn("transition-transform", showCosts && "rotate-180")} />
        </button>
        <AnimatePresence initial={false}>
          {showCosts && (
            <motion.dl
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden font-mono text-xs"
            >
              <div className="mt-2 space-y-1 border-t border-border-subtle pt-2">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Platform fee</dt>
                  <dd className="tabular-nums text-success">$0.00</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Est. network</dt>
                  <dd className="tabular-nums">{formatUsd(p.costs?.estimatedGasUsd ?? data?.externalCosts.estimatedGasUsd ?? 0)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Est. market{p.costs?.source ? ` · ${p.costs.source}` : ""}</dt>
                  <dd className="tabular-nums">{formatUsd(p.costs?.estimatedMarketCostUsd ?? data?.externalCosts.estimatedMarketCostUsd ?? 0)}</dd>
                </div>
              </div>
            </motion.dl>
          )}
        </AnimatePresence>
      </div>

      {/* CTA */}
      <div className="p-5">
        {p.notices}
        <AnimatePresence initial={false}>
          {(busy || p.stage === "done" || p.stage === "error") && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-3 overflow-hidden">
              <TxStepper steps={DEPOSIT_STEPS} current={p.stage} failedAt={p.failedAt} error={p.error} txHash={p.txHash} compact />
            </motion.div>
          )}
        </AnimatePresence>
        {p.error && p.stage !== "error" && (
          <p className="mb-3 flex items-center gap-1.5 text-xs text-destructive">
            <WarningCircle size={14} />
            {p.error}
          </p>
        )}
        {p.wallet.authenticated ? (
          <Button
            className="h-12 w-full text-[15px] font-semibold"
            size="lg"
            disabled={!p.canConfirm || busy}
            onClick={p.onConfirm}
          >
            {busy ? "Processing…" : `Confirm ${formatUsd(p.depositUsd)} deposit`}
            {!busy && <ArrowRight size={16} weight="bold" />}
          </Button>
        ) : (
          <Button className="h-12 w-full text-[15px] font-semibold" size="lg" onClick={p.wallet.login}>
            <Wallet size={16} weight="bold" />
            Connect wallet to continue
          </Button>
        )}
        {p.footnote && <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">{p.footnote}</p>}
      </div>
    </div>
  );
}

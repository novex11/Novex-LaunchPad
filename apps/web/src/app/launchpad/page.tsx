"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ArrowRight, Rocket, Sparkle, TrendUp, Users } from "@phosphor-icons/react";
import {
  fetchLaunchpadPairs,
  fetchLaunchpadStats,
  type LaunchpadPair,
} from "@/lib/api";
import { useWallet } from "@/hooks/use-wallet";
import { useQuotes } from "@/hooks/use-quotes";
import { cn, formatUsd } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkline } from "@/components/ui/sparkline";
import { StockLogo } from "@/components/ui/stock-logo";

const spring = { type: "spring", stiffness: 100, damping: 20 } as const;

type Filter = "all" | "stock" | "forex" | "mixed" | "mine";
type Sort = "tvl" | "new" | "depositors";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "stock", label: "Stocks" },
  { id: "forex", label: "Forex" },
  { id: "mixed", label: "Mixed" },
  { id: "mine", label: "My launches" },
];

const SORTS: Array<{ id: Sort; label: string }> = [
  { id: "tvl", label: "Top TVL" },
  { id: "new", label: "Newest" },
  { id: "depositors", label: "Most Depositors" },
];

export default function LaunchpadPage() {
  const wallet = useWallet();
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("tvl");

  const stats = useQuery({
    queryKey: ["launchpad-stats"],
    queryFn: fetchLaunchpadStats,
    refetchInterval: 30_000,
  });

  const pairs = useQuery({
    queryKey: ["launchpad-pairs", sort],
    queryFn: () => fetchLaunchpadPairs(sort),
    refetchInterval: 30_000,
  });

  const filtered = useMemo(() => {
    const all = pairs.data?.pairs ?? [];
    return all.filter((p) => {
      if (filter === "mine") {
        return (
          wallet.address &&
          p.creatorWallet.toLowerCase() === wallet.address.toLowerCase()
        );
      }
      if (filter === "stock") return isStock(p.categoryA) && isStock(p.categoryB);
      if (filter === "forex") return p.categoryA === "forex" && p.categoryB === "forex";
      if (filter === "mixed") {
        return (
          (isStock(p.categoryA) && !isStock(p.categoryB)) ||
          (!isStock(p.categoryA) && isStock(p.categoryB))
        );
      }
      return true;
    });
  }, [pairs.data, filter, wallet.address]);

  // Collect all unique tickers to fetch real-time quotes + sparklines
  const allTickers = useMemo(() => {
    const set = new Set<string>();
    for (const p of filtered) {
      set.add(p.tickerA);
      set.add(p.tickerB);
    }
    return Array.from(set);
  }, [filtered]);

  const { byTicker } = useQuotes(allTickers);

  const emptyLabel =
    filter === "mine"
      ? "You haven't launched any pairs yet."
      : "No pairs match this filter.";

  return (
    <div className="container-page min-h-[100dvh] py-8 md:py-10">
      <div className="grid gap-6 md:grid-cols-12 md:items-end">
        <div className="md:col-span-8">
          <p className="label-caps flex items-center gap-2">
            <Sparkle size={12} weight="fill" /> Launchpad
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
            Launched pairs
          </h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            Discover unique 2-token pair vaults created by the community. Every
            pair is on-chain, USDG-denominated, and pays creator fees to its
            launcher.
          </p>
        </div>
        <div className="md:col-span-4 md:text-right">
          <Button asChild size="lg">
            <Link href="/launch">
              Launch a pair
              <Rocket size={16} weight="bold" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total pairs" value={stats.data?.totalPairs ?? 0} icon={Rocket} />
        <StatCard
          label="Total TVL"
          value={formatUsd(stats.data?.totalTvlUsd ?? 0)}
          icon={TrendUp}
        />
        <StatCard
          label="Creator earnings"
          value={formatUsd(stats.data?.totalCreatorEarningsUsd ?? 0)}
          icon={Sparkle}
        />
        <StatCard
          label="Unique creators"
          value={stats.data?.totalCreators ?? 0}
          icon={Users}
        />
      </div>

      {/* Filters */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-full border border-border bg-surface p-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-all active:scale-[0.98]",
                filter === f.id
                  ? "bg-accent-subtle text-accent-strong"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 rounded-full border border-border bg-surface p-1">
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSort(s.id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-all active:scale-[0.98]",
                sort === s.id
                  ? "bg-accent-subtle text-accent-strong"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Pairs list */}
      <div className="mt-8">
        {pairs.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-40 animate-pulse rounded-3xl border border-border bg-surface-muted/40"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-surface p-12 text-center">
            <p className="font-mono text-sm text-muted-foreground">{emptyLabel}</p>
            <Button asChild className="mt-4">
              <Link href="/launch">
                Launch the first pair
                <ArrowRight size={14} weight="bold" />
              </Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((pair, i) => (
              <PairCard key={pair.pairAddress} pair={pair} delay={i * 0.03} byTicker={byTicker} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function isStock(cat: string): boolean {
  return (
    cat === "large-cap" ||
    cat === "growth" ||
    cat === "broad-market" ||
    cat === "thematic"
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ size?: number; weight?: "regular" | "fill" | "bold" }>;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon size={14} weight="fill" />
        <span>{label}</span>
      </div>
      <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}

function PairCard({ pair, delay, byTicker }: { pair: LaunchpadPair; delay: number; byTicker: Map<string, import("@/hooks/use-quotes").QuoteData> }) {
  const quoteA = byTicker.get(pair.tickerA);
  const quoteB = byTicker.get(pair.tickerB);

  // Blend sparklines from both legs into one combined series (average)
  const combined = useMemo(() => {
    const a = quoteA?.sparkline ?? [];
    const b = quoteB?.sparkline ?? [];
    if (a.length === 0 && b.length === 0) return undefined;
    const len = Math.max(a.length, b.length);
    const out: number[] = [];
    for (let i = 0; i < len; i++) {
      const va = a[Math.min(i, a.length - 1)] ?? 0;
      const vb = b[Math.min(i, b.length - 1)] ?? 0;
      out.push((va + vb) / 2);
    }
    return out;
  }, [quoteA?.sparkline, quoteB?.sparkline]);

  const changeA = quoteA?.changePercent ?? 0;
  const changeB = quoteB?.changePercent ?? 0;
  const blendedChange = (changeA + changeB) / 2;
  const up = blendedChange >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay }}
    >
      <Link
        href={`/pair/${pair.pairAddress}`}
        className="group block h-full rounded-3xl border border-border bg-surface p-5 transition-all hover:border-accent hover:shadow-card active:scale-[0.99]"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              <StockLogo
                ticker={pair.tickerA}
                size="sm"
                className="ring-2 ring-surface"
              />
              <StockLogo
                ticker={pair.tickerB}
                size="sm"
                className="ring-2 ring-surface"
              />
            </div>
            <div>
              <p className="font-mono text-sm font-semibold">
                {pair.receiptSymbol}
              </p>
              <p className="text-[11px] capitalize text-muted-foreground">
                {pair.tickerA} · {pair.tickerB}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-mono text-[11px] tabular-nums",
                up
                  ? "bg-emerald-500/10 text-emerald-600"
                  : "bg-rose-500/10 text-rose-600",
              )}
            >
              {up ? "+" : ""}{blendedChange.toFixed(2)}%
            </span>
            <Badge variant="accent">{(pair.creatorFeeBps / 100).toFixed(1)}%</Badge>
          </div>
        </div>

        {/* Sparkline */}
        {combined && combined.length > 2 && (
          <div className="mt-3">
            <Sparkline
              data={combined}
              width={280}
              height={40}
              positive={up}
              strokeWidth={1.5}
              className="w-full"
            />
          </div>
        )}

        {/* Live prices per leg */}
        {(quoteA || quoteB) && (
          <div className="mt-3 flex items-center justify-between font-mono text-xs">
            <span className="flex items-center gap-1.5">
              <StockLogo ticker={pair.tickerA} size="xs" />
              <span className="tabular-nums">
                {quoteA ? formatUsd(quoteA.price) : "—"}
              </span>
              {quoteA && (
                <span className={cn("tabular-nums", quoteA.changePercent >= 0 ? "text-emerald-600" : "text-rose-600")}>
                  {quoteA.changePercent >= 0 ? "+" : ""}{quoteA.changePercent.toFixed(1)}%
                </span>
              )}
            </span>
            <span className="flex items-center gap-1.5">
              {quoteB && (
                <span className={cn("tabular-nums", quoteB.changePercent >= 0 ? "text-emerald-600" : "text-rose-600")}>
                  {quoteB.changePercent >= 0 ? "+" : ""}{quoteB.changePercent.toFixed(1)}%
                </span>
              )}
              <span className="tabular-nums">
                {quoteB ? formatUsd(quoteB.price) : "—"}
              </span>
              <StockLogo ticker={pair.tickerB} size="xs" />
            </span>
          </div>
        )}

        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{pair.tickerA}</span>
            <span className="font-mono tabular-nums">
              {(pair.weightABps / 100).toFixed(0)}% / {((10_000 - pair.weightABps) / 100).toFixed(0)}%
            </span>
            <span>{pair.tickerB}</span>
          </div>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="bg-accent"
              style={{ width: `${pair.weightABps / 100}%` }}
            />
            <div
              className="bg-accent/40"
              style={{ width: `${(10_000 - pair.weightABps) / 100}%` }}
            />
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 font-mono text-xs">
          <div>
            <dt className="text-muted-foreground">TVL</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums">
              {formatUsd(pair.tvlUsd)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Depositors</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums">
              {pair.totalDepositors}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Volume</dt>
            <dd className="mt-0.5 tabular-nums">{formatUsd(pair.totalDepositsUsd)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Creator earned</dt>
            <dd className="mt-0.5 tabular-nums text-accent-strong">
              +{formatUsd(pair.creatorEarningsUsd)}
            </dd>
          </div>
        </dl>

        <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="font-mono">
            by {pair.creatorWallet.slice(0, 6)}…{pair.creatorWallet.slice(-4)}
          </span>
          <span className="inline-flex items-center gap-1 text-accent-strong opacity-0 transition-opacity group-hover:opacity-100">
            Open
            <ArrowRight size={12} weight="bold" />
          </span>
        </div>
      </Link>
    </motion.div>
  );
}

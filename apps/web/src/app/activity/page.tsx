"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight } from "@phosphor-icons/react";
import { formatUsd } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useWallet } from "@/hooks/use-wallet";
import { useActivity } from "@/hooks/use-portfolio";
import { Button } from "@/components/ui/button";
import { ConnectGate } from "@/components/app/connect-gate";
import { MetricBand } from "@/components/app/metric-band";
import { ActivityList } from "@/components/app/activity-list";

type Filter = "all" | "trades" | "baskets" | "rewards";
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "trades", label: "Buy / Sell" },
  { id: "baskets", label: "Deposits / Redeems" },
  { id: "rewards", label: "Stockback" },
];

export default function ActivityPage() {
  const wallet = useWallet();
  const { data, isLoading, isError } = useActivity(wallet.address);
  const [filter, setFilter] = useState<Filter>("all");
  const records = data ?? [];

  const filtered = useMemo(() => {
    if (filter === "trades") return records.filter((r) => r.type === "buy" || r.type === "sell");
    if (filter === "baskets") return records.filter((r) => r.type === "deposit" || r.type === "redeem");
    if (filter === "rewards") return records.filter((r) => r.stockbackUsd > 0 || r.type === "stockback");
    return records;
  }, [records, filter]);

  if (!wallet.authenticated) {
    return (
      <ConnectGate
        eyebrow="Transaction history"
        title="Activity"
        description="Every buy, sell, basket deposit, redemption and Stockback credit — with transaction hashes."
      />
    );
  }

  return (
    <div className="container-page min-h-[100dvh] py-8 md:py-10">
      <div className="grid gap-6 md:grid-cols-12 md:items-end">
        <div className="md:col-span-8">
          <p className="label-caps">Transaction history</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">Activity ledger</h1>
        </div>
        <div className="flex gap-2 md:col-span-4 md:justify-end">
          <Button asChild variant="outline">
            <Link href="/portfolio">Portfolio</Link>
          </Button>
          <Button asChild>
            <Link href="/markets">
              Trade
              <ArrowRight size={14} weight="bold" />
            </Link>
          </Button>
        </div>
      </div>

      <MetricBand
        className="mt-8"
        loading={isLoading}
        metrics={[
          { label: "Transactions", value: records.length },
          { label: "Volume", value: formatUsd(records.reduce((s, r) => s + r.valueUsd, 0)) },
          { label: "Stockback earned", value: formatUsd(records.reduce((s, r) => s + r.stockbackUsd, 0)), tone: "accent" },
          {
            label: "Trades",
            value: records.filter((r) => r.type === "buy" || r.type === "sell").length,
          },
        ]}
      />

      {isError && (
        <p className="mt-4 text-sm text-destructive">Could not reach the indexer.</p>
      )}

      <div className="mt-8 flex items-center gap-1 overflow-x-auto no-scrollbar">
        {FILTERS.map((f) => {
          const on = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "relative shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                on ? "text-accent-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {on && (
                <motion.span
                  layoutId="activity-filter"
                  className="absolute inset-0 rounded-full bg-surface-inverse"
                  transition={{ type: "spring", stiffness: 100, damping: 20 }}
                />
              )}
              <span className="relative z-10">{f.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 overflow-hidden rounded-3xl border border-border bg-surface shadow-card">
        <div className="hidden grid-cols-[6rem_2.5rem_1fr_8rem_7rem_6rem] gap-4 border-b border-border-subtle px-5 py-2.5 md:grid">
          <span className="label-caps">Type</span>
          <span />
          <span className="label-caps">Asset</span>
          <span className="label-caps">Value</span>
          <span className="label-caps">Stockback</span>
          <span className="label-caps text-right">Status</span>
        </div>
        <ActivityList
          records={filtered}
          loading={isLoading}
          emptyAction={
            <Button asChild size="sm">
              <Link href="/markets">Browse markets</Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}

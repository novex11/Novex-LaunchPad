"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";
import { CASHBACK_CONFIG } from "@novex/config";
import type { Strategy } from "@/lib/api";
import { useRewardPreview } from "@/hooks/use-reward-preview";
import { formatUsd } from "@/lib/utils";
import { NumberTicker } from "@/components/ui/number-ticker";
import { StockLogo } from "@/components/ui/stock-logo";
import { BracketPanel } from "./bracket-panel";
import { MonoLabel } from "./mono-label";
import { cn } from "@/lib/utils";

const ASSETS = ["NVDA", "AAPL", "TSLA", "SPY"];
const STRATS: Strategy[] = ["defensive", "balanced", "aggressive"];
const PRESETS = [250, 1000, 2500, 5000, 10000];

export function LiveMathPanel() {
  const [asset, setAsset] = useState("NVDA");
  const [amount, setAmount] = useState(1000);
  const [strategy, setStrategy] = useState<Strategy>("balanced");
  const { data, source } = useRewardPreview({ depositTicker: asset, depositUsd: amount, strategy });
  const total = data?.stockback.totalStockbackUsd ?? 0;

  return (
    <BracketPanel>
      <div className="flex items-center justify-between gap-4">
        <MonoLabel>Published ratio · Stockback</MonoLabel>
        <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
          {source === "allocator" ? "Live math" : "Estimate"}
        </span>
      </div>
      <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-y border-border py-6">
        <div>
          <p className="label-mono">Swap notional</p>
          <p className="mt-1 font-mono text-xl tabular-nums">{formatUsd(amount)}</p>
        </div>
        <span className="font-mono text-muted-foreground">→</span>
        <div className="text-right">
          <p className="label-mono">Reward</p>
          <p className="mt-1 font-mono text-xl tabular-nums text-accent">
            <NumberTicker value={total} prefix="+$" decimals={2} startOnView={false} duration={0.5} />
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setAmount(p)}
            className={cn(
              "border px-2 py-1 font-mono text-[11px] tabular-nums transition-colors",
              amount === p ? "border-accent bg-accent-subtle text-accent" : "border-border text-muted-foreground hover:border-accent/40",
            )}
          >
            ${p.toLocaleString()}
          </button>
        ))}
      </div>
      <input
        type="range"
        min={100}
        max={10000}
        step={50}
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value))}
        className="mt-4 w-full accent-accent"
        aria-label="Deposit amount"
      />
      <div className="mt-4 flex flex-wrap gap-2">
        {ASSETS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setAsset(t)}
            className={cn(
              "inline-flex items-center gap-1 border px-2 py-1 font-mono text-[11px]",
              asset === t ? "border-accent bg-accent-subtle" : "border-border text-muted-foreground",
            )}
          >
            <StockLogo ticker={t} size="xs" />
            {t}
          </button>
        ))}
      </div>
      <div className="mt-3 flex gap-1">
        {STRATS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStrategy(s)}
            className={cn(
              "border px-2 py-1 font-mono text-[10px] uppercase",
              strategy === s ? "border-accent text-accent" : "border-border text-muted-foreground",
            )}
          >
            {s}
          </button>
        ))}
      </div>
      <p className="mt-4 font-mono text-[10px] leading-relaxed text-muted-foreground">
        {formatUsd(CASHBACK_CONFIG.minEligibleDepositUsd)} floor · reward posts after deposit confirms ·{" "}
        {formatUsd(amount)} → {formatUsd(total)} Stockback
      </p>
      <Link
        href={`/create?deposit=${asset}&amount=${amount}&strategy=${strategy}`}
        className="mt-4 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-accent hover:underline"
      >
        Open builder
        <ArrowRight size={12} />
      </Link>
    </BracketPanel>
  );
}

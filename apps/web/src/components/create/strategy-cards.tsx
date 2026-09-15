"use client";

import { motion } from "motion/react";
import { STRATEGIES, type StrategyId } from "@compose/config";
import { cn } from "@/lib/utils";
import { RiskGauge } from "@/components/ui/risk-gauge";
import { chartColor } from "@/components/ui/allocation-donut";

const ORDER: StrategyId[] = ["defensive", "balanced", "aggressive"];
const RISK: Record<StrategyId, 1 | 2 | 3 | 4 | 5> = { defensive: 2, balanced: 3, aggressive: 5 };
const TAGLINE: Record<StrategyId, string> = {
  defensive: "Steady. Broad index weight, tight single-stock cap.",
  balanced: "The default. Growth tilt with diversification limits.",
  aggressive: "High conviction. Bigger growth and thematic sleeves.",
};

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

/** Mini stacked bar of the strategy's category band midpoints. */
function BandBar({ id }: { id: StrategyId }) {
  const s = STRATEGIES[id];
  const cats: Array<[string, { min: number; max: number }]> = [
    ["Large cap", s.largeCap],
    ["Growth", s.growth],
    ["Index", s.broadMarket],
    ["Thematic", s.thematic],
    ["Stable", s.stable],
    ["Forex", s.forex],
  ];
  const mids = cats.map(([, b]) => (b.min + b.max) / 2);
  const total = mids.reduce((a, b) => a + b, 0) || 1;
  return (
    <div>
      <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-surface-muted">
        {mids.map((m, i) => (
          <span key={cats[i]![0]} className="h-full" style={{ flexBasis: `${(m / total) * 100}%`, background: chartColor(i) }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {cats.slice(0, 4).map(([name, b], i) => (
          <span key={name} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: chartColor(i) }} />
            {name} {pct(b.min)}–{pct(b.max)}
          </span>
        ))}
      </div>
    </div>
  );
}

interface StrategyCardsProps {
  value: StrategyId;
  onChange: (id: StrategyId) => void;
  /** Strategies with no vault on the current network (shown, but flagged). */
  unavailable?: Partial<Record<StrategyId, boolean>>;
  className?: string;
}

export function StrategyCards({ value, onChange, unavailable, className }: StrategyCardsProps) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-3", className)}>
      {ORDER.map((id) => {
        const s = STRATEGIES[id];
        const on = value === id;
        const off = unavailable?.[id];
        return (
          <motion.button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-pressed={on}
            whileTap={{ scale: 0.985 }}
            className={cn(
              "group relative flex flex-col overflow-hidden rounded-2xl border p-4 text-left transition-all",
              on ? "border-accent bg-accent-subtle/70 card-raised" : "border-border bg-surface hover:border-accent/40 hover:bg-surface-muted/50",
            )}
          >
            <div className="relative flex items-start justify-between gap-2">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {s.label}
                  {id === "balanced" && (
                    <span className="rounded-full border border-border bg-surface px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                      default
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{TAGLINE[id]}</p>
              </div>
              <RiskGauge level={RISK[id]} />
            </div>
            <div className="relative mt-4">
              <BandBar id={id} />
            </div>
            <dl className="relative mt-4 flex items-center justify-between gap-3 border-t border-border-subtle pt-3 font-mono text-[11px] tabular-nums">
              <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                <dt className="text-muted-foreground">Max single</dt>
                <dd className="font-semibold">{pct(s.maxSingleStock)}</dd>
              </div>
              <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                <dt className="text-muted-foreground">Keep</dt>
                <dd className="font-semibold">{pct(s.defaultDepositRetention)}</dd>
              </div>
            </dl>
            {off && (
              <span className="relative mt-3 inline-flex w-fit rounded-md bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                No vault on this network
              </span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}

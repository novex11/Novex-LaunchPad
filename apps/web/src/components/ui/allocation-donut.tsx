"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export interface DonutItem {
  ticker: string;
  weight: number;
}

/** Categorical color for the n-th allocation line (CSS token driven). */
export function chartColor(index: number): string {
  return `var(--chart-${(index % 8) + 1})`;
}

interface AllocationDonutProps {
  items: DonutItem[];
  size?: number;
  thickness?: number;
  /** Ticker to emphasize (others dim slightly) */
  highlight?: string | null;
  centerLabel?: React.ReactNode;
  centerValue?: React.ReactNode;
  className?: string;
}

/**
 * Animated SVG donut. Segments draw in sequentially; no chart library.
 * Weights are normalized so partial data still renders a full ring.
 */
export function AllocationDonut({
  items,
  size = 176,
  thickness = 16,
  highlight,
  centerLabel,
  centerValue,
  className,
}: AllocationDonutProps) {
  const reduced = useReducedMotion();
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = items.reduce((s, i) => s + i.weight, 0) || 1;
  const gap = items.length > 1 ? 2.5 : 0; // px gap between segments

  let offset = 0;
  const segments = items.map((it, i) => {
    const len = Math.max(0, (it.weight / total) * c - gap);
    const seg = { ...it, i, len, offset };
    offset += (it.weight / total) * c;
    return seg;
  });

  return (
    <div className={cn("relative inline-block shrink-0", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 overflow-visible">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-muted)" strokeWidth={thickness} />
        {segments.map((s) => {
          const dim = highlight && highlight !== s.ticker;
          return (
            <motion.circle
              key={s.ticker}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={chartColor(s.i)}
              strokeWidth={thickness}
              strokeLinecap="butt"
              strokeDasharray={`${s.len} ${c - s.len}`}
              initial={reduced ? false : { strokeDashoffset: -s.offset + c, opacity: 0 }}
              animate={{ strokeDashoffset: -s.offset, opacity: dim ? 0.3 : 1 }}
              transition={{
                strokeDashoffset: { duration: 0.9, delay: 0.05 * s.i, ease: [0.22, 1, 0.36, 1] },
                opacity: { duration: 0.25 },
              }}
              style={{ transformOrigin: "center" }}
            />
          );
        })}
      </svg>
      {(centerLabel || centerValue) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {centerValue && (
            <span className="font-mono text-xl font-semibold tabular-nums leading-none md:text-2xl">{centerValue}</span>
          )}
          {centerLabel && <span className="mt-1.5 text-[11px] text-muted-foreground">{centerLabel}</span>}
        </div>
      )}
    </div>
  );
}

/** Horizontal stacked bar variant for tight spaces. */
export function AllocationBar({ items, className, height = 8 }: { items: DonutItem[]; className?: string; height?: number }) {
  const reduced = useReducedMotion();
  const total = items.reduce((s, i) => s + i.weight, 0) || 1;
  return (
    <div className={cn("flex w-full gap-px overflow-hidden rounded-full bg-surface-muted", className)} style={{ height }}>
      {items.map((it, i) => (
        <motion.span
          key={it.ticker}
          className="h-full origin-left"
          style={{ flexBasis: `${(it.weight / total) * 100}%`, background: chartColor(i) }}
          initial={reduced ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.6, delay: 0.04 * i, ease: [0.22, 1, 0.36, 1] }}
        />
      ))}
    </div>
  );
}

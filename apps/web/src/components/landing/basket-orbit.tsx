"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { StockLogo } from "@/components/ui/stock-logo";
import { chartColor } from "@/components/ui/allocation-donut";

interface BasketOrbitProps {
  depositTicker: string;
  /** Allocation lines, heaviest first. */
  lines: Array<{ ticker: string; weight: number }>;
  className?: string;
  size?: number;
}

/**
 * One stock in the centre, the basket arranged around it. Weight drives
 * logo size; spokes show the split.
 */
export function BasketOrbit({ depositTicker, lines, className, size = 300 }: BasketOrbitProps) {
  const reduced = useReducedMotion();
  const items = lines.filter((l) => l.ticker !== depositTicker).slice(0, 7);
  const n = Math.max(1, items.length);
  const R = size * 0.36;
  const c = size / 2;
  const maxW = items.reduce((m, l) => Math.max(m, l.weight), 0) || 1;

  return (
    <div className={cn("relative mx-auto", className)} style={{ width: size, height: size }} aria-hidden>
      {/* Glow + rings */}
      <span className="absolute rounded-full border border-dashed border-accent/35" style={{ inset: c - R }} />
      <span className="absolute rounded-full border border-border" style={{ inset: c - R * 0.55 }} />

      {/* Spokes */}
      <svg className="absolute inset-0" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {items.map((it, i) => {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          const x = c + Math.cos(a) * R;
          const y = c + Math.sin(a) * R;
          return (
            <g key={it.ticker}>
              <line x1={c} y1={c} x2={x} y2={y} stroke="var(--border)" strokeWidth="1" strokeDasharray="2 4" />
            </g>
          );
        })}
      </svg>

      {/* Basket */}
      <div className="absolute inset-0">
        {items.map((it, i) => {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          const x = c + Math.cos(a) * R;
          const y = c + Math.sin(a) * R;
          const px = 30 + Math.round((it.weight / maxW) * 18);
          return (
            <motion.div
              key={it.ticker}
              className="absolute"
              style={{ left: x - px / 2, top: y - px / 2, width: px, height: px }}
              initial={reduced ? false : { opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.25 + i * 0.08, type: "spring", stiffness: 220, damping: 18 }}
            >
              <div className="relative h-full w-full">
                <StockLogo ticker={it.ticker} size="md" className="h-full w-full shadow-lg" />
                <span
                  className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background px-1 font-mono text-[9px] tabular-nums"
                  style={{ color: chartColor(i) }}
                >
                  {Math.round(it.weight * 100)}%
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Centre: the deposit */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <motion.div
          initial={reduced ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 16 }}
          className="relative"
        >
          <StockLogo ticker={depositTicker} size="xl" className="shadow-2xl ring-4 ring-background" />
        </motion.div>
      </div>
    </div>
  );
}

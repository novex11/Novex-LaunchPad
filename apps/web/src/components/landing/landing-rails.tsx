"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "@phosphor-icons/react";
import type { PreviewResponse } from "@compose/sdk";
import { useQuotes } from "@/hooks/use-quotes";
import { cn, formatUsd } from "@/lib/utils";
import { StockLogo } from "@/components/ui/stock-logo";

const ease = [0.22, 1, 0.36, 1] as const;

/** Live intraday line that draws itself in and marks the last print. */
function LiveLine({ data, up }: { data: number[]; up: boolean }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(240);
  const H = 56;

  // Measure the real width so the viewBox matches 1:1 and pathLength math
  // (stroke-dasharray) stays exact — non-uniform scaling breaks it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry?.contentRect.width ?? 0);
      if (w > 0) setW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { d, last } = useMemo(() => {
    if (data.length < 2) return { d: "", last: null as { x: number; y: number } | null };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const step = W / (data.length - 1);
    const pts = data.map((v, i) => [i * step, H - ((v - min) / range) * (H - 6) - 3] as const);
    return {
      d: pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" "),
      last: { x: pts[pts.length - 1]![0], y: pts[pts.length - 1]![1] },
    };
  }, [data, W]);
  const color = up ? "var(--success)" : "var(--destructive)";

  return (
    <div ref={ref} className="h-14 w-full">
      {d ? (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block overflow-visible" aria-hidden>
          <motion.path
            key={d}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            initial={reduced ? false : { pathLength: 0, opacity: 0.4 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 1.6, ease }}
          />
          {last && (
            <>
              <circle cx={last.x} cy={last.y} r="2.5" fill={color} />
            </>
          )}
        </svg>
      ) : (
        <div className="h-full w-full bg-surface-muted" />
      )}
    </div>
  );
}

export function DirectRail({ ticker = "NVDA" }: { ticker?: string }) {
  const { byTicker } = useQuotes([ticker]);
  const q = byTicker.get(ticker);
  const up = (q?.changePercent ?? 0) >= 0;
  return (
    <div className="ledger-cell relative flex flex-col border-b border-border">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label-mono text-accent">Direct rail</p>
          <h3 className="mt-2 text-base font-medium">Buy and sell in real time</h3>
        </div>
        <div className="text-right font-mono text-xs tabular-nums">
          <p className="text-foreground">{q ? formatUsd(q.price) : "—"}</p>
          <p className={cn("text-[10px]", up ? "text-success" : "text-destructive")}>
            {q ? `${up ? "+" : ""}${q.changePercent.toFixed(2)}%` : ""}
          </p>
        </div>
      </div>
      <div className="mt-3">
        <LiveLine data={q?.sparkline ?? []} up={up} />
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        <span className="flex items-center gap-2">
          <StockLogo ticker={ticker} size="xs" /> {ticker} · intraday
        </span>
        <Link href={`/markets/${ticker}`} className="flex items-center gap-1 text-accent hover:text-accent-strong">
          Trade <ArrowRight size={10} weight="bold" />
        </Link>
      </div>
    </div>
  );
}

export function BasketRail({ data }: { data: PreviewResponse | null }) {
  const reduced = useReducedMotion();
  const lines = (data?.allocation ?? []).slice(0, 8);
  return (
    <div className="ledger-cell relative flex flex-col">
      <p className="label-mono text-accent">Basket rail</p>
      <h3 className="mt-2 text-base font-medium">Managed allocation</h3>
      <div className="relative mt-4 flex h-8 w-full gap-px overflow-hidden bg-surface-muted">
        {lines.map((a, i) => (
          <motion.div
            key={a.ticker}
            className="relative flex h-full origin-left items-center justify-center overflow-hidden bg-accent"
            style={{ flexBasis: `${a.weight * 100}%`, opacity: 1 - i * 0.1 }}
            initial={reduced ? false : { scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: i * 0.06, ease }}
            title={`${a.ticker} ${Math.round(a.weight * 100)}%`}
          >
            {a.weight >= 0.12 && (
              <span className="font-mono text-[9px] uppercase text-accent-foreground">{a.ticker}</span>
            )}
          </motion.div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex -space-x-1.5">
          {lines.slice(0, 6).map((a, i) => (
            <motion.div
              key={a.ticker}
              initial={reduced ? false : { opacity: 0, y: 6 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 + i * 0.05 }}
            >
              <StockLogo ticker={a.ticker} size="xs" className="ring-2 ring-surface" />
            </motion.div>
          ))}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {lines.length ? `${data?.allocation.length ?? lines.length} lines · stockback on confirm` : "building…"}
        </span>
      </div>
    </div>
  );
}

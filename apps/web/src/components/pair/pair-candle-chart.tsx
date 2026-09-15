"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { PairCandle, PairCandleInterval, PairCandleMetric } from "@/lib/api";

const PADDING = { top: 16, right: 68, bottom: 28, left: 4 };
const INTERVALS: PairCandleInterval[] = ["1m", "5m", "15m", "1h"];
const INTERVAL_MS: Record<PairCandleInterval, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
};
const UP = "rgb(34 197 94)";
const DOWN = "rgb(244 63 94)";

export interface PairCandleChartProps {
  candles: PairCandle[];
  metric: PairCandleMetric;
  interval: PairCandleInterval;
  onIntervalChange: (interval: PairCandleInterval) => void;
  title: string;
  loading?: boolean;
  height?: number;
  /** Latest pushed value; updates the last candle before the next fetch lands. */
  live?: { timestamp: string; value: number };
  className?: string;
}

function formatValue(v: number, metric: PairCandleMetric): string {
  if (metric === "sharePrice") return `$${v.toFixed(v >= 100 ? 2 : 4)}`;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTime(iso: string, interval: PairCandleInterval): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (interval === "1h") return `${d.toLocaleDateString("en-US", { day: "numeric", month: "short" })} ${time}`;
  return time;
}

function niceTicks(min: number, max: number, count = 4): number[] {
  const range = max - min || Math.abs(max) || 1;
  const step = Math.pow(10, Math.floor(Math.log10(range / count)));
  const err = range / count / step;
  const niceStep = err >= 7.5 ? step * 10 : err >= 3 ? step * 5 : err >= 1.5 ? step * 2 : step;
  const ticks: number[] = [];
  for (let v = Math.floor(min / niceStep) * niceStep; v <= max + niceStep / 2; v += niceStep) {
    ticks.push(Number(v.toPrecision(12)));
  }
  return ticks;
}

/** Fold the latest live value into the candle series. */
function mergeLive(
  candles: PairCandle[],
  interval: PairCandleInterval,
  live: PairCandleChartProps["live"],
): PairCandle[] {
  if (!live || candles.length === 0) return candles;
  const bucketMs = INTERVAL_MS[interval];
  const bucket = Math.floor(new Date(live.timestamp).getTime() / bucketMs) * bucketMs;
  const last = candles[candles.length - 1]!;
  const lastTime = new Date(last.time).getTime();
  if (bucket === lastTime) {
    return [
      ...candles.slice(0, -1),
      { ...last, high: Math.max(last.high, live.value), low: Math.min(last.low, live.value), close: live.value },
    ];
  }
  if (bucket > lastTime) {
    return [
      ...candles,
      {
        time: new Date(bucket).toISOString(),
        open: last.close,
        high: Math.max(last.close, live.value),
        low: Math.min(last.close, live.value),
        close: live.value,
      },
    ];
  }
  return candles;
}

/** Candlestick chart for a pair's share price or NAV. */
export function PairCandleChart({
  candles,
  metric,
  interval,
  onIntervalChange,
  title,
  loading,
  height = 280,
  live,
  className,
}: PairCandleChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(720);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const data = useMemo(() => mergeLive(candles, interval, live), [candles, interval, live]);

  const layout = useMemo(() => {
    if (data.length === 0) return null;
    let lo = Math.min(...data.map((c) => c.low));
    let hi = Math.max(...data.map((c) => c.high));
    const minSpan = Math.max(Math.abs(hi) * 0.004, 1e-6);
    if (hi - lo < minSpan) {
      const mid = (hi + lo) / 2;
      lo = mid - minSpan / 2;
      hi = mid + minSpan / 2;
    }
    const ticks = niceTicks(lo, hi, 4).filter((t) => t >= lo - (hi - lo) && t <= hi + (hi - lo));
    const yMin = Math.min(lo, ticks[0] ?? lo);
    const yMax = Math.max(hi, ticks[ticks.length - 1] ?? hi);
    const plotW = width - PADDING.left - PADDING.right;
    const plotH = height - PADDING.top - PADDING.bottom;
    const slot = plotW / data.length;
    const bodyW = Math.max(1.5, Math.min(12, slot * 0.62));
    const y = (v: number) => PADDING.top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;

    const bars = data.map((c, i) => {
      const x = PADDING.left + slot * (i + 0.5);
      const top = y(Math.max(c.open, c.close));
      const bottom = y(Math.min(c.open, c.close));
      return { x, up: c.close >= c.open, top, bodyH: Math.max(1, bottom - top), wickTop: y(c.high), wickBottom: y(c.low) };
    });

    const tickCount = width < 420 ? 3 : 5;
    const xTicks = Array.from({ length: tickCount }, (_, k) => {
      const i = Math.round((k / (tickCount - 1)) * (data.length - 1));
      return { x: bars[i]!.x, label: formatTime(data[i]!.time, interval) };
    });

    return { ticks, y, bars, bodyW, slot, xTicks };
  }, [data, width, height, interval]);

  const last = data[data.length - 1];
  const first = data[0];
  const hovered = hoverIdx != null ? data[hoverIdx] : undefined;
  const shown = hovered ?? last;
  const change = first && last && first.open !== 0 ? ((last.close - first.open) / first.open) * 100 : 0;
  const up = change >= 0;

  function handleMove(e: React.MouseEvent<SVGRectElement>) {
    if (!layout) return;
    const rect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!rect) return;
    const relX = ((e.clientX - rect.left) / rect.width) * width - PADDING.left;
    setHoverIdx(Math.min(data.length - 1, Math.max(0, Math.floor(relX / layout.slot))));
  }

  return (
    <div className={cn("relative w-full", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label-caps">{title}</p>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="font-mono text-3xl font-semibold tabular-nums">
              {shown ? formatValue(shown.close, metric) : "—"}
            </span>
            {data.length > 1 && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-mono text-xs tabular-nums",
                  up
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                )}
              >
                {up ? "+" : ""}
                {change.toFixed(2)}%
              </span>
            )}
          </div>
          {hovered ? (
            <p className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
              {formatTime(hovered.time, interval)} · O {formatValue(hovered.open, metric)} · H{" "}
              {formatValue(hovered.high, metric)} · L {formatValue(hovered.low, metric)} · C{" "}
              {formatValue(hovered.close, metric)}
            </p>
          ) : (
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {INTERVALS.includes(interval) ? `${interval} candles` : ""}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 rounded-full border border-border bg-surface-muted p-1" role="radiogroup" aria-label="Candle interval">
          {INTERVALS.map((i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={i === interval}
              onClick={() => onIntervalChange(i)}
              className={cn(
                "rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide transition-all",
                i === interval ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {i}
            </button>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="relative mt-4 w-full">
        {loading && data.length === 0 && (
          <div className="w-full animate-pulse rounded-2xl bg-surface-muted" style={{ height }} />
        )}
        {!loading && data.length === 0 && (
          <div
            className="flex w-full flex-col items-center justify-center rounded-2xl border border-dashed border-border-subtle bg-surface-muted/40 text-sm text-muted-foreground"
            style={{ height }}
          >
            <span className="font-mono">Waiting for the first trade or price tick…</span>
            <span className="mt-1 text-xs">Candles appear within seconds of any activity.</span>
          </div>
        )}

        {layout && last && (
          <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} className="block overflow-visible" aria-label={`${title} candles`}>
            {layout.ticks.map((v) => (
              <g key={v}>
                <line
                  x1={PADDING.left}
                  x2={width - PADDING.right}
                  y1={layout.y(v)}
                  y2={layout.y(v)}
                  stroke="currentColor"
                  strokeOpacity={0.1}
                  strokeDasharray="2 4"
                  className="text-muted-foreground"
                />
                <text x={width - PADDING.right + 6} y={layout.y(v)} dy="0.32em" className="fill-muted-foreground font-mono text-[10px]">
                  {formatValue(v, metric)}
                </text>
              </g>
            ))}

            {layout.xTicks.map((t, i) => (
              <text
                key={i}
                x={t.x}
                y={height - 8}
                textAnchor={i === 0 ? "start" : i === layout.xTicks.length - 1 ? "end" : "middle"}
                className="fill-muted-foreground font-mono text-[10px]"
              >
                {t.label}
              </text>
            ))}

            {layout.bars.map((b, i) => {
              const color = b.up ? UP : DOWN;
              return (
                <g key={data[i]!.time} opacity={hoverIdx != null && hoverIdx !== i ? 0.55 : 1}>
                  <line x1={b.x} x2={b.x} y1={b.wickTop} y2={b.wickBottom} stroke={color} strokeWidth={1} />
                  <rect
                    x={b.x - layout.bodyW / 2}
                    y={b.top}
                    width={layout.bodyW}
                    height={b.bodyH}
                    rx={1}
                    fill={color}
                    style={{ transition: "y 250ms ease, height 250ms ease" }}
                  />
                </g>
              );
            })}

            {/* Last price line */}
            <line
              x1={PADDING.left}
              x2={width - PADDING.right}
              y1={layout.y(last.close)}
              y2={layout.y(last.close)}
              stroke={last.close >= last.open ? UP : DOWN}
              strokeOpacity={0.7}
              strokeDasharray="3 3"
              style={{ transition: "y1 250ms ease, y2 250ms ease" }}
            />
            <rect
              x={width - PADDING.right + 2}
              y={layout.y(last.close) - 9}
              width={PADDING.right - 4}
              height={18}
              rx={4}
              fill={last.close >= last.open ? UP : DOWN}
            />
            <text x={width - PADDING.right + 6} y={layout.y(last.close)} dy="0.32em" className="font-mono text-[10px] font-semibold" fill="white">
              {formatValue(last.close, metric)}
            </text>

            {hoverIdx != null && layout.bars[hoverIdx] && (
              <line
                x1={layout.bars[hoverIdx]!.x}
                x2={layout.bars[hoverIdx]!.x}
                y1={PADDING.top}
                y2={height - PADDING.bottom}
                stroke="currentColor"
                strokeOpacity={0.25}
                strokeDasharray="3 3"
                className="text-foreground"
              />
            )}

            <rect
              x={PADDING.left}
              y={PADDING.top}
              width={width - PADDING.left - PADDING.right}
              height={height - PADDING.top - PADDING.bottom}
              fill="transparent"
              onMouseMove={handleMove}
              onMouseLeave={() => setHoverIdx(null)}
              style={{ cursor: "crosshair" }}
            />
          </svg>
        )}
      </div>
    </div>
  );
}

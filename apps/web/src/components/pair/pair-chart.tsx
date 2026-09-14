"use client";

import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { PairHistoryPoint, PairHistoryRange } from "@/lib/api";

/*──────────────────────────────────────────────────────────
 * PairChart — professional time-series chart for launched
 * pairs. Renders an area+line curve with y-axis price labels,
 * x-axis time labels, dotted gridlines, and a hover crosshair
 * that reveals the exact value at any timestamp.
 *
 *   ▲ $10M ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
 *          │ ╱‾‾‾╲╱‾╲
 *   $9M   ┈│┈┈┈┈┈┈┈┈┈╲__╲__________
 *          └─────────────────────────
 *          13 Sep at 5:30 AM   14 Sep at 1:30 AM
 *────────────────────────────────────────────────────────*/

const CHART_HEIGHT = 260;
const PADDING = { top: 20, right: 60, bottom: 32, left: 4 };

export type PairChartMetric = "navUsd" | "sharePrice";

export interface PairChartProps {
  points: PairHistoryPoint[];
  metric?: PairChartMetric;
  /** Selected range — controls x-axis tick spacing */
  range: PairHistoryRange;
  onRangeChange?: (range: PairHistoryRange) => void;
  /** Available range chips (default: 1H, 24H, 7D, 30D, ALL) */
  ranges?: readonly PairHistoryRange[];
  className?: string;
  /** Optional label shown top-left ("TVL", "Share price") */
  title?: string;
  /** Loading state — draws a shimmer when no points are available yet */
  loading?: boolean;
  /** Height in px — defaults to 260 */
  height?: number;
}

const DEFAULT_RANGES: readonly PairHistoryRange[] = [
  "1h",
  "24h",
  "7d",
  "30d",
  "all",
];

const RANGE_LABEL: Record<PairHistoryRange, string> = {
  "1h": "1H",
  "24h": "24H",
  "7d": "7D",
  "30d": "30D",
  all: "ALL",
};

function formatUsdCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (abs >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

function formatUsdFull(v: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

function formatShare(v: number): string {
  return v.toFixed(v >= 100 ? 2 : v >= 1 ? 4 : 6);
}

function formatTick(date: Date, range: PairHistoryRange): string {
  // "13 Sep at 5:30 AM" style — matches Robinhood/Long.xyz aesthetics.
  const day = date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  if (range === "7d" || range === "30d" || range === "all") {
    return `${day} at ${time}`;
  }
  return `${day} at ${time}`;
}

/**
 * Choose ~5 evenly-spaced "nice" y-axis tick values that bracket the data.
 */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    // Give the value a bit of breathing room so a flat curve still shows.
    const pad = Math.max(Math.abs(min) * 0.1, 1);
    min -= pad;
    max += pad;
  }
  const range = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(range / count)));
  const err = (range / count) / step;
  const niceStep =
    err >= 7.5 ? step * 10 : err >= 3 ? step * 5 : err >= 1.5 ? step * 2 : step;
  const niceMin = Math.floor(min / niceStep) * niceStep;
  const niceMax = Math.ceil(max / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + niceStep / 2; v += niceStep) {
    ticks.push(v);
  }
  return ticks;
}

export function PairChart({
  points,
  metric = "navUsd",
  range,
  onRangeChange,
  ranges = DEFAULT_RANGES,
  className,
  title = "TVL",
  loading,
  height = CHART_HEIGHT,
}: PairChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [width, setWidth] = useState(720);

  // Measure the parent width so the SVG stays fluid.
  const measureRef = (node: HTMLDivElement | null) => {
    if (!node) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(320, entry.contentRect.width));
    });
    ro.observe(node);
  };

  const values = useMemo(
    () => points.map((p) => (metric === "navUsd" ? p.navUsd : p.sharePrice)),
    [points, metric],
  );
  const times = useMemo(
    () => points.map((p) => new Date(p.timestamp).getTime()),
    [points],
  );

  const chartData = useMemo(() => {
    if (values.length < 2) return null;
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const minT = times[0]!;
    const maxT = times[times.length - 1]!;
    const yTicks = niceTicks(minV, maxV, 4);
    const yMin = Math.min(minV, yTicks[0]!);
    const yMax = Math.max(maxV, yTicks[yTicks.length - 1]!);
    const yRange = yMax - yMin || 1;
    const w = width - PADDING.left - PADDING.right;
    const h = height - PADDING.top - PADDING.bottom;

    const pts = values.map((v, i) => {
      const x =
        PADDING.left +
        ((times[i]! - minT) / Math.max(1, maxT - minT)) * w;
      const y = PADDING.top + (1 - (v - yMin) / yRange) * h;
      return { x, y, v, t: times[i]! };
    });

    const linePath = pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(" ");
    const areaPath = `${linePath} L${pts[pts.length - 1]!.x.toFixed(2)},${height - PADDING.bottom} L${pts[0]!.x.toFixed(2)},${height - PADDING.bottom} Z`;

    // Choose ~5 x-axis ticks evenly.
    const xTickCount = width < 420 ? 3 : width < 640 ? 4 : 6;
    const xTicks: { x: number; label: string }[] = [];
    for (let i = 0; i < xTickCount; i++) {
      const frac = i / (xTickCount - 1);
      const t = minT + frac * (maxT - minT);
      const x = PADDING.left + frac * w;
      xTicks.push({ x, label: formatTick(new Date(t), range) });
    }

    return { pts, linePath, areaPath, yTicks, yMin, yMax, xTicks };
  }, [values, times, width, height, range]);

  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const change = last - first;
  const changePct = first !== 0 ? (change / first) * 100 : 0;
  const up = change >= 0;

  const strokeColor = up ? "rgb(163 230 53)" : "rgb(244 63 94)"; // lime-400 / rose-500
  const fillGradId = `pair-chart-fill-${up ? "u" : "d"}`;

  const hover = hoverIdx != null && chartData ? chartData.pts[hoverIdx] : null;
  const hoverPoint = hoverIdx != null ? points[hoverIdx] : null;

  function handleMove(e: React.MouseEvent<SVGRectElement>) {
    if (!chartData) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    // Find nearest point
    let nearest = 0;
    let minDist = Infinity;
    for (let i = 0; i < chartData.pts.length; i++) {
      const d = Math.abs(chartData.pts[i]!.x - relX);
      if (d < minDist) {
        minDist = d;
        nearest = i;
      }
    }
    setHoverIdx(nearest);
  }

  const formatY = metric === "navUsd" ? formatUsdCompact : formatShare;
  const formatHover = metric === "navUsd" ? formatUsdFull : formatShare;

  return (
    <div className={cn("relative w-full", className)}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label-caps">{title}</p>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="font-mono text-3xl font-semibold tabular-nums">
              {values.length > 0
                ? metric === "navUsd"
                  ? formatUsdFull(hoverPoint?.navUsd ?? last)
                  : formatShare(hoverPoint?.sharePrice ?? last)
                : "—"}
            </span>
            {values.length > 1 && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-mono text-xs tabular-nums",
                  up
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                )}
              >
                {change >= 0 ? "+" : ""}
                {changePct.toFixed(2)}%
              </span>
            )}
          </div>
          {hoverPoint && (
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {new Date(hoverPoint.timestamp).toLocaleString("en-US", {
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              })}
            </p>
          )}
        </div>

        {onRangeChange && (
          <div className="flex items-center gap-1 rounded-full border border-border bg-surface-muted p-1">
            {ranges.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onRangeChange(r)}
                className={cn(
                  "rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide transition-all",
                  r === range
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chart canvas */}
      <div ref={measureRef} className="relative mt-4 w-full">
        {loading && values.length === 0 && (
          <div
            className="w-full animate-pulse rounded-2xl bg-surface-muted"
            style={{ height }}
          />
        )}

        {!loading && values.length < 2 && (
          <div
            className="flex w-full flex-col items-center justify-center rounded-2xl border border-dashed border-border-subtle bg-surface-muted/40 text-sm text-muted-foreground"
            style={{ height }}
          >
            <span className="font-mono">Collecting on-chain snapshots…</span>
            <span className="mt-1 text-xs">
              A chart will render once the pair records its first mark-to-market tick.
            </span>
          </div>
        )}

        {chartData && (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            width="100%"
            height={height}
            className="block overflow-visible"
            aria-label={`${title} chart`}
          >
            <defs>
              <linearGradient id={fillGradId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity="0.24" />
                <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Y-axis gridlines + labels */}
            {chartData.yTicks.map((v) => {
              const y =
                PADDING.top +
                (1 - (v - chartData.yMin) / (chartData.yMax - chartData.yMin || 1)) *
                  (height - PADDING.top - PADDING.bottom);
              return (
                <g key={v}>
                  <line
                    x1={PADDING.left}
                    x2={width - PADDING.right}
                    y1={y}
                    y2={y}
                    stroke="currentColor"
                    strokeOpacity={0.12}
                    strokeDasharray="2 4"
                    strokeWidth={1}
                    className="text-muted-foreground"
                  />
                  <text
                    x={width - PADDING.right + 6}
                    y={y}
                    dy="0.32em"
                    className="font-mono text-[10px] fill-muted-foreground"
                  >
                    {formatY(v)}
                  </text>
                </g>
              );
            })}

            {/* X-axis labels */}
            {chartData.xTicks.map((t, i) => (
              <text
                key={i}
                x={t.x}
                y={height - 8}
                textAnchor={i === 0 ? "start" : i === chartData.xTicks.length - 1 ? "end" : "middle"}
                className="font-mono text-[10px] fill-muted-foreground"
              >
                {t.label}
              </text>
            ))}

            {/* Area + line */}
            <path d={chartData.areaPath} fill={`url(#${fillGradId})`} />
            <path
              d={chartData.linePath}
              stroke={strokeColor}
              strokeWidth={1.75}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />

            {/* Hover crosshair + marker */}
            {hover && (
              <g>
                <line
                  x1={hover.x}
                  x2={hover.x}
                  y1={PADDING.top}
                  y2={height - PADDING.bottom}
                  stroke="currentColor"
                  strokeOpacity={0.25}
                  strokeDasharray="3 3"
                  strokeWidth={1}
                  className="text-foreground"
                />
                <circle
                  cx={hover.x}
                  cy={hover.y}
                  r={4}
                  fill={strokeColor}
                  stroke="var(--background, #fff)"
                  strokeWidth={2}
                />
              </g>
            )}

            {/* Last-value marker when nothing hovered */}
            {!hover && (
              <circle
                cx={chartData.pts[chartData.pts.length - 1]!.x}
                cy={chartData.pts[chartData.pts.length - 1]!.y}
                r={3.5}
                fill={strokeColor}
                stroke="var(--background, #fff)"
                strokeWidth={2}
              />
            )}

            {/* Invisible capture layer for mouse events */}
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

      {/* Hover tooltip pill */}
      {hover && hoverPoint && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-1.5 font-mono text-[11px] shadow-float"
          style={{
            left: `${(hover.x / width) * 100}%`,
            top: 60,
          }}
        >
          <div className="tabular-nums">
            {metric === "navUsd"
              ? formatHover(hoverPoint.navUsd)
              : formatShare(hoverPoint.sharePrice)}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {new Date(hoverPoint.timestamp).toLocaleString("en-US", {
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            })}
          </div>
        </div>
      )}
    </div>
  );
}

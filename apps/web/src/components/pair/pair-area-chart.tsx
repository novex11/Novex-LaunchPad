"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { PairHistoryPoint, PairHistoryRange } from "@/lib/api";

export type PairAreaMetric = "navUsd" | "sharePrice";

export interface PairAreaStat {
  label: string;
  value: React.ReactNode;
}

export interface PairAreaChartProps {
  points: PairHistoryPoint[];
  metric: PairAreaMetric;
  onMetricChange?: (metric: PairAreaMetric) => void;
  range: PairHistoryRange;
  onRangeChange: (range: PairHistoryRange) => void;
  /** Four cells shown above the headline (Price, Market cap, …) */
  stats?: PairAreaStat[];
  /** Latest pushed value; extends the line before the next fetch lands */
  live?: { timestamp: string; value: number };
  connected?: boolean;
  loading?: boolean;
  height?: number;
  className?: string;
  /** Labels for the metric toggle (defaults TVL / Price). */
  metricLabels?: { navUsd: string; sharePrice: string };
  /** Message shown while there are fewer than two points. */
  emptyHint?: string;
}

const RANGES: Array<{ id: PairHistoryRange; label: string }> = [
  { id: "1h", label: "1H" },
  { id: "24h", label: "1D" },
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "all", label: "ALL" },
];

const LINE = "var(--chart-line)";
const PAD = { top: 24, right: 96, bottom: 44, left: 16 };
/** Chrome animates a path's `d` when the segment count matches, so a new trade glides in. */
const PATH_TRANSITION: React.CSSProperties = { transition: "d 400ms ease" };
const DOT_TRANSITION: React.CSSProperties = { transition: "cx 400ms ease, cy 400ms ease" };

/** Sub-cent values (bonding-curve token prices are ~1e-8) keep their significant digits. */
function tiny(v: number): string {
  if (v === 0) return "$0";
  const exp = Math.floor(Math.log10(Math.abs(v)));
  return `$${v.toFixed(Math.min(12, -exp + 3))}`;
}

function compact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  if (abs >= 1) return `$${v.toFixed(2)}`;
  if (abs >= 0.01) return `$${v.toFixed(4)}`;
  return tiny(v);
}

function headline(v: number, metric: PairAreaMetric): string {
  if (metric === "sharePrice") {
    if (v !== 0 && Math.abs(v) < 0.01) return tiny(v);
    return `$${v.toFixed(v >= 100 ? 2 : 4)}`;
  }
  return compact(v);
}

function tickLabel(v: number): string {
  if (v === 0) return "$0.00";
  return compact(v);
}

function xLabel(d: Date, range: PairHistoryRange): string {
  if (range === "1h" || range === "24h") {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  return `${d.getDate()} ${d.toLocaleDateString("en-GB", { month: "short" })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const err = raw / mag;
  const step = err >= 7.5 ? mag * 10 : err >= 3 ? mag * 5 : err >= 1.5 ? mag * 2 : mag;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step / 2; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/** Smooth monotone-cubic path through the points (no overshoot). */
function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length < 2) return pts.length ? `M${pts[0]![0]},${pts[0]![1]}` : "";
  const n = pts.length;
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]![0] - pts[i]![0]);
    dy.push(pts[i + 1]![1] - pts[i]![1]);
    m.push(dx[i]! === 0 ? 0 : dy[i]! / dx[i]!);
  }
  const t: number[] = [m[0]!];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1]! * m[i]! <= 0) t.push(0);
    else t.push((m[i - 1]! + m[i]!) / 2);
  }
  t.push(m[n - 2]!);
  let d = `M${pts[0]![0].toFixed(2)},${pts[0]![1].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    const h = dx[i]!;
    d += ` C${(x0 + h / 3).toFixed(2)},${(y0 + (t[i]! * h) / 3).toFixed(2)} ${(x1 - h / 3).toFixed(2)},${(y1 - (t[i + 1]! * h) / 3).toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }
  return d;
}

/**
 * Pons-style value chart: smooth lime line over a soft gradient, dashed
 * gridlines with right-hand dollar labels, headline value + range change,
 * range pills, and a stats strip. Pure SVG.
 */
export function PairAreaChart({
  points,
  metric,
  onMetricChange,
  range,
  onRangeChange,
  stats,
  live,
  connected,
  loading,
  height = 360,
  className,
  metricLabels,
  emptyHint,
}: PairAreaChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(900);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(320, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const series = useMemo(() => {
    const base = points
      .map((p) => ({ t: Date.parse(p.timestamp), v: metric === "navUsd" ? p.navUsd : p.sharePrice }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
      .sort((a, b) => a.t - b.t);
    if (live && base.length) {
      const lt = Date.parse(live.timestamp);
      if (Number.isFinite(lt) && lt > base[base.length - 1]!.t) base.push({ t: lt, v: live.value });
    }
    return base;
  }, [points, metric, live]);

  const geo = useMemo(() => {
    if (series.length < 2) return null;
    const t0 = series[0]!.t;
    const t1 = series[series.length - 1]!.t;
    let lo = Math.min(...series.map((p) => p.v));
    let hi = Math.max(...series.map((p) => p.v));
    if (lo > 0) lo = 0; // Pons anchors the floor at $0
    if (hi - lo <= 0) hi = lo + Math.max(Math.abs(hi) * 0.1, 1);
    const yMax = hi * 1.1;
    const ticks = niceTicks(lo, yMax, 3);
    const yMin = lo;
    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const x = (t: number) => PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * plotW;
    const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;
    const pts = series.map((p) => [x(p.t), y(p.v)] as [number, number]);
    const line = smoothPath(pts);
    const area = `${line} L${pts[pts.length - 1]![0].toFixed(2)},${(PAD.top + plotH).toFixed(2)} L${pts[0]![0].toFixed(2)},${(PAD.top + plotH).toFixed(2)} Z`;
    const labelCount = width < 520 ? 3 : width < 800 ? 4 : 6;
    const xTicks = Array.from({ length: labelCount }, (_, i) => {
      const t = t0 + ((t1 - t0) * i) / (labelCount - 1);
      return { x: x(t), label: xLabel(new Date(t), range) };
    });
    return { pts, line, area, ticks: ticks.filter((v) => v >= yMin && v <= yMax), y, x, xTicks, plotH, t0, t1 };
  }, [series, width, height, range]);

  const last = series[series.length - 1];
  const first = series[0];
  const hovered = hoverIdx != null ? series[hoverIdx] : undefined;
  const shown = hovered ?? last;
  const change = first && last && first.v !== 0 ? ((last.v - first.v) / first.v) * 100 : 0;
  const up = change >= 0;
  const rangeLabel = RANGES.find((r) => r.id === range)?.label ?? range.toUpperCase();

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    if (!geo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * (width - PAD.left - PAD.right) + PAD.left;
    let best = 0;
    let bestD = Infinity;
    geo.pts.forEach(([x], i) => {
      const d = Math.abs(x - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHoverIdx(best);
  }

  return (
    <div className={cn("overflow-hidden rounded-[1.5rem] border border-border bg-surface text-foreground", className)}>
      {/* Stats strip */}
      {stats && stats.length > 0 && (
        <div className="grid grid-cols-2 divide-x divide-border-subtle border-b border-border-subtle md:grid-cols-4">
          {stats.slice(0, 4).map((s) => (
            <div key={s.label} className="px-5 py-4 first:pl-6">
              <p className="text-[13px] text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-[17px] font-medium tabular-nums">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Headline + range pills */}
      <div className="flex flex-wrap items-start justify-between gap-4 px-6 pt-5">
        <div>
          <p className="text-[2.6rem] font-medium leading-none tabular-nums tracking-tight md:text-[3.2rem]">
            {shown ? headline(shown.v, metric) : "—"}
          </p>
          <p className="mt-2 flex items-center gap-2 text-[15px] tabular-nums">
            <span className={up ? "text-success" : "text-destructive"}>
              {up ? "+" : ""}
              {change.toFixed(2)}%
            </span>
            <span className="text-muted-foreground">{hovered ? xLabel(new Date(hovered.t), range) : rangeLabel}</span>
            {connected !== undefined && (
              <span className="ml-1 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "animate-pulse bg-success" : "bg-muted-foreground/40")} />
                {connected ? "Live" : "Connecting"}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onMetricChange && (
            <div className="flex items-center rounded-full bg-surface-muted p-1">
              {(
                [
                  ["navUsd", metricLabels?.navUsd ?? "TVL"],
                  ["sharePrice", metricLabels?.sharePrice ?? "Price"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onMetricChange(id)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
                    metric === id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center rounded-full bg-surface-muted p-1" role="radiogroup" aria-label="Range">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={range === r.id}
                onClick={() => onRangeChange(r.id)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                  range === r.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Plot */}
      <div ref={hostRef} className="relative mx-4 mb-4 mt-4 rounded-[1.25rem] bg-[var(--chart-panel)]">
        {loading && series.length < 2 && <div className="w-full animate-pulse rounded-[1.25rem] bg-surface-muted" style={{ height }} />}
        {!loading && series.length < 2 && (
          <div className="flex w-full flex-col items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            <span>Waiting for the first price points…</span>
            <span className="mt-1 text-xs text-muted-foreground/70">
              {emptyHint ?? "The line appears after the first deposit or tick."}
            </span>
          </div>
        )}
        {geo && last && (
          <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} className="block" aria-label="Value chart">
            <defs>
              <linearGradient id="pons-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={LINE} stopOpacity="0.32" />
                <stop offset="70%" stopColor={LINE} stopOpacity="0.06" />
                <stop offset="100%" stopColor={LINE} stopOpacity="0" />
              </linearGradient>
            </defs>
            {geo.ticks.map((v) => (
              <g key={v}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right + 8}
                  y1={geo.y(v)}
                  y2={geo.y(v)}
                  stroke="var(--border)"
                  strokeWidth={1}
                  strokeDasharray="6 8"
                />
                <text x={width - 12} y={geo.y(v) - 8} textAnchor="end" fill="var(--muted-foreground)" fontSize={15}>
                  {tickLabel(v)}
                </text>
              </g>
            ))}
            {geo.xTicks.map((t, i) => (
              <text
                key={i}
                x={t.x}
                y={height - 14}
                textAnchor={i === 0 ? "start" : i === geo.xTicks.length - 1 ? "end" : "middle"}
                fill="var(--muted-foreground)"
                fontSize={14}
              >
                {t.label}
              </text>
            ))}
            <path d={geo.area} fill="url(#pons-fill)" style={PATH_TRANSITION} />
            <path
              d={geo.line}
              fill="none"
              stroke={LINE}
              strokeWidth={3}
              strokeLinejoin="round"
              strokeLinecap="round"
              style={PATH_TRANSITION}
            />
            {hovered && geo.pts[hoverIdx!] && (
              <>
                <line
                  x1={geo.pts[hoverIdx!]![0]}
                  x2={geo.pts[hoverIdx!]![0]}
                  y1={PAD.top}
                  y2={PAD.top + geo.plotH}
                  stroke="var(--muted-foreground)"
                  strokeOpacity={0.5}
                  strokeDasharray="3 4"
                />
                <circle cx={geo.pts[hoverIdx!]![0]} cy={geo.pts[hoverIdx!]![1]} r={6} fill={LINE} stroke="var(--chart-panel)" strokeWidth={3} />
              </>
            )}
            <circle
              cx={geo.pts[geo.pts.length - 1]![0]}
              cy={geo.pts[geo.pts.length - 1]![1]}
              r={7}
              fill={LINE}
              style={DOT_TRANSITION}
            />
            <rect
              x={PAD.left}
              y={PAD.top}
              width={width - PAD.left - PAD.right}
              height={geo.plotH}
              fill="transparent"
              onMouseMove={onMove}
              onMouseLeave={() => setHoverIdx(null)}
            />
          </svg>
        )}
      </div>
    </div>
  );
}

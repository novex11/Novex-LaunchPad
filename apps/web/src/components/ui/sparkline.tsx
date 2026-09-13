import { cn } from "@/lib/utils";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  /** Force color; defaults to success/destructive by trend */
  positive?: boolean;
  strokeWidth?: number;
}

/** Tiny inline SVG line chart with a soft area fill. Pure, no deps. */
export function Sparkline({
  data,
  width = 96,
  height = 32,
  className,
  positive,
  strokeWidth = 1.5,
}: SparklineProps) {
  if (!data || data.length < 2) {
    return (
      <span
        className={cn("inline-block rounded bg-surface-muted", className)}
        style={{ width, height }}
      />
    );
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return [x, y] as const;
  });
  const path = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${path} L${width},${height} L0,${height} Z`;
  const up = positive ?? data[data.length - 1]! >= data[0]!;
  const color = up ? "var(--success)" : "var(--destructive)";
  const id = `sp-${up ? "u" : "d"}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

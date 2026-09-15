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

/** One full revolution of the basket around the deposit. */
const ORBIT_SECONDS = 48;
/** How long one stockback pulse takes to travel centre → holding. */
const PULSE_SECONDS = 2.6;

/**
 * One stock in the centre, the basket arranged around it. Weight drives
 * logo size; spokes show the split. The basket slowly orbits the deposit
 * while stockback pulses flow outward along each spoke.
 */
export function BasketOrbit({ depositTicker, lines, className, size = 300 }: BasketOrbitProps) {
  const reduced = useReducedMotion();
  const items = lines.filter((l) => l.ticker !== depositTicker).slice(0, 7);
  const n = Math.max(1, items.length);
  const R = size * 0.36;
  const c = size / 2;
  const maxW = items.reduce((m, l) => Math.max(m, l.weight), 0) || 1;
  const orbitStyle = { "--orbit-duration": `${ORBIT_SECONDS}s` } as React.CSSProperties;

  const positioned = items.map((it, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { ...it, i, x: c + Math.cos(a) * R, y: c + Math.sin(a) * R };
  });

  return (
    <div className={cn("relative mx-auto", className)} style={{ width: size, height: size }} aria-hidden>
      {/* Rings: the outer dashed ring drifts the opposite way to the basket */}
      <span
        className={cn("absolute rounded-full border border-dashed border-accent/35", !reduced && "animate-orbit-reverse")}
        style={{ inset: c - R, "--orbit-duration": `${ORBIT_SECONDS * 2}s` } as React.CSSProperties}
      />
      <span className="absolute rounded-full border border-border" style={{ inset: c - R * 0.55 }} />

      {/* Breathing halo behind the deposit */}
      {!reduced && (
        <>
          <span
            className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/40 animate-pulse-ring"
            style={{ animationDuration: "3.2s" }}
          />
          <span
            className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/25 animate-pulse-ring"
            style={{ animationDuration: "3.2s", animationDelay: "1.6s" }}
          />
        </>
      )}

      {/* Everything that orbits: spokes, pulses and the basket itself */}
      <div className={cn("absolute inset-0", !reduced && "animate-orbit")} style={orbitStyle}>
        <svg className="absolute inset-0" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {positioned.map((it) => (
            <g key={it.ticker}>
              <line
                x1={c}
                y1={c}
                x2={it.x}
                y2={it.y}
                stroke="var(--border)"
                strokeWidth="1"
                strokeDasharray="2 4"
                className={cn(!reduced && "animate-dash-flow")}
              />
              {!reduced && (
                <motion.circle
                  r={2.5}
                  fill={chartColor(it.i)}
                  initial={{ cx: c, cy: c, opacity: 0 }}
                  animate={{ cx: [c, it.x], cy: [c, it.y], opacity: [0, 0.9, 0.9, 0] }}
                  transition={{
                    duration: PULSE_SECONDS,
                    delay: 0.9 + it.i * (PULSE_SECONDS / n),
                    repeat: Infinity,
                    repeatDelay: 0.4,
                    ease: "easeInOut",
                    times: [0, 0.15, 0.85, 1],
                  }}
                />
              )}
            </g>
          ))}
        </svg>

        {positioned.map((it) => {
          const px = 30 + Math.round((it.weight / maxW) * 18);
          return (
            <motion.div
              key={it.ticker}
              className="absolute"
              style={{ left: it.x - px / 2, top: it.y - px / 2, width: px, height: px }}
              initial={reduced ? false : { opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              whileHover={reduced ? undefined : { scale: 1.15, zIndex: 2 }}
              transition={{ delay: 0.25 + it.i * 0.08, type: "spring", stiffness: 220, damping: 18 }}
            >
              {/* Counter-rotate so logos stay upright while the group orbits */}
              <div
                className={cn("relative h-full w-full", !reduced && "animate-orbit-reverse")}
                style={orbitStyle}
              >
                <div
                  className={cn("relative h-full w-full", !reduced && "animate-float")}
                  style={{ animationDelay: `${it.i * -0.9}s`, animationDuration: `${5 + (it.i % 3)}s` }}
                >
                  <StockLogo ticker={it.ticker} size="md" className="h-full w-full shadow-lg" />
                  <span
                    className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background px-1 font-mono text-[9px] tabular-nums"
                    style={{ color: chartColor(it.i) }}
                  >
                    {Math.round(it.weight * 100)}%
                  </span>
                </div>
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
          whileHover={reduced ? undefined : { scale: 1.06 }}
          transition={{ type: "spring", stiffness: 200, damping: 16 }}
          className="relative"
        >
          <div className={cn(!reduced && "animate-float")} style={{ animationDuration: "7s" }}>
            <StockLogo ticker={depositTicker} size="xl" className="shadow-2xl ring-4 ring-background" />
          </div>
        </motion.div>
      </div>
    </div>
  );
}

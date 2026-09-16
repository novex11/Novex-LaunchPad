"use client";

import { useEffect, useRef } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { cn } from "@/lib/utils";

interface NumberTickerProps {
  value: number;
  /** Fraction digits */
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  /** Start from 0 when first scrolled into view (default true) */
  startOnView?: boolean;
  duration?: number;
  /** Custom formatter for each frame; overrides decimals/prefix/suffix */
  format?: (value: number) => string;
}

/** Spring-animated numeric display that tweens between value changes. */
export function NumberTicker({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  className,
  startOnView = true,
  duration = 1.1,
  format,
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduced = useReducedMotion();
  const mv = useMotionValue(startOnView ? 0 : value);
  const started = useRef(false);

  const text = useTransform(mv, (v) =>
    format
      ? format(v)
      : `${prefix}${v.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`,
  );

  useEffect(() => {
    if (startOnView && !inView && !started.current) return;
    started.current = true;
    if (reduced) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [value, inView, startOnView, reduced, mv, duration]);

  return (
    <motion.span ref={ref} className={cn("tabular-nums", className)}>
      {text}
    </motion.span>
  );
}

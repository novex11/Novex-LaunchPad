"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface PriceFlashProps {
  value: number | undefined;
  children: React.ReactNode;
  className?: string;
}

/**
 * Wraps a price. When `value` changes the background briefly pulses sage
 * (up) or rose (down), then fades — the classic terminal "tick" cue.
 */
export function PriceFlash({ value, children, className }: PriceFlashProps) {
  const prev = useRef<number | undefined>(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (value == null || prev.current == null) {
      prev.current = value;
      return;
    }
    if (value !== prev.current) {
      setDir(value > prev.current ? "up" : "down");
      prev.current = value;
      const t = setTimeout(() => setDir(null), 650);
      return () => clearTimeout(t);
    }
  }, [value]);

  return (
    <span
      className={cn(
        "inline-block rounded-md px-1 -mx-1 transition-colors duration-500",
        dir === "up" && "bg-success/15",
        dir === "down" && "bg-destructive/15",
        className,
      )}
    >
      {children}
    </span>
  );
}

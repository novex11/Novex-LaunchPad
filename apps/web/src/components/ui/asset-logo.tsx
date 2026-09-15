"use client";

import { cn } from "@/lib/utils";

const SIZE = { sm: "h-8 w-8", md: "h-10 w-10" } as const;

/** Ethereum diamond mark on a soft tile. */
export function EthLogo({ size = "sm", className }: { size?: keyof typeof SIZE; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("flex shrink-0 items-center justify-center rounded-lg bg-[#627eea]/15 text-[#627eea]", SIZE[size], className)}
    >
      <svg viewBox="0 0 32 32" className="h-[60%] w-[60%]" fill="currentColor">
        <path d="M16 3l-8 13.3 8 4.7 8-4.7L16 3z" fillOpacity="0.85" />
        <path d="M16 22.7l-8-4.7L16 29l8-11-8 4.7z" />
      </svg>
    </span>
  );
}

/** USDG mark: a circular "G" in the accent colour. */
export function UsdgLogo({ size = "sm", className }: { size?: keyof typeof SIZE; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg bg-accent-subtle font-mono font-bold text-accent-strong",
        SIZE[size],
        className,
      )}
    >
      <svg viewBox="0 0 32 32" className="h-[64%] w-[64%]" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <circle cx="16" cy="16" r="12.5" strokeOpacity="0.35" />
        <path d="M21.5 11.5A7 7 0 1 0 22.8 18H17" />
      </svg>
    </span>
  );
}

"use client";

import { cn } from "@/lib/utils";

const SIZE = { sm: "h-8 w-8", md: "h-10 w-10" } as const;

/** Robinhood Chain badge: the feather on Robinhood green, overlaid on a wrapped asset. */
function RobinhoodChainBadge() {
  return (
    <span
      aria-hidden
      className="absolute -bottom-0.5 -right-0.5 flex h-[46%] w-[46%] items-center justify-center rounded-full bg-[#00C805] ring-2 ring-surface"
      title="Robinhood Chain"
    >
      <svg viewBox="0 0 24 24" className="h-[70%] w-[70%]" fill="#ffffff">
        <path d="M18.6 4.2c-4.9.4-8.7 3.2-10.6 7.5-.7 1.6-1 3.4-1.1 5.4 1.2-2.6 2.9-4.7 5.2-6.4-2.7 2.7-4.4 6-5.1 9.7 1.3-.4 2.5-.6 3.6-1.1 5.1-2.1 8.2-6.4 8.7-12.1.1-1.1.1-2.1-.7-3z" />
      </svg>
    </span>
  );
}

/** Ethereum mark (official facet shading) on the ETH blue, badged with Robinhood Chain. */
export function EthLogo({ size = "sm", className }: { size?: keyof typeof SIZE; className?: string }) {
  return (
    <span aria-hidden className={cn("relative flex shrink-0 items-center justify-center", SIZE[size], className)}>
      <svg viewBox="0 0 32 32" className="h-full w-full">
        <circle cx="16" cy="16" r="16" fill="#627EEA" />
        <g fill="#ffffff">
          <path d="M16.498 4v8.87l7.497 3.35z" fillOpacity="0.602" />
          <path d="M16.498 4L9 16.22l7.498-3.35z" />
          <path d="M16.498 21.968v6.027L24 17.616z" fillOpacity="0.602" />
          <path d="M16.498 27.995v-6.028L9 17.616z" />
          <path d="M16.498 20.573l7.497-4.353-7.497-3.348z" fillOpacity="0.2" />
          <path d="M9 16.22l7.498 4.353v-7.701z" fillOpacity="0.602" />
        </g>
      </svg>
      <RobinhoodChainBadge />
    </span>
  );
}

/** USDG mark: dark coin with a Robinhood-green "G", badged with Robinhood Chain. */
export function UsdgLogo({ size = "sm", className }: { size?: keyof typeof SIZE; className?: string }) {
  return (
    <span aria-hidden className={cn("relative flex shrink-0 items-center justify-center", SIZE[size], className)}>
      <svg viewBox="0 0 32 32" className="h-full w-full">
        <circle cx="16" cy="16" r="16" fill="#1c1f26" />
        <circle cx="16" cy="16" r="13.5" fill="none" stroke="#00C805" strokeWidth="1.6" strokeOpacity="0.55" />
        <path
          d="M21.6 11.6A7.2 7.2 0 1 0 22.9 18H16.6"
          fill="none"
          stroke="#00C805"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <RobinhoodChainBadge />
    </span>
  );
}

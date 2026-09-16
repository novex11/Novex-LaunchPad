"use client";

import { cn } from "@/lib/utils";

const SIZE = { xs: "h-6 w-6", sm: "h-8 w-8", md: "h-10 w-10", lg: "h-14 w-14", xl: "h-20 w-20" } as const;

/** Robinhood Chain badge: the official Robinhood symbol on Robinhood green, overlaid on an asset. */
function RobinhoodChainBadge() {
  return (
    <span
      aria-hidden
      className="absolute -bottom-0.5 -right-0.5 flex h-[46%] w-[46%] items-center justify-center rounded-full bg-[#00C805] ring-2 ring-surface"
      title="Robinhood Chain"
    >
      <svg viewBox="0 0 115.87 149.53" className="h-[62%] w-[62%]" fill="#ffffff">
        <path d="m.86,149.53h3.3c.6,0,1.2-.3,1.4-.8C30.46,85.33,57.56,53.93,74.56,35.13c.7-.8.4-1.4-.6-1.4h-30.4c-1.1,0-2.03.44-2.8,1.4l-21.8,27c-3.2,4-4,7.7-4,13v27.6C7.86,122.63,3.36,136.13.06,148.33c-.2.78.1,1.2.8,1.2ZM110.56,4.03c-4.7-5-25.9-5.2-35.7-1.4-2.04.79-4,2.13-4.9,2.9-9,7.7-15,13.8-20.7,19.8-.7.7-.4,1.4.6,1.4h33.7c3.1,0,4.9,1.8,4.9,4.9v38c0,1,.8,1.3,1.4.4l20.3-26.5c3.3-4.3,4.3-5.6,5.2-11.6,1.2-8.8.5-22.3-4.8-27.9Zm-43.5,100.8l13.9-22.9c.3-.6.4-1.3.4-1.8v-38.2c0-1-.7-1.4-1.4-.6-20.9,23.3-37.2,47.8-52.3,77.3-.38.74.1,1.4,1,1.1l31.2-9.6c3.52-1.08,5.5-2.5,7.2-5.3Z" />
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

/** USDG (Global Dollar) mark, sourced from CoinGecko, badged with Robinhood Chain. */
export function UsdgLogo({ size = "sm", className }: { size?: keyof typeof SIZE; className?: string }) {
  return (
    <span aria-hidden className={cn("relative flex shrink-0 items-center justify-center", SIZE[size], className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/tokens/usdg.png" alt="" className="h-full w-full rounded-full" />
      <RobinhoodChainBadge />
    </span>
  );
}

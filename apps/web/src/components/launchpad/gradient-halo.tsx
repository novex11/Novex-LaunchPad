"use client";

import { cn } from "@/lib/utils";

/**
 * A soft radial glow used behind hero sections of launchpad pages.
 * Two coloured light sources blur together to hint at both tokens in a pair.
 * Purely decorative; no interactive semantics.
 */
export function GradientHalo({
  colorA = "#F5A623",
  colorB = "#3D8BFF",
  className,
  intensity = 0.6,
}: {
  colorA?: string;
  colorB?: string;
  className?: string;
  intensity?: number;
}) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}
    >
      <div
        className="absolute -left-24 -top-32 h-[28rem] w-[28rem] rounded-full blur-[120px]"
        style={{ background: colorA, opacity: intensity * 0.45 }}
      />
      <div
        className="absolute -right-24 -top-24 h-[24rem] w-[24rem] rounded-full blur-[120px]"
        style={{ background: colorB, opacity: intensity * 0.35 }}
      />
      <div
        className="absolute inset-x-0 top-0 h-40"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(0,0,0,0) 100%)",
        }}
      />
    </div>
  );
}

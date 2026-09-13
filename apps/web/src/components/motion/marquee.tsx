"use client";

import { cn } from "@/lib/utils";

interface MarqueeProps {
  children: React.ReactNode;
  className?: string;
  /** Seconds for one full loop */
  duration?: number;
  reverse?: boolean;
  pauseOnHover?: boolean;
}

/**
 * Seamless horizontal marquee. Content is duplicated once and translated
 * by -50%, so the loop has no visible seam. CSS-driven (no JS per frame).
 */
export function Marquee({
  children,
  className,
  duration = 50,
  reverse = false,
  pauseOnHover = true,
}: MarqueeProps) {
  return (
    <div
      className={cn(
        "group/marquee relative flex overflow-hidden",
        "[mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]",
        className,
      )}
    >
      <div
        className={cn(
          "flex w-max shrink-0 animate-ticker items-center",
          pauseOnHover && "group-hover/marquee:[animation-play-state:paused]",
        )}
        style={{
          animationDuration: `${duration}s`,
          animationDirection: reverse ? "reverse" : "normal",
        }}
      >
        <div className="flex items-center">{children}</div>
        <div aria-hidden className="flex items-center">
          {children}
        </div>
      </div>
    </div>
  );
}

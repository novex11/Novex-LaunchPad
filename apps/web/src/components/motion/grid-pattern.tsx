import { cn } from "@/lib/utils";

interface GridPatternProps {
  className?: string;
  /** Dot spacing in px */
  size?: number;
  /** CSS mask to fade the pattern out */
  mask?: string;
}

/** Subtle dot grid, masked so it dissolves into the canvas. */
export function GridPattern({
  className,
  size = 26,
  mask = "radial-gradient(ellipse 70% 60% at 50% 0%, black 20%, transparent 100%)",
}: GridPatternProps) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 opacity-70", className)}
      style={{
        backgroundImage:
          "radial-gradient(circle, var(--grid-dot) 1px, transparent 1px)",
        backgroundSize: `${size}px ${size}px`,
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    />
  );
}

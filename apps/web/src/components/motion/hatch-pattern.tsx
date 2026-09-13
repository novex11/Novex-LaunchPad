import { cn } from "@/lib/utils";

interface HatchPatternProps {
  className?: string;
  /** Line color (any CSS color) */
  color?: string;
  /** Gap between lines in px */
  gap?: number;
}

/** Fine diagonal hatching used for section dividers and panel textures. */
export function HatchPattern({
  className,
  color = "var(--grid-dot)",
  gap = 8,
}: HatchPatternProps) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0", className)}
      style={{
        backgroundImage: `repeating-linear-gradient(-45deg, ${color} 0, ${color} 1px, transparent 1px, transparent ${gap}px)`,
      }}
    />
  );
}

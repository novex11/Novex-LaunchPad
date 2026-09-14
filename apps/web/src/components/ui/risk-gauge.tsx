import { cn } from "@/lib/utils";

/** Five-step risk meter: 1 = lowest, 5 = highest. */
export function RiskGauge({
  level,
  className,
  label,
}: {
  level: 1 | 2 | 3 | 4 | 5;
  className?: string;
  label?: string;
}) {
  const tones = ["bg-accent", "bg-accent", "bg-gold", "bg-gold", "bg-destructive"];
  return (
    <div className={cn("flex items-center gap-2", className)} aria-label={label ?? `Risk level ${level} of 5`}>
      <span className="flex items-end gap-0.5" aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "w-1.5 rounded-sm transition-colors",
              i < level ? tones[level - 1] : "bg-border",
            )}
            style={{ height: 6 + i * 2 }}
          />
        ))}
      </span>
      {label && <span className="text-[11px] text-muted-foreground">{label}</span>}
    </div>
  );
}

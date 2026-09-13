import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export interface Metric {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "accent" | "success" | "destructive";
}

/** `divide-x` strip of headline figures — no cards. */
export function MetricBand({
  metrics,
  loading = false,
  className,
}: {
  metrics: Metric[];
  loading?: boolean;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-y-6 rounded-3xl border border-border bg-surface md:grid-cols-4 md:divide-x md:divide-border md:gap-y-0",
        className,
      )}
    >
      {metrics.map((m) => (
        <div key={m.label} className="px-5 py-5 md:px-6">
          <dt className="label-caps">{m.label}</dt>
          <dd
            className={cn(
              "mt-2 font-mono text-2xl font-medium tabular-nums md:text-3xl",
              m.tone === "accent" && "text-accent-strong",
              m.tone === "success" && "text-success",
              m.tone === "destructive" && "text-destructive",
            )}
          >
            {loading ? <Skeleton className="h-8 w-24" /> : m.value}
          </dd>
          {m.hint && <p className="mt-1 text-xs text-muted-foreground">{m.hint}</p>}
        </div>
      ))}
    </dl>
  );
}

import { cn } from "@/lib/utils";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-shimmer rounded-lg bg-surface-muted", className)}
      {...props}
    />
  );
}

/** Row skeleton that mirrors a market-list row layout. */
export function RowSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-border-subtle">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center gap-4 px-4 py-4">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="hidden h-8 w-24 sm:block" />
          <div className="space-y-2 text-right">
            <Skeleton className="ml-auto h-3.5 w-20" />
            <Skeleton className="ml-auto h-3 w-14" />
          </div>
        </li>
      ))}
    </ul>
  );
}

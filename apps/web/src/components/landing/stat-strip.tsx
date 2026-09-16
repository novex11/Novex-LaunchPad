import { cn } from "@/lib/utils";

export interface StatItem {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
}

export function StatStrip({ items, className }: { items: StatItem[]; className?: string }) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 divide-x divide-y divide-border border border-border sm:grid-cols-3 2xl:flex 2xl:divide-y-0",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="px-4 py-3 2xl:flex-auto 2xl:px-3">
          <dt className="label-mono whitespace-nowrap">{item.label}</dt>
          <dd
            className={cn(
              "mt-1 whitespace-nowrap font-mono text-sm font-medium tabular-nums md:text-base",
              item.accent ? "text-accent" : "text-foreground",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

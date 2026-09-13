import { cn } from "@/lib/utils";
import { WatermarkNumber } from "./watermark-number";

interface LedgerCellProps {
  index: string;
  icon?: React.ReactNode;
  title: string;
  body: React.ReactNode;
  className?: string;
}

export function LedgerCell({ index, icon, title, body, className }: LedgerCellProps) {
  return (
    <div className={cn("ledger-cell relative min-h-[180px] border-border bg-surface", className)}>
      <WatermarkNumber n={index} />
      <div className="relative flex items-center gap-2">
        {icon && <span className="text-accent">{icon}</span>}
        <span className="font-mono text-xs text-accent">{index}</span>
      </div>
      <h3 className="relative mt-4 text-base font-medium text-foreground">{title}</h3>
      <div className="relative mt-2 text-sm leading-relaxed text-muted-foreground">{body}</div>
    </div>
  );
}

export function LedgerGrid({
  children,
  cols = 2,
}: {
  children: React.ReactNode;
  cols?: 2 | 3 | 4 | 6;
}) {
  const colClass =
    cols === 6
      ? "md:grid-cols-3 lg:grid-cols-6"
      : cols === 4
        ? "md:grid-cols-2 lg:grid-cols-4"
        : cols === 3
          ? "md:grid-cols-3"
          : "md:grid-cols-2";
  return (
    <div className={cn("grid grid-cols-1 divide-y divide-border border-b border-border md:divide-y-0", colClass, "md:divide-x")}>
      {children}
    </div>
  );
}

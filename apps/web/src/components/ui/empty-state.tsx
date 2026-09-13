import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: Icon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  tone?: "default" | "error";
}

export function EmptyState({
  icon: IconComp,
  title,
  description,
  action,
  className,
  tone = "default",
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-surface/60 px-6 py-14 text-center",
        className,
      )}
    >
      {IconComp && (
        <span
          className={cn(
            "mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl",
            tone === "error"
              ? "bg-destructive/10 text-destructive"
              : "bg-accent-subtle text-accent-strong",
          )}
        >
          <IconComp size={22} weight="duotone" />
        </span>
      )}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

import { cn } from "@/lib/utils";

/** Corner bracket ticks like Accrued's Live Math / ratio cards. */
export function BracketPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative border border-border bg-surface p-5 md:p-6", className)}>
      <span className="pointer-events-none absolute left-0 top-0 h-3 w-3 border-l-2 border-t-2 border-accent" />
      <span className="pointer-events-none absolute right-0 top-0 h-3 w-3 border-r-2 border-t-2 border-accent" />
      <span className="pointer-events-none absolute bottom-0 left-0 h-3 w-3 border-b-2 border-l-2 border-accent" />
      <span className="pointer-events-none absolute bottom-0 right-0 h-3 w-3 border-b-2 border-r-2 border-accent" />
      {children}
    </div>
  );
}

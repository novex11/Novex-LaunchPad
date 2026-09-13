import { cn } from "@/lib/utils";

export function MonoLabel({
  index,
  children,
  className,
}: {
  index?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("label-mono text-accent", className)}>
      {index && `[${index}] `}
      {children}
    </p>
  );
}

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-5",
  {
    variants: {
      variant: {
        default: "border-transparent bg-surface-inverse text-background",
        secondary: "border-transparent bg-surface-muted text-muted-foreground",
        outline: "border-border bg-surface text-foreground",
        accent: "border-transparent bg-accent-subtle text-accent-strong",
        success: "border-transparent bg-success/10 text-success",
        destructive: "border-transparent bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof badgeVariants>) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

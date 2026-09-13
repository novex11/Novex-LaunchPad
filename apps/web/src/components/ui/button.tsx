import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/btn relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all duration-200 ease-out-expo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-accent text-accent-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:bg-accent-strong",
        accent:
          "bg-accent text-accent-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:bg-accent-strong",
        inverse:
          "bg-surface-inverse text-background hover:opacity-90",
        square:
          "rounded-none bg-accent font-mono text-[11px] uppercase tracking-[0.12em] text-accent-foreground hover:bg-accent-strong",
        squareOutline:
          "rounded-none border border-border bg-transparent font-mono text-[11px] uppercase tracking-[0.12em] text-foreground hover:bg-surface-muted",
        outline:
          "border border-border bg-surface text-foreground hover:border-accent/40 hover:bg-accent-subtle/60",
        ghost: "text-foreground hover:bg-surface-muted",
        subtle: "bg-accent-subtle text-accent-strong hover:bg-accent/15",
        link: "text-accent-strong underline-offset-4 hover:underline",
        destructive: "bg-destructive text-accent-foreground hover:opacity-90",
      },
      size: {
        default: "h-10 px-5",
        sm: "h-9 px-4 text-xs",
        lg: "h-12 px-7 text-base",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { buttonVariants };

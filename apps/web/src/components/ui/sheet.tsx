"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

interface SheetContentProps
  extends React.ComponentProps<typeof DialogPrimitive.Content> {
  side?: "right" | "bottom";
}

/**
 * Slide-over panel. Right-side drawer on desktop, bottom sheet on mobile
 * (`side="bottom"` always renders as a bottom sheet).
 */
export function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: SheetContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-surface-inverse/30 backdrop-blur-[2px] data-[state=open]:animate-[fade-in_200ms_ease-out] data-[state=closed]:animate-[fade-out_180ms_ease-in]" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col bg-surface shadow-float outline-none",
          "transition-transform duration-300 ease-out-expo",
          side === "right"
            ? "inset-y-0 right-0 h-[100dvh] w-full max-w-md border-l border-border sm:rounded-l-3xl data-[state=open]:animate-[sheet-in-right_320ms_cubic-bezier(0.16,1,0.3,1)] data-[state=closed]:animate-[sheet-out-right_220ms_ease-in]"
            : "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-3xl border-t border-border data-[state=open]:animate-[sheet-in-bottom_320ms_cubic-bezier(0.16,1,0.3,1)] data-[state=closed]:animate-[sheet-out-bottom_220ms_ease-in]",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label="Close"
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X size={18} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("border-b border-border-subtle px-6 pb-4 pt-6", className)}
      {...props}
    />
  );
}

export const SheetTitle = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title
    className={cn("text-lg font-semibold tracking-tight", className)}
    {...props}
  />
);

export const SheetDescription = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
);

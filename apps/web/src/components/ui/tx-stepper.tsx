"use client";

import { CheckCircle, CircleNotch, Warning, ArrowUpRight } from "@phosphor-icons/react";
import { motion, AnimatePresence } from "motion/react";
import { cn, explorerUrl } from "@/lib/utils";

export interface TxStep {
  id: string;
  label: string;
  hint?: string;
}

export type TxStepperState = "idle" | "error" | "done" | (string & {});

interface TxStepperProps {
  steps: TxStep[];
  /** Id of the step currently running, "done" when finished, "error" on failure. */
  current: TxStepperState;
  /** Step that was running when the error happened. */
  failedAt?: string | null;
  error?: string | null;
  txHash?: string | null;
  compact?: boolean;
  className?: string;
}

/**
 * Generic multi-step wallet flow indicator (approve → deposit → confirmed).
 * Visual twin of the launchpad stage list so every tx flow feels the same.
 */
export function TxStepper({ steps, current, failedAt, error, txHash, compact, className }: TxStepperProps) {
  const ids = steps.map((s) => s.id);
  const ci = current === "done" ? ids.length : current === "error" ? ids.indexOf(failedAt ?? "") : ids.indexOf(current);

  return (
    <ol className={cn("space-y-2", className)}>
      {steps.map((step, i) => {
        const state: "pending" | "active" | "done" | "failed" =
          current === "error"
            ? i < ci
              ? "done"
              : i === ci
                ? "failed"
                : "pending"
            : i < ci
              ? "done"
              : i === ci
                ? "active"
                : "pending";
        return (
          <motion.li
            key={step.id}
            layout
            className={cn(
              "flex items-center gap-3 rounded-xl border text-sm transition-colors",
              compact ? "px-3 py-2" : "p-3",
              state === "done" && "border-accent/40 bg-accent-subtle/50",
              state === "active" && "border-accent bg-accent-subtle",
              state === "failed" && "border-destructive/40 bg-destructive/5",
              state === "pending" && "border-border-subtle bg-surface-muted/60 text-muted-foreground",
            )}
          >
            <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
              {state === "active" && <span className="absolute inset-0 rounded-full bg-accent/30 animate-pulse-ring" />}
              {state === "done" && <CheckCircle size={20} weight="fill" className="text-accent-strong" />}
              {state === "active" && (
                <motion.span animate={{ rotate: 360 }} transition={{ duration: 1.1, ease: "linear", repeat: Infinity }} className="inline-flex">
                  <CircleNotch size={20} weight="bold" className="text-accent-strong" />
                </motion.span>
              )}
              {state === "failed" && <Warning size={20} weight="fill" className="text-destructive" />}
              {state === "pending" && <span className="block h-4 w-4 rounded-full border-2 border-border" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block font-medium leading-snug", state === "pending" && "font-normal")}>{step.label}</span>
              {!compact && step.hint && <span className="block text-xs text-muted-foreground">{step.hint}</span>}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {String(i + 1).padStart(2, "0")}
            </span>
          </motion.li>
        );
      })}
      <AnimatePresence>
        {txHash && current !== "error" && (
          <motion.li
            key="hash"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center justify-between rounded-xl border border-border bg-surface-muted/60 px-3 py-2 font-mono text-[11px]"
          >
            <span className="text-muted-foreground">
              {current === "done" ? "Confirmed" : "Waiting for confirmation…"}
            </span>
            <a
              href={explorerUrl("tx", txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent-strong hover:underline"
            >
              {txHash.slice(0, 8)}…{txHash.slice(-6)}
              <ArrowUpRight size={11} />
            </a>
          </motion.li>
        )}
        {current === "error" && error && (
          <motion.li
            key="err"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-2 rounded-xl border border-destructive/50 bg-destructive/5 p-3 text-xs"
          >
            <Warning size={16} weight="fill" className="mt-0.5 shrink-0 text-destructive" />
            <span className="min-w-0 break-words text-muted-foreground">{error}</span>
          </motion.li>
        )}
      </AnimatePresence>
    </ol>
  );
}

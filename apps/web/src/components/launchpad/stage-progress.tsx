"use client";

import { CheckCircle, CircleNotch, Warning } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { cn, explorerUrl } from "@/lib/utils";
import type { TxStage } from "@/hooks/use-pair-launchpad";
import { AddressChip } from "@/components/launchpad/address-chip";

export interface ProgressStep {
  id: Exclude<TxStage, "idle" | "done" | "error">;
  label: string;
  hint: string;
}

const ORDER: TxStage[] = ["idle", "approve-a", "approve-b", "submit", "done"];

function status(
  current: TxStage,
  step: TxStage,
  lastActive: TxStage | null,
): "pending" | "active" | "done" | "failed" {
  const si = ORDER.indexOf(step);
  if (current === "error") {
    const li = lastActive ? ORDER.indexOf(lastActive) : -1;
    if (si < li) return "done";
    if (si === li) return "failed";
    return "pending";
  }
  const ci = ORDER.indexOf(current);
  if (ci > si) return "done";
  if (ci === si) return "active";
  return "pending";
}

export function StageProgressList({
  steps,
  current,
  lastActive,
  errorMessage,
  pendingHash,
  errorTitle = "Transaction failed",
  className,
}: {
  steps: ProgressStep[];
  current: TxStage;
  /** Stage that was running when an error happened */
  lastActive?: TxStage | null;
  errorMessage?: string | null;
  pendingHash?: `0x${string}`;
  errorTitle?: string;
  className?: string;
}) {
  return (
    <ol className={cn("space-y-3", className)}>
      {steps.map((step) => {
        const state = status(current, step.id, lastActive ?? null);
        return (
          <li
            key={step.id}
            className={cn(
              "flex items-start gap-3 rounded-2xl border p-3 text-sm transition-colors",
              state === "done" && "border-accent bg-accent-subtle/60",
              state === "active" && "border-accent bg-accent-subtle",
              state === "failed" && "border-destructive/40 bg-destructive/5",
              state === "pending" && "border-border-subtle bg-surface-muted",
            )}
          >
            <span className="mt-0.5 shrink-0">
              {state === "done" && (
                <CheckCircle size={20} weight="fill" className="text-accent-strong" />
              )}
              {state === "active" && (
                <motion.span
                  className="inline-block"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.2, ease: "linear", repeat: Infinity }}
                >
                  <CircleNotch size={20} weight="bold" className="text-accent-strong" />
                </motion.span>
              )}
              {state === "failed" && (
                <Warning size={20} weight="fill" className="text-destructive" />
              )}
              {state === "pending" && (
                <span className="block h-5 w-5 rounded-full border-2 border-border" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block font-medium leading-snug">{step.label}</span>
              <span className="block text-xs text-muted-foreground">{step.hint}</span>
            </span>
          </li>
        );
      })}
      {pendingHash && current !== "error" && current !== "done" && (
        <li className="rounded-2xl border border-border bg-surface-muted p-3 text-xs">
          <p className="font-medium text-muted-foreground">Waiting for confirmation…</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="label-caps">Tx</span>
            <AddressChip address={pendingHash} kind="tx" />
            <a
              href={explorerUrl("tx", pendingHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-strong underline-offset-2 hover:underline"
            >
              View on explorer ↗
            </a>
          </div>
        </li>
      )}
      {current === "error" && errorMessage && (
        <li className="flex items-start gap-3 rounded-2xl border border-destructive bg-destructive/5 p-3 text-sm">
          <Warning size={20} weight="fill" className="mt-0.5 shrink-0 text-destructive" />
          <span className="min-w-0">
            <span className="block font-medium text-destructive">{errorTitle}</span>
            <span className="block break-words text-xs text-muted-foreground">{errorMessage}</span>
          </span>
        </li>
      )}
    </ol>
  );
}

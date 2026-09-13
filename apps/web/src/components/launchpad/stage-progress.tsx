"use client";

import { CheckCircle, CircleNotch, Warning } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import type { LaunchStage } from "@/hooks/use-launch-and-seed";

interface Step {
  id: LaunchStage;
  label: string;
  hint: string;
}

const STEPS: Step[] = [
  { id: "deploying", label: "Deploying pair vault", hint: "PairFactory.launchPair()" },
  { id: "waiting-launch", label: "Confirming deployment", hint: "Waiting for chain receipt" },
  { id: "approving", label: "Approving source token", hint: "ERC-20 approve" },
  { id: "swapping", label: "Routing source → USDG", hint: "On-chain conversion" },
  { id: "seeding", label: "Seeding first deposit", hint: "Waiting for seed receipt" },
];

const ORDER: LaunchStage[] = [
  "idle",
  "deploying",
  "waiting-launch",
  "approving",
  "swapping",
  "seeding",
  "done",
];

function status(current: LaunchStage, step: LaunchStage): "pending" | "active" | "done" {
  const ci = ORDER.indexOf(current);
  const si = ORDER.indexOf(step);
  if (current === "error") return si < ci ? "done" : "pending";
  if (ci > si) return "done";
  if (ci === si) return "active";
  return "pending";
}

export function StageProgressList({
  current,
  errorMessage,
  className,
}: {
  current: LaunchStage;
  errorMessage?: string;
  className?: string;
}) {
  return (
    <ol className={cn("space-y-3", className)}>
      {STEPS.map((step) => {
        const state = status(current, step.id);
        return (
          <li
            key={step.id}
            className={cn(
              "flex items-start gap-3 rounded-2xl border p-3 text-sm transition-colors",
              state === "done" && "border-accent bg-accent-subtle/60",
              state === "active" && "border-accent bg-accent-subtle",
              state === "pending" && "border-border-subtle bg-surface-muted",
            )}
          >
            <span className="mt-0.5 shrink-0">
              {state === "done" && (
                <CheckCircle size={20} weight="fill" className="text-accent-strong" />
              )}
              {state === "active" && (
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.2, ease: "linear", repeat: Infinity }}
                >
                  <CircleNotch size={20} weight="bold" className="text-accent-strong" />
                </motion.span>
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
      {current === "error" && errorMessage && (
        <li className="flex items-start gap-3 rounded-2xl border border-destructive bg-destructive/5 p-3 text-sm">
          <Warning size={20} weight="fill" className="mt-0.5 shrink-0 text-destructive" />
          <span className="min-w-0">
            <span className="block font-medium text-destructive">Launch failed</span>
            <span className="block break-words text-xs text-muted-foreground">
              {errorMessage}
            </span>
          </span>
        </li>
      )}
    </ol>
  );
}

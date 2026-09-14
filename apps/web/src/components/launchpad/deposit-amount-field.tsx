"use client";

import { useId } from "react";
import {
  LAUNCHPAD_CONFIG,
  depositAmountError,
  parseDepositUsdInput,
} from "@novex/config";
import { cn } from "@/lib/utils";

export function DepositAmountField({
  value,
  onChange,
  maxUsd,
  label = "USD value to seed",
  hint,
  inputClassName,
  id: idProp,
}: {
  value: number;
  onChange: (usd: number) => void;
  /** When set, shows a Max chip for the largest amount the wallet can fund */
  maxUsd?: number;
  label?: string;
  hint?: string;
  inputClassName?: string;
  id?: string;
}) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const error = depositAmountError(value);
  const { minDepositUsd, maxDepositUsd, depositStepUsd, depositPresets } = LAUNCHPAD_CONFIG;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <label
        htmlFor={id}
        className="mb-2 flex items-baseline justify-between text-sm font-semibold"
      >
        <span>{label}</span>
        <span className="font-mono text-xs text-muted-foreground">
          min ${minDepositUsd}
        </span>
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono text-2xl text-muted-foreground">
          $
        </span>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={minDepositUsd}
          max={maxDepositUsd}
          step={depositStepUsd}
          value={value || ""}
          placeholder={String(LAUNCHPAD_CONFIG.defaultSeedUsd)}
          onChange={(e) => onChange(parseDepositUsdInput(e.target.value))}
          className={cn(
            "h-16 w-full rounded-2xl border bg-surface-muted pl-10 pr-4 font-mono text-3xl font-semibold tabular-nums text-foreground outline-none transition-all focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-subtle)]",
            error
              ? "border-destructive focus:border-destructive"
              : "border-border focus:border-accent",
            inputClassName,
          )}
        />
      </div>
      {error && value > 0 && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {!error && hint && <p className="mt-2 text-[11px] text-muted-foreground">{hint}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {depositPresets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={cn(
              "rounded-full border px-3 py-1 font-mono text-xs transition-all active:scale-[0.98]",
              value === p
                ? "border-accent bg-accent-subtle text-accent-strong"
                : "border-border text-muted-foreground hover:border-accent/40",
            )}
          >
            ${p.toLocaleString()}
          </button>
        ))}
        {maxUsd != null && maxUsd >= minDepositUsd && (
          <button
            type="button"
            onClick={() => onChange(Math.min(maxDepositUsd, Math.floor(maxUsd * 100) / 100))}
            className="ml-auto rounded-full border border-accent bg-accent px-3 py-1 font-mono text-xs font-semibold text-accent-foreground"
          >
            Max ${Math.floor(maxUsd).toLocaleString()}
          </button>
        )}
      </div>
    </div>
  );
}

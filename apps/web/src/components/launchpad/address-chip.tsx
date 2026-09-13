"use client";

import { useState } from "react";
import { ArrowSquareOut, Copy, Check } from "@phosphor-icons/react";
import { cn, explorerUrl, shortAddress } from "@/lib/utils";

/**
 * Copyable address / tx chip with short form + explorer link.
 * Renders inline with a subtle background so multiple can stack in a row.
 */
export function AddressChip({
  address,
  kind = "address",
  label,
  className,
}: {
  address: string;
  kind?: "address" | "tx";
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!address || address === "0x0000000000000000000000000000000000000000") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-1 font-mono text-[11px] text-muted-foreground",
          className,
        )}
      >
        {label ?? "—"}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-1 font-mono text-[11px] transition-colors hover:bg-accent-subtle",
        className,
      )}
    >
      {label && <span className="text-muted-foreground">{label}</span>}
      <span className="tabular-nums">{shortAddress(address)}</span>
      <button
        type="button"
        className="rounded p-0.5 text-muted-foreground transition-colors hover:text-accent-strong"
        aria-label="Copy address"
        onClick={async (e) => {
          e.preventDefault();
          try {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          } catch {
            // ignore
          }
        }}
      >
        {copied ? <Check size={12} weight="bold" /> : <Copy size={12} weight="bold" />}
      </button>
      <a
        href={explorerUrl(kind, address)}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded p-0.5 text-muted-foreground transition-colors hover:text-accent-strong"
        aria-label="Open in explorer"
      >
        <ArrowSquareOut size={12} weight="bold" />
      </a>
    </span>
  );
}

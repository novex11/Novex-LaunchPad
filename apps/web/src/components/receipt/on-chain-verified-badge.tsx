"use client";

import { SealCheck } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";

/** Shown when a receipt balance is read directly from chain (balanceOf). */
export function OnChainVerifiedBadge({ className }: { className?: string }) {
  return (
    <Badge variant="accent" className={className}>
      <SealCheck size={12} weight="fill" />
      On-chain verified
    </Badge>
  );
}

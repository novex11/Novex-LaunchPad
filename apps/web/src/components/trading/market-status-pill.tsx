"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Status = "open" | "pre" | "after" | "closed";

/**
 * Computes US equity market session from wall-clock time in America/New_York.
 * Regular: 09:30–16:00 ET Mon–Fri. Pre 04:00–09:30, After 16:00–20:00.
 */
function getStatus(now = new Date()): Status {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  const hh = Number(get("hour")) % 24;
  const mm = Number(get("minute"));
  const mins = hh * 60 + mm;
  if (weekday === "Sat" || weekday === "Sun") return "closed";
  if (mins >= 570 && mins < 960) return "open";
  if (mins >= 240 && mins < 570) return "pre";
  if (mins >= 960 && mins < 1200) return "after";
  return "closed";
}

const LABEL: Record<Status, string> = {
  open: "Market open",
  pre: "Pre-market",
  after: "After hours",
  closed: "Market closed",
};

export function MarketStatusPill({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const [status, setStatus] = useState<Status>("closed");

  useEffect(() => {
    setStatus(getStatus());
    const id = setInterval(() => setStatus(getStatus()), 60_000);
    return () => clearInterval(id);
  }, []);

  const live = status === "open";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-foreground",
        className,
      )}
      title={LABEL[status]}
    >
      <span className="relative flex h-2 w-2">
        {live && (
          <span className="absolute inline-flex h-full w-full animate-breathe rounded-full bg-success/60" />
        )}
        <span
          className={cn(
            "relative inline-flex h-2 w-2 rounded-full",
            live
              ? "bg-success"
              : status === "closed"
                ? "bg-muted-foreground/50"
                : "bg-gold",
          )}
        />
      </span>
      {!compact && <span>{LABEL[status]}</span>}
      {compact && <span className="font-mono uppercase">{status}</span>}
    </span>
  );
}

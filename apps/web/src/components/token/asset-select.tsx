"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export interface AssetOption<T extends string> {
  id: T;
  label: string;
  subtitle: string;
  logo: ReactNode;
  /** Wallet balance shown on the right; undefined while not connected. */
  balance?: string;
  /** Rendered muted (still selectable) — the panel's blocker explains why. */
  dimmed?: boolean;
  dimmedNote?: string;
}

/**
 * Accessible pay-with / receive selector: a trigger button and a listbox popover.
 * Arrow keys move, Enter/Space pick, Escape or an outside click closes.
 */
export function AssetSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: AssetOption<T>[];
  onChange: (id: T) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const listId = useId();
  const selected = options.find((o) => o.id === value) ?? options[0]!;

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.id === value)));
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    const raf = requestAnimationFrame(() => listRef.current?.focus());
    return () => {
      document.removeEventListener("mousedown", onDown);
      cancelAnimationFrame(raf);
    };
  }, [open, options, value]);

  function pick(id: T) {
    onChange(id);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const o = options[active];
      if (o) pick(o.id);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <p className="mb-2 text-xs text-muted-foreground">{label}</p>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "flex w-full items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent/60 focus:outline-none focus-visible:border-accent",
          open && "border-accent",
        )}
      >
        {selected.logo}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{selected.label}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{selected.subtitle}</span>
        </span>
        {selected.balance !== undefined && (
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{selected.balance}</span>
        )}
        <CaretDown size={14} weight="bold" className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={`${listId}-${options[active]?.id ?? ""}`}
          onKeyDown={onKey}
          className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-2xl border border-border bg-surface p-1.5 shadow-float outline-none"
        >
          {options.map((o, i) => {
            const isSelected = o.id === value;
            return (
              <li
                key={o.id}
                id={`${listId}-${o.id}`}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.id)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors",
                  i === active ? "bg-surface-muted" : "",
                  o.dimmed && "opacity-55",
                )}
              >
                {o.logo}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{o.label}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {o.dimmed && o.dimmedNote ? o.dimmedNote : o.subtitle}
                  </span>
                </span>
                {o.balance !== undefined && (
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{o.balance}</span>
                )}
                {isSelected && <Check size={14} weight="bold" className="shrink-0 text-accent-strong" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

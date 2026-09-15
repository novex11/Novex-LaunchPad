"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, Copy, Info, Warning, Lightbulb, ArrowRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/* ─── Callout ───────────────────────────────────────────── */

export function Callout({
  type = "note",
  title,
  children,
}: {
  type?: "note" | "warning" | "tip";
  title?: string;
  children: ReactNode;
}) {
  const styles = {
    note: { icon: Info, ring: "border-brand-blue/30 bg-brand-blue/5", color: "text-brand-blue" },
    warning: { icon: Warning, ring: "border-gold/40 bg-gold/5", color: "text-gold" },
    tip: { icon: Lightbulb, ring: "border-accent/40 bg-accent-subtle/60", color: "text-accent-strong" },
  }[type];
  const Icon = styles.icon;
  return (
    <div className={cn("my-6 flex gap-3 rounded-xl border p-4 text-sm leading-relaxed", styles.ring)}>
      <Icon size={18} weight="fill" className={cn("mt-0.5 shrink-0", styles.color)} />
      <div className="min-w-0 [&>p]:m-0 [&>p+p]:mt-2">
        {title && <p className="mb-1 font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/* ─── Code block ────────────────────────────────────────── */

export function Code({
  code,
  lang = "bash",
  title,
  className,
}: {
  code: string;
  lang?: string;
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div className={cn("group my-5 overflow-hidden rounded-xl border border-border bg-surface-muted/60", className)}>
      <div className="flex items-center justify-between border-b border-border-subtle px-3.5 py-2">
        <span className="font-mono text-[11px] text-muted-foreground">{title ?? lang}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
          aria-label="Copy code"
        >
          {copied ? <Check size={12} weight="bold" /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Inline code */
export function C({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md border border-border-subtle bg-surface-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
      {children}
    </code>
  );
}

/* ─── Steps ─────────────────────────────────────────────── */

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="my-6 space-y-6 border-l border-border pl-8 [counter-reset:step]">{children}</ol>;
}

export function Step({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <li className="relative [counter-increment:step]">
      <span className="absolute -left-[2.45rem] top-0 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background font-mono text-[11px] text-muted-foreground before:content-[counter(step)]" />
      <p className="text-sm font-semibold leading-6">{title}</p>
      {children && <div className="mt-1.5 text-sm leading-relaxed text-muted-foreground [&>p]:m-0 [&>p+p]:mt-2">{children}</div>}
    </li>
  );
}

/* ─── Cards ─────────────────────────────────────────────── */

export function Cards({ children }: { children: ReactNode }) {
  return <div className="my-6 grid gap-3 sm:grid-cols-2">{children}</div>;
}

export function Card({ href, title, description, icon }: { href: string; title: string; description: string; icon?: ReactNode }) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent/50 hover:bg-surface-muted/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {icon && <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-strong">{icon}</span>}
          <div>
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
          </div>
        </div>
        <ArrowRight size={14} className="mt-1 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </Link>
  );
}

/* ─── Table ─────────────────────────────────────────────── */

export function Table({ head, rows, mono = [] }: { head: string[]; rows: ReactNode[][]; mono?: number[] }) {
  return (
    <div className="my-6 overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-surface-muted/60 text-left">
            {head.map((h) => (
              <th key={h} className="border-b border-border px-3.5 py-2 font-medium text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border-subtle last:border-b-0">
              {r.map((cell, j) => (
                <td key={j} className={cn("px-3.5 py-2 align-top", mono.includes(j) && "font-mono text-[12px]")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Figure ────────────────────────────────────────────── */

export function Figure({ src, alt, caption, children }: { src?: string; alt?: string; caption?: string; children?: ReactNode }) {
  return (
    <figure className="my-6">
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt ?? caption ?? ""} className="block w-full" loading="lazy" />
        ) : (
          children
        )}
      </div>
      {caption && <figcaption className="mt-2 text-center text-xs text-muted-foreground">{caption}</figcaption>}
    </figure>
  );
}

/* ─── Misc ──────────────────────────────────────────────── */

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]">
      {children}
    </kbd>
  );
}

export function Pill({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "accent" | "gold" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        tone === "accent" && "border-accent/40 bg-accent-subtle text-accent-strong",
        tone === "gold" && "border-gold/40 bg-gold/10 text-gold",
        tone === "default" && "border-border bg-surface-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

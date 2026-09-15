"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MagnifyingGlass, ArrowElbowDownLeft } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { flatDocs } from "@/content/docs/registry";

interface Hit {
  href: string;
  page: string;
  section?: string;
  snippet: string;
}

/** Cmd/Ctrl+K search over page titles, section titles and section keywords. */
export function DocsSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const pages = useMemo(() => flatDocs(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
    else setQ("");
  }, [open]);

  const hits = useMemo<Hit[]>(() => {
    const term = q.trim().toLowerCase();
    if (!term) return pages.slice(0, 8).map((p) => ({ href: p.href, page: p.title, snippet: p.description ?? "" }));
    const out: Hit[] = [];
    for (const p of pages) {
      if (p.title.toLowerCase().includes(term) || (p.description ?? "").toLowerCase().includes(term)) {
        out.push({ href: p.href, page: p.title, snippet: p.description ?? "" });
      }
      for (const s of p.sections) {
        const hay = `${s.title} ${(s.keywords ?? []).join(" ")}`.toLowerCase();
        if (hay.includes(term)) out.push({ href: `${p.href}#${s.id}`, page: p.title, section: s.title, snippet: (s.keywords ?? []).slice(0, 4).join(" · ") });
      }
      if (out.length > 12) break;
    }
    return out.slice(0, 12);
  }, [q, pages]);

  useEffect(() => setCursor(0), [q]);

  function go(h: Hit) {
    setOpen(false);
    router.push(h.href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-[13px] text-muted-foreground transition-colors hover:border-accent/40 hover:text-foreground sm:w-56"
        aria-label="Search documentation"
      >
        <MagnifyingGlass size={14} />
        <span className="hidden sm:inline">Search docs…</span>
        <span className="ml-auto hidden items-center gap-0.5 font-mono text-[10px] sm:flex">
          <kbd className="rounded border border-border px-1">⌘</kbd>
          <kbd className="rounded border border-border px-1">K</kbd>
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-float" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-border px-4">
              <MagnifyingGlass size={16} className="text-muted-foreground" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(hits.length - 1, c + 1)); }
                  if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
                  if (e.key === "Enter" && hits[cursor]) go(hits[cursor]!);
                }}
                placeholder="Search documentation"
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">esc</kbd>
            </div>
            <ul className="max-h-[50vh] overflow-y-auto p-2">
              {hits.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No results for “{q}”.</li>}
              {hits.map((h, i) => (
                <li key={`${h.href}-${i}`}>
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(h)}
                    className={cn("flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left", i === cursor ? "bg-accent-subtle" : "hover:bg-surface-muted")}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{h.section ?? h.page}</span>
                      <span className="block truncate text-xs text-muted-foreground">{h.section ? `${h.page} · ${h.snippet}` : h.snippet}</span>
                    </span>
                    {i === cursor && <ArrowElbowDownLeft size={14} className="shrink-0 text-muted-foreground" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

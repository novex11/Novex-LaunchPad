"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CaretRight, List, X, ArrowLeft, ArrowRight, ArrowSquareOut } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/logo-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { DocsSearch } from "@/components/docs/docs-search";
import { DOCS_NAV, flatDocs, type DocPage } from "@/content/docs/registry";

function useActiveHeading(ids: string[]) {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  useEffect(() => {
    if (ids.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: [0, 1] },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [ids]);
  return active;
}

export function DocsShell({ page, children }: { page: DocPage; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const all = useMemo(() => flatDocs(), []);
  const idx = all.findIndex((p) => p.href === page.href);
  const prev = idx > 0 ? all[idx - 1] : undefined;
  const next = idx >= 0 && idx < all.length - 1 ? all[idx + 1] : undefined;
  const headingIds = useMemo(() => page.sections.map((s) => s.id), [page.sections]);
  const active = useActiveHeading(headingIds);
  const group = DOCS_NAV.find((g) => g.items.some((i) => i.href === page.href));

  useEffect(() => {
    document.body.dataset.docs = "1";
    return () => {
      delete document.body.dataset.docs;
    };
  }, []);
  useEffect(() => setOpen(false), [pathname]);

  const sidebar = (
    <nav aria-label="Docs" className="space-y-7 text-[13.5px]">
      {DOCS_NAV.map((g) => (
        <div key={g.title}>
          <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{g.title}</p>
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const on = item.href === page.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "block rounded-md px-2 py-1.5 transition-colors",
                      on ? "bg-accent-subtle font-medium text-accent-strong" : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                    )}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[88rem] items-center gap-4 px-4 md:px-6">
          <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
            <List size={18} />
          </button>
          <Link href="/docs" className="flex items-center gap-2.5" aria-label="Compose docs home">
            <LogoMark className="h-7 w-7 text-foreground" />
            <span className="text-sm font-semibold tracking-tight">Compose</span>
            <span className="hidden rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">Docs</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <DocsSearch />
            <ThemeToggle className="hidden sm:inline-flex rounded-md" />
            <Link href="/" className="hidden items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-surface-muted sm:inline-flex">
              Open app
              <ArrowSquareOut size={13} />
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[88rem] grid-cols-1 gap-8 px-4 md:px-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_13rem]">
        {/* Sidebar */}
        <aside className="hidden lg:block">
          <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto py-8 pr-2 no-scrollbar">{sidebar}</div>
        </aside>

        {/* Content */}
        <main className="min-w-0 py-8 lg:py-10">
          <div className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Link href="/docs" className="hover:text-foreground">Docs</Link>
            {group && (
              <>
                <CaretRight size={10} />
                <span>{group.title}</span>
              </>
            )}
            <CaretRight size={10} />
            <span className="text-foreground">{page.title}</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-[2.25rem] md:leading-tight">{page.title}</h1>
          {page.description && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{page.description}</p>}

          <article className="docs-prose mt-8">{children}</article>

          {/* Prev / next */}
          <div className="mt-14 grid gap-3 border-t border-border pt-6 sm:grid-cols-2">
            {prev ? (
              <Link href={prev.href} className="group rounded-xl border border-border p-4 transition-colors hover:border-accent/50">
                <span className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground"><ArrowLeft size={11} /> Previous</span>
                <span className="mt-1 block text-sm font-medium group-hover:text-accent-strong">{prev.title}</span>
              </Link>
            ) : <span />}
            {next && (
              <Link href={next.href} className="group rounded-xl border border-border p-4 text-right transition-colors hover:border-accent/50">
                <span className="flex items-center justify-end gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">Next <ArrowRight size={11} /></span>
                <span className="mt-1 block text-sm font-medium group-hover:text-accent-strong">{next.title}</span>
              </Link>
            )}
          </div>
          <p className="mt-8 text-xs text-muted-foreground">
            Found an issue? <a className="underline hover:text-foreground" href="https://github.com/novex11/Basket-protocol" target="_blank" rel="noopener noreferrer">Open an issue on GitHub</a>.
          </p>
        </main>

        {/* TOC */}
        <aside className="hidden xl:block">
          <div className="sticky top-14 py-10">
            {page.sections.length > 1 && (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">On this page</p>
                <ul className="mt-3 space-y-1.5 border-l border-border text-[13px]">
                  {page.sections.map((s) => (
                    <li key={s.id}>
                      <a
                        href={`#${s.id}`}
                        className={cn(
                          "-ml-px block border-l py-0.5 pl-3 transition-colors",
                          active === s.id ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </aside>
      </div>

      {/* Mobile nav */}
      {open && (
        <div className="fixed inset-0 z-50 bg-background lg:hidden">
          <div className="flex h-14 items-center justify-between border-b border-border px-4">
            <span className="text-sm font-semibold">Documentation</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation"><X size={20} /></button>
          </div>
          <div className="overflow-y-auto p-4">{sidebar}</div>
        </div>
      )}
    </div>
  );
}

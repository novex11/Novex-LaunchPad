import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

const LEGAL_DOCS = [
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/risk", label: "Risk disclosures" },
];

/**
 * Long-form legal page: hero, sticky table of contents and numbered sections.
 * Section bodies are plain JSX; typography is applied here so pages stay lean.
 */
export function LegalDocument({
  eyebrow = "Legal",
  title,
  effectiveDate,
  intro,
  sections,
  currentHref,
}: {
  eyebrow?: string;
  title: string;
  effectiveDate: string;
  intro: ReactNode;
  sections: LegalSection[];
  currentHref: string;
}) {
  return (
    <div className="relative isolate">

      <div className="container-page py-12 md:py-16">
        <header className="max-w-3xl">
          <p className="label-caps">{eyebrow}</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
            {title}
          </h1>
          <p className="mt-4 font-mono text-xs text-muted-foreground">
            Effective {effectiveDate} · Last updated {effectiveDate}
          </p>
          <div className="mt-6 text-base leading-relaxed text-muted-foreground">
            {intro}
          </div>
        </header>

        <div className="mt-12 grid gap-10 border-t border-border pt-10 lg:grid-cols-12">
          <aside className="lg:col-span-3">
            <nav
              aria-label="On this page"
              className="lg:sticky lg:top-24"
            >
              <p className="label-caps">On this page</p>
              <ol className="mt-4 space-y-2 text-sm">
                {sections.map((s, i) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="group flex gap-3 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70 group-hover:text-accent-strong">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>

              <div className="mt-8 hidden border-t border-border-subtle pt-6 lg:block">
                <p className="label-caps">Documents</p>
                <ul className="mt-4 space-y-2 text-sm">
                  {LEGAL_DOCS.map((d) => (
                    <li key={d.href}>
                      <Link
                        href={d.href}
                        aria-current={d.href === currentHref ? "page" : undefined}
                        className={cn(
                          "transition-colors hover:text-foreground",
                          d.href === currentHref
                            ? "font-medium text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {d.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </nav>
          </aside>

          <article className="max-w-3xl lg:col-span-9">
            {sections.map((s, i) => (
              <section
                key={s.id}
                id={s.id}
                className="scroll-mt-24 border-b border-border-subtle py-8 first:pt-0 last:border-b-0"
              >
                <h2 className="flex items-baseline gap-3 text-xl font-semibold tracking-tight text-foreground">
                  <span className="font-mono text-xs tabular-nums text-accent-strong">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {s.title}
                </h2>
                <div
                  className={cn(
                    "mt-4 space-y-4 text-[15px] leading-relaxed text-muted-foreground",
                    "[&_strong]:font-medium [&_strong]:text-foreground",
                    "[&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_li]:marker:text-accent",
                    "[&_a]:text-accent-strong [&_a]:underline-offset-2 hover:[&_a]:underline",
                    "[&_h3]:pt-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground",
                  )}
                >
                  {s.body}
                </div>
              </section>
            ))}

            <div className="mt-10 rounded-3xl border border-border bg-surface p-6 text-sm text-muted-foreground">
              Related documents:{" "}
              {LEGAL_DOCS.filter((d) => d.href !== currentHref).map((d, i, arr) => (
                <span key={d.href}>
                  <Link
                    href={d.href}
                    className="text-accent-strong underline-offset-2 hover:underline"
                  >
                    {d.label}
                  </Link>
                  {i < arr.length - 1 ? " · " : ""}
                </span>
              ))}
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}

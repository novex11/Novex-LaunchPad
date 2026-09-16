"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { List, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { MarketStatusPill } from "@/components/trading/market-status-pill";
import { DEFAULT_VAULT_ID } from "@/lib/contracts";

const WalletControls = dynamic(
  () => import("./wallet-controls").then((m) => m.WalletControls),
  { ssr: false, loading: () => <span className="inline-block h-9 w-28 border border-border bg-surface" /> },
);

const links = [
  { href: "/markets", label: "Markets" },
  { href: "/create", label: "Create" },
  { href: "/launchpad", label: "Launchpad" },
  { href: "/portfolio", label: "Portfolio" },
  { href: `/vault/${DEFAULT_VAULT_ID}`, label: "Vaults" },
  { href: "/activity", label: "Activity" },
  { href: "/docs", label: "Docs" },
  { href: "/legal/risk", label: "Risk" },
];

function isActive(pathname: string, href: string) {
  if (href.startsWith("/vault")) return pathname.startsWith("/vault");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2", className)} aria-label="Compose home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/compose-mark.png" alt="" aria-hidden width={28} height={28} className="h-7 w-7 rounded-full" />
      <span className="text-sm font-semibold tracking-tight">Compose</span>
    </Link>
  );
}

export function Navbar() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : "";
    return () => { document.documentElement.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <header data-site-chrome className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="flex h-14 items-center justify-between gap-4 px-4 md:px-8">
          <Wordmark />
          <nav className="hidden items-center gap-6 lg:flex" aria-label="Main">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "text-[13px] transition-colors",
                  isActive(pathname, l.href) ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <MarketStatusPill compact className="hidden rounded-none border-border sm:inline-flex" />
            <ThemeToggle className="hidden sm:inline-flex" />
            <WalletControls />
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center border border-border lg:hidden"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
            >
              <List size={18} />
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-[60] bg-background lg:hidden">
          <div className="flex h-14 items-center justify-between border-b border-border px-4">
            <Wordmark />
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu">
              <X size={20} />
            </button>
          </div>
          <nav className="divide-y divide-border">
            {links.map((l, i) => (
              <Link
                key={l.href}
                href={l.href}
                className="flex items-center gap-3 px-4 py-4 font-mono text-sm uppercase tracking-wider"
              >
                <span className="text-accent">{String(i + 1).padStart(2, "0")}</span>
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="border-t border-border p-4">
            <ThemeToggle />
          </div>
        </div>
      )}
    </>
  );
}

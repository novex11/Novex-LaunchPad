"use client";

import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";
import { SectionFrame } from "./section-frame";
import { LedgerCell, LedgerGrid } from "./ledger-cell";

const PAGES = [
  { href: "/markets", title: "Markets", body: "Live prices, sparklines, buy and sell from any row." },
  { href: "/create", title: "Create", body: "Build a basket with real-time allocator preview and Stockback." },
  { href: "/launchpad", title: "Launchpad", body: "Trade tokens backed by real stock pairs; creators earn 70% of the fee on every trade." },
  { href: "/portfolio", title: "Portfolio", body: "Basket allocation, direct holdings, and recent activity." },
];

export function LandingDeskSection() {
  return (
    <SectionFrame
      id="desk"
      index="06"
      eyebrow="The desk"
      title="Four pages. One wallet."
      description="After the wallet signs, the desk is four pages — Markets, Create, Launchpad, and Portfolio. Credit lives on the address. There is no email profile."
    >
      <LedgerGrid cols={4}>
        {PAGES.map((p, i) => (
          <LedgerCell
            key={p.href}
            index={`0${i + 1}`}
            title={p.title}
            body={
              <>
                <p>{p.body}</p>
                <Link
                  href={p.href}
                  className="mt-4 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-accent hover:underline"
                >
                  Open
                  <ArrowRight size={12} />
                </Link>
              </>
            }
          />
        ))}
      </LedgerGrid>
    </SectionFrame>
  );
}

import type { ReactNode } from "react";

export interface DocSection {
  id: string;
  title: string;
  body: ReactNode;
  /** Extra words the search index should match for this section */
  keywords?: string[];
}

export interface DocPage {
  slug: string; // "" for /docs
  href: string;
  title: string;
  description?: string;
  sections: DocSection[];
}

export interface DocGroup {
  title: string;
  items: Array<{ href: string; title: string }>;
}

/** Sidebar order. Pages are loaded lazily by slug from ./pages. */
export const DOCS_NAV: DocGroup[] = [
  {
    title: "Getting started",
    items: [
      { href: "/docs", title: "Introduction" },
      { href: "/docs/quickstart", title: "Quickstart" },
      { href: "/docs/architecture", title: "Architecture" },
    ],
  },
  {
    title: "Concepts",
    items: [
      { href: "/docs/baskets", title: "Managed baskets" },
      { href: "/docs/strategies", title: "Strategies" },
      { href: "/docs/stockback", title: "Stockback rewards" },
      { href: "/docs/launchpad", title: "Pair launchpad" },
      { href: "/docs/dex-pools", title: "DEX pools & visibility" },
      { href: "/docs/creator-tokens", title: "Creator tokens" },
      { href: "/docs/oracles", title: "Oracles & price feeds" },
    ],
  },
  {
    title: "Guides",
    items: [
      { href: "/docs/guides/create-basket", title: "Create a basket" },
      { href: "/docs/guides/launch-pair", title: "Launch a stock × stock pair" },
      { href: "/docs/guides/run-locally", title: "Run the stack locally" },
      { href: "/docs/guides/deploy-testnet", title: "Deploy to testnet" },
    ],
  },
  {
    title: "Reference",
    items: [
      { href: "/docs/reference/contracts", title: "Smart contracts" },
      { href: "/docs/reference/addresses", title: "Deployed addresses" },
      { href: "/docs/reference/api", title: "Services API" },
      { href: "/docs/reference/config", title: "Configuration" },
    ],
  },
  {
    title: "Resources",
    items: [
      { href: "/docs/security", title: "Security & risk" },
      { href: "/docs/faq", title: "FAQ" },
    ],
  },
];

export function flatDocs(): DocPage[] {
  return DOCS_NAV.flatMap((g) => g.items).map((i) => getDocPage(i.href.replace(/^\/docs\/?/, ""))).filter((p): p is DocPage => !!p);
}

// Pages are registered here so the registry stays the single source of truth.
import * as pages from "./pages";

export function getDocPage(slug: string): DocPage | undefined {
  return pages.ALL_PAGES.find((p) => p.slug === slug);
}

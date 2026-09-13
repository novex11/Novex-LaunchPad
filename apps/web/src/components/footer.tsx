"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight } from "@phosphor-icons/react";
import { Wordmark } from "@/components/navbar";
import { HatchPattern } from "@/components/motion/hatch-pattern";

const columns = [
  {
    title: "Product",
    links: [
      { href: "/markets", label: "Markets" },
      { href: "/create", label: "Create basket" },
      { href: "/launch", label: "Launch pair" },
      { href: "/portfolio", label: "Portfolio" },
      { href: "/redeem", label: "Redeem" },
    ],
  },
  {
    title: "Transparency",
    links: [
      { href: "/vault/tNVDA-B", label: "Vault tNVDA-B" },
      { href: "/launchpad", label: "Launchpad" },
      { href: "/activity", label: "Activity" },
      { href: "/legal/risk", label: "Risk disclosures" },
    ],
  },
  {
    title: "Resources",
    links: [
      {
        href: "https://docs.robinhood.com/chain/stock-tokens/",
        label: "Stock Tokens",
        external: true,
      },
      {
        href: "https://www.tradingview.com/",
        label: "TradingView",
        external: true,
      },
    ],
  },
];

const ease = [0.22, 1, 0.36, 1] as const;
const viewport = { once: true, margin: "-10% 0px" };

export function Footer() {
  const reduced = useReducedMotion();
  const fadeUp = (delay = 0) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 18 },
          whileInView: { opacity: 1, y: 0 },
          viewport,
          transition: { duration: 0.6, ease, delay },
        };

  return (
    <footer className="relative mt-24 overflow-hidden border-t border-border bg-surface">
      <HatchPattern className="opacity-60 [mask-image:linear-gradient(to_bottom,transparent,black_70%)]" />
      <div className="container-page relative grid gap-12 py-16 md:grid-cols-12">
        <motion.div className="md:col-span-5" {...fadeUp(0)}>
          <Wordmark />
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Buy tokenized stocks, build managed baskets, and earn Stockback on
            every deposit — on Robinhood Chain, with a $0.00 platform fee.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
            </span>
            All systems nominal
          </div>
        </motion.div>

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:col-span-7">
          {columns.map((col, ci) => (
            <motion.div key={col.title} {...fadeUp(0.1 + ci * 0.1)}>
              <p className="label-caps">{col.title}</p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    {"external" in link && link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex items-center gap-1 text-sm text-muted-foreground transition-all hover:translate-x-0.5 hover:text-foreground"
                      >
                        {link.label}
                        <ArrowUpRight
                          size={12}
                          className="-translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
                        />
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="inline-block text-sm text-muted-foreground transition-all hover:translate-x-0.5 hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Oversized wordmark — letters rise in one by one */}
      <div
        aria-hidden
        className="container-page relative select-none overflow-hidden pb-6"
      >
        <p className="flex text-[22vw] font-semibold leading-[0.8] tracking-[-0.06em] text-foreground opacity-[0.05] md:text-[13rem]">
          {"Novex".split("").map((ch, i) => (
            <motion.span
              key={i}
              className="inline-block"
              initial={reduced ? false : { y: "40%", opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true, margin: "0px 0px -5% 0px" }}
              transition={{ duration: 0.8, ease, delay: 0.15 + i * 0.07 }}
            >
              {ch}
            </motion.span>
          ))}
        </p>
      </div>

      <motion.div className="relative border-t border-border-subtle" {...fadeUp(0.2)}>
        <div className="container-page flex flex-col items-start justify-between gap-2 py-5 font-mono text-[11px] text-muted-foreground md:flex-row md:items-center">
          <p>© {new Date().getFullYear()} Novex · Platform fee $0.00</p>
          <p>Not financial advice · Charts by TradingView · Quotes delayed up to 15s</p>
        </div>
      </motion.div>
    </footer>
  );
}

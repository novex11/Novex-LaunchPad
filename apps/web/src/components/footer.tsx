"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight } from "@phosphor-icons/react";
import { Wordmark } from "@/components/navbar";
import { LogoMark } from "@/components/logo-mark";
import { HatchPattern } from "@/components/motion/hatch-pattern";
import { DEFAULT_VAULT_ID, basketsAvailable } from "@/lib/contracts";

const columns = [
  {
    title: "Product",
    links: [
      { href: "/markets", label: "Markets" },
      { href: "/create", label: "Create basket" },
      { href: "/launch", label: "Launch a token" },
      { href: "/portfolio", label: "Portfolio" },
      { href: "/redeem", label: "Redeem" },
    ],
  },
  {
    title: "Transparency",
    links: [
      ...(basketsAvailable ? [{ href: `/vault/${DEFAULT_VAULT_ID}`, label: `Vault ${DEFAULT_VAULT_ID}` }] : []),
      { href: "/launchpad", label: "Launchpad" },
      { href: "/activity", label: "Activity" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal/terms", label: "Terms of Service" },
      { href: "/legal/privacy", label: "Privacy Policy" },
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
    <footer data-site-chrome className="relative mt-24 overflow-hidden border-t border-border bg-surface">
      <HatchPattern className="opacity-40 [mask-image:linear-gradient(to_bottom,transparent,black_70%)]" />
      <div className="container-page relative grid gap-12 py-16 md:grid-cols-12">
        <motion.div className="md:col-span-5" {...fadeUp(0)}>
          <Wordmark />
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Buy tokenized stocks, build managed baskets, and earn Stockback on
            every deposit — on Robinhood Chain, with a $0.00 platform fee.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
            <span className="relative flex h-1.5 w-1.5">
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
            </span>
            All systems nominal
          </div>
          <a
            href="https://x.com/composedotxyz"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Follow Compose on X"
            className="group mt-4 flex w-fit items-center gap-2 rounded-full border border-border bg-background px-3.5 py-2 text-sm text-muted-foreground transition-all hover:-translate-y-0.5 hover:border-foreground/40 hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5 fill-current">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Follow @composedotxyz
            <ArrowUpRight
              size={12}
              className="-translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
            />
          </a>
        </motion.div>

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 md:col-span-7">
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

      {/* Oversized wordmark — the compass swings in, then letters rise in one by one */}
      <div
        aria-hidden
        className="container-page relative flex select-none items-center gap-[3vw] overflow-hidden pb-6 md:gap-8"
      >
        <motion.div
          className="relative shrink-0"
          initial={reduced ? false : { rotate: -120, scale: 0.6, opacity: 0 }}
          whileInView={{ rotate: 0, scale: 1, opacity: 1 }}
          viewport={{ once: true, margin: "0px 0px -5% 0px" }}
          transition={{ duration: 1.1, ease }}
        >
          <motion.div
            animate={reduced ? undefined : { rotate: 360 }}
            transition={{ duration: 60, ease: "linear", repeat: Infinity }}
          >
            <LogoMark className="relative h-[14vw] w-[14vw] text-foreground opacity-[0.14] md:h-36 md:w-36" />
          </motion.div>
        </motion.div>
        <p className="flex text-[17vw] font-semibold leading-[0.8] tracking-[-0.06em] text-foreground opacity-[0.05] md:text-[11rem]">
          {"Compose".split("").map((ch, i) => (
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
          <p>© {new Date().getFullYear()} Compose · Platform fee $0.00</p>
          <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/legal/terms" className="transition-colors hover:text-foreground">
              Terms
            </Link>
            <Link href="/legal/privacy" className="transition-colors hover:text-foreground">
              Privacy
            </Link>
            <Link href="/legal/risk" className="transition-colors hover:text-foreground">
              Risk
            </Link>
          </nav>
          <p>Not financial advice · Charts by TradingView · Quotes delayed up to 15s</p>
        </div>
      </motion.div>
    </footer>
  );
}

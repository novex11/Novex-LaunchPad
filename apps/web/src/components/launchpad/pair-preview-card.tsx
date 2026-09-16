"use client";

import { motion } from "motion/react";
import { Globe, SealCheck, Sparkle } from "@phosphor-icons/react";
import { cn, formatUsd } from "@/lib/utils";
import { StockLogo } from "@/components/ui/stock-logo";
import { DualLogoStack } from "@/components/launchpad/dual-logo-stack";

/**
 * Live token card preview while the creator fills the launch form.
 * Banner = wide cover · Logo = square avatar over the banner edge.
 */
export function PairPreviewCard({
  tickerA,
  tickerB,
  weightABps,
  name,
  symbol,
  description,
  bannerUrl,
  logoUrl,
  websiteUrl,
  categoryLabel,
  accentA,
  accentB,
  creatorFeeBps,
  priceA,
  priceB,
  className,
}: {
  tickerA: string;
  tickerB: string;
  weightABps: number;
  name: string;
  symbol: string;
  description: string;
  bannerUrl: string;
  logoUrl: string;
  websiteUrl: string;
  categoryLabel: string;
  accentA: string;
  accentB: string;
  creatorFeeBps: number;
  priceA?: number;
  priceB?: number;
  className?: string;
}) {
  const weightBBps = 10_000 - weightABps;
  const hasBanner = bannerUrl.trim().length > 0;
  const hasLogo = logoUrl.trim().length > 0;
  const host = websiteUrl.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[1.75rem] border border-border bg-surface shadow-float",
        className,
      )}
    >
      {/* Banner */}
      <div className="relative h-36 w-full overflow-hidden">
        {hasBanner ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            // Keyed by URL: onError hides the element, and a reused <img> would stay hidden for the next URL.
            key={bannerUrl.trim()}
            src={bannerUrl.trim()}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.opacity = "0";
            }}
          />
        ) : (
          <div
            className="h-full w-full bg-surface-muted"
            style={{
              backgroundImage: "radial-gradient(circle, var(--grid-dot) 1px, transparent 1px)",
              backgroundSize: "14px 14px",
            }}
          />
        )}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.55) 100%)",
          }}
        />

        <span className="absolute left-4 top-4 inline-flex items-center gap-1 rounded-full bg-black/40 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur">
          <Sparkle size={10} weight="fill" />
          {categoryLabel}
        </span>

        <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-black/40 px-2.5 py-1 font-mono text-[10px] font-semibold text-white backdrop-blur">
          <SealCheck size={10} weight="fill" />
          {creatorFeeBps > 0 ? `${(creatorFeeBps / 100).toFixed(1)}% creator` : "Creator-managed"}
        </span>

        {/* Logo or stock leg stack over banner bottom edge */}
        <div className="absolute -bottom-5 left-4">
          {hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={logoUrl.trim()}
              src={logoUrl.trim()}
              alt=""
              className="h-16 w-16 rounded-2xl border-4 border-surface bg-surface object-cover shadow-float md:h-[4.5rem] md:w-[4.5rem]"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <DualLogoStack tickerA={tickerA} tickerB={tickerB} size="lg" />
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-5 pb-5 pt-8">
        <motion.p
          key={symbol || "empty-symbol"}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "font-mono text-xs font-semibold uppercase tracking-wide",
            symbol ? "text-accent-strong" : "text-muted-foreground/60",
          )}
        >
          {symbol || "YOUR-TICKER"}
        </motion.p>
        <motion.h3
          key={name || "empty-name"}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "mt-1 truncate text-xl font-semibold tracking-tight",
            !name && "text-muted-foreground/50",
          )}
        >
          {name || "Your pair name"}
        </motion.h3>
        <p
          className={cn(
            "mt-2 line-clamp-3 min-h-[3.75rem] text-sm leading-relaxed",
            description ? "text-muted-foreground" : "text-muted-foreground/50",
          )}
        >
          {description ||
            "Your description will appear here — explain the thesis, the audience, and why this pair matters."}
        </p>

        {host && (
          <a
            href={websiteUrl.trim()}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs text-accent-strong underline-offset-2 hover:underline"
          >
            <Globe size={12} />
            {host}
          </a>
        )}

        <div className="mt-5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-semibold">
              <StockLogo ticker={tickerA} size="xs" />
              {tickerA}
              <span className="font-mono tabular-nums text-muted-foreground">
                {(weightABps / 100).toFixed(0)}%
              </span>
            </span>
            <span className="flex items-center gap-1.5 font-semibold">
              <span className="font-mono tabular-nums text-muted-foreground">
                {(weightBBps / 100).toFixed(0)}%
              </span>
              {tickerB}
              <StockLogo ticker={tickerB} size="xs" />
            </span>
          </div>
          <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-surface-muted">
            <motion.div
              className="h-full"
              animate={{ width: `${weightABps / 100}%` }}
              transition={{ type: "spring", stiffness: 160, damping: 22 }}
              style={{ background: accentA }}
            />
            <motion.div
              className="h-full flex-1"
              style={{ background: accentB }}
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px] text-muted-foreground">
            <span className="tabular-nums">
              {priceA ? formatUsd(priceA) : "—"}
            </span>
            <span className="text-right tabular-nums">
              {priceB ? formatUsd(priceB) : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

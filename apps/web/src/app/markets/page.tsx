"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { MagnifyingGlass, ArrowsDownUp } from "@phosphor-icons/react";
import {
  ALL_MARKET_ASSETS,
  MARKET_STOCKS,
  FOREX_PAIRS,
  MARKET_CATEGORIES,
} from "@/lib/markets";
import { useQuotes } from "@/hooks/use-quotes";
import { useWatchlist } from "@/hooks/use-watchlist";
import { cn } from "@/lib/utils";
import { MarketList } from "@/components/trading/market-list";
import { MarketStatusPill } from "@/components/trading/market-status-pill";
import { Input } from "@/components/ui/input";

type Tab = "all" | "stocks" | "etf" | "forex" | "watchlist";
type Sort = "default" | "gainers" | "losers" | "price";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "all", label: "All" },
  { id: "stocks", label: "Stocks" },
  { id: "etf", label: "ETFs" },
  { id: "forex", label: "Forex" },
  { id: "watchlist", label: "Watchlist" },
];

const SORTS: Array<{ id: Sort; label: string }> = [
  { id: "default", label: "Default" },
  { id: "gainers", label: "Top gainers" },
  { id: "losers", label: "Top losers" },
  { id: "price", label: "Price" },
];

const ALL_TICKERS = ALL_MARKET_ASSETS.map((s) => s.ticker);

export default function MarketsPage() {
  const [tab, setTab] = useState<Tab>("all");
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("default");
  const { byTicker, isLoading, isFetching, updatedAt, quotes } = useQuotes(ALL_TICKERS);
  const watchlist = useWatchlist();

  const stocks = useMemo(() => {
    let list = ALL_MARKET_ASSETS;
    if (tab === "stocks") list = MARKET_STOCKS.filter((s) => s.category !== "ETF");
    if (tab === "etf") list = MARKET_STOCKS.filter((s) => s.category === "ETF");
    if (tab === "forex") list = FOREX_PAIRS;
    if (tab === "watchlist") list = list.filter((s) => watchlist.has(s.ticker));
    if (category) list = list.filter((s) => s.category === category);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (s) => s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
      );
    }
    if (sort !== "default") {
      list = [...list].sort((a, b) => {
        const qa = byTicker.get(a.ticker);
        const qb = byTicker.get(b.ticker);
        if (sort === "price") return (qb?.price ?? 0) - (qa?.price ?? 0);
        const ca = qa?.changePercent ?? 0;
        const cb = qb?.changePercent ?? 0;
        return sort === "gainers" ? cb - ca : ca - cb;
      });
    }
    return list;
  }, [tab, category, query, sort, byTicker, watchlist]);

  const advancers = quotes.filter((q) => q.changePercent > 0).length;
  const decliners = quotes.filter((q) => q.changePercent < 0).length;

  return (
    <div className="min-h-[100dvh]">
      {/* Header */}
      <section className="border-b border-border-subtle">
        <div className="container-page grid gap-8 py-10 md:grid-cols-12 md:items-end md:py-14">
          <div className="md:col-span-7">
            <p className="label-caps">Markets</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
              Tokenized stocks and forex, priced live
            </h1>
            <p className="mt-4 max-w-xl text-muted-foreground">
              {ALL_MARKET_ASSETS.length} assets on Robinhood Chain. Buy or sell
              directly from any row, or open a symbol for the full TradingView
              chart.
            </p>
          </div>
          <dl className="grid grid-cols-3 divide-x divide-border md:col-span-5">
            {[
              ["Advancing", advancers, "text-success"],
              ["Declining", decliners, "text-destructive"],
              ["Refresh", "15s", ""],
            ].map(([k, v, c]) => (
              <div key={String(k)} className="px-4 first:pl-0">
                <dt className="label-caps">{k}</dt>
                <dd className={cn("mt-1 font-mono text-2xl font-medium tabular-nums", c as string)}>
                  {isLoading && k !== "Refresh" ? "—" : v}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Sticky toolbar */}
      <div className="sticky top-[4.75rem] z-20 border-b border-border-subtle bg-background/85 backdrop-blur-xl">
        <div className="container-page flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {TABS.map((t) => {
              const on = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTab(t.id);
                    if (t.id === "forex") setCategory(null);
                  }}
                  className={cn(
                    "relative shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                    on ? "text-accent-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {on && (
                    <motion.span
                      layoutId="markets-tab"
                      className="absolute inset-0 rounded-full bg-surface-inverse"
                      transition={{ type: "spring", stiffness: 100, damping: 20 }}
                    />
                  )}
                  <span className="relative z-10">
                    {t.label}
                    {t.id === "watchlist" && watchlist.watchlist.length > 0 && (
                      <span className="ml-1.5 font-mono text-[10px] opacity-70">
                        {watchlist.watchlist.length}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1 md:w-64">
              <MagnifyingGlass
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search ticker or company"
                className="h-9 rounded-full pl-9"
                aria-label="Search markets"
              />
            </div>
            <label className="relative">
              <ArrowsDownUp
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                aria-label="Sort"
                className="h-9 appearance-none rounded-full border border-border bg-surface pl-8 pr-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
              >
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {tab !== "forex" && (
          <div className="container-page flex items-center gap-1.5 overflow-x-auto pb-3 no-scrollbar">
            <button
              type="button"
              onClick={() => setCategory(null)}
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-all active:scale-[0.98]",
                category === null
                  ? "border-accent bg-accent-subtle text-accent-strong"
                  : "border-border text-muted-foreground hover:border-accent/40",
              )}
            >
              All sectors
            </button>
            {MARKET_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(category === c ? null : c)}
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-all active:scale-[0.98]",
                  category === c
                    ? "border-accent bg-accent-subtle text-accent-strong"
                    : "border-border text-muted-foreground hover:border-accent/40",
                )}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* List */}
      <section className="container-page py-6">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {stocks.length} {stocks.length === 1 ? "asset" : "assets"}
          </p>
          <div className="flex items-center gap-3">
            <MarketStatusPill />
            {updatedAt > 0 && (
              <span className="font-mono text-[11px] text-muted-foreground">
                {isFetching ? "Refreshing…" : `Updated ${new Date(updatedAt).toLocaleTimeString()}`}
              </span>
            )}
          </div>
        </div>
        <div className="overflow-hidden rounded-3xl border border-border bg-surface shadow-card">
          <MarketList
            stocks={stocks}
            byTicker={byTicker}
            loading={isLoading}
            watchlist={watchlist}
            onClear={() => {
              setQuery("");
              setCategory(null);
              setTab("all");
            }}
          />
        </div>
        {tab === "forex" && (
          <p className="mt-4 text-xs text-muted-foreground">
            Forex quotes are sourced from the same feed; sparklines and logos
            are unavailable for currency pairs.
          </p>
        )}
      </section>
    </div>
  );
}

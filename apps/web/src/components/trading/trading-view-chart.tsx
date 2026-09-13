"use client";

import { useEffect, useRef, memo } from "react";
import { useTheme } from "next-themes";
import { tradingViewSymbol, type MarketStock } from "@/lib/markets";

interface TradingViewChartProps {
  stock: MarketStock;
  height?: number;
  interval?: "1" | "5" | "15" | "60" | "D" | "W";
}

/**
 * TradingView advanced chart, themed to the sage system: transparent
 * background, sage grid, sage up-candles, rose down-candles.
 */
function TradingViewChartInner({
  stock,
  height = 520,
  interval = "D",
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Everything lives inside a wrapper we can detach as a unit. The embed
    // script resolves its container via `parentElement`, so removing the
    // wrapper (rather than clearing innerHTML) keeps that reference valid
    // if the script finishes loading after an effect re-run.
    //
    // The current embed script does NOT fill `__widget`; it appends its own
    // sized container as a sibling. If `__widget` also had a height, the
    // iframe would be pushed below the box and clipped by overflow-hidden.
    // So: the wrapper is a positioned box and every direct child is
    // stretched over it (see `.tradingview-widget-container` rules in
    // globals.css) — whichever element ends up holding the iframe fills it.
    const wrapper = document.createElement("div");
    wrapper.className = "tv-embed-wrapper";
    wrapper.style.height = `${height}px`;
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    wrapper.appendChild(widget);
    el.appendChild(wrapper);

    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.type = "text/javascript";
    script.innerHTML = JSON.stringify({
      autosize: false,
      width: "100%",
      height,
      symbol: tradingViewSymbol(stock),
      interval,
      timezone: "America/New_York",
      theme: dark ? "dark" : "light",
      style: "1",
      locale: "en",
      enable_publishing: false,
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      withdateranges: true,
      support_host: "https://www.tradingview.com",
      backgroundColor: dark ? "#1c1c1f" : "#ffffff",
      gridColor: dark ? "rgba(143,166,131,0.15)" : "rgba(107,127,94,0.12)",
      overrides: {
        "mainSeriesProperties.candleStyle.upColor": dark ? "#8FA683" : "#6B7F5E",
        "mainSeriesProperties.candleStyle.downColor": "#D9655A",
        "mainSeriesProperties.candleStyle.borderUpColor": dark ? "#A9BD9C" : "#56694B",
        "mainSeriesProperties.candleStyle.borderDownColor": "#D9655A",
        "mainSeriesProperties.candleStyle.wickUpColor": dark ? "#8FA683" : "#6B7F5E",
        "mainSeriesProperties.candleStyle.wickDownColor": "#D9655A",
        "paneProperties.background": dark ? "#1C1C1F" : "#FFFFFF",
        "paneProperties.backgroundType": "solid",
        "scalesProperties.textColor": dark ? "#8A8A90" : "#676B62",
      },
    });
    wrapper.appendChild(script);

    return () => {
      wrapper.remove();
    };
  }, [stock.ticker, stock.exchange, height, interval, dark]);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container overflow-hidden rounded-3xl border border-border bg-surface shadow-card"
      style={{ height }}
    />
  );
}

export const TradingViewChart = memo(TradingViewChartInner);

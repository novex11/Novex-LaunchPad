import { describe, expect, it } from "vitest";
import { computeAllocation } from "./allocation.js";
import { computeStockbackPreview } from "./cashback.js";
import { buildPreview } from "./preview.js";
import {
  computeSharePrice,
  computeSharesToMint,
  computeVaultNav,
} from "./nav.js";
import { rawToUiAmount, UI_MULTIPLIER_SCALE } from "./erc8056.js";

describe("allocation engine", () => {
  it("retains deposit asset and diversifies remainder", () => {
    const result = computeAllocation({
      depositTicker: "NVDA",
      depositUsd: 500,
      strategy: "balanced",
      preferred: ["AAPL", "MSFT", "SNDK"],
    });
    expect(result.violations).toHaveLength(0);
    expect(result.totalUsd).toBeCloseTo(500, 0);
    const nvda = result.items.find((i) => i.ticker === "NVDA");
    expect(nvda?.rationale).toBe("retained-from-deposit");
    expect(nvda!.usd).toBeCloseTo(96.25, 0);
  });

  it("excludes specified tickers", () => {
    const result = computeAllocation({
      depositTicker: "NVDA",
      depositUsd: 500,
      strategy: "balanced",
      excluded: ["TSLA"],
    });
    expect(result.items.some((i) => i.ticker === "TSLA")).toBe(false);
  });
});

describe("cashback", () => {
  it("computes deposit and allocation stockback", () => {
    const preview = computeStockbackPreview(500, [
      { ticker: "AAPL", usd: 125 },
      { ticker: "MSFT", usd: 125 },
      { ticker: "SNDK", usd: 75 },
    ]);
    expect(preview.depositStockbackUsd).toBe(2);
    expect(preview.totalAllocationStockbackUsd).toBeCloseTo(2.625, 2);
    expect(preview.totalStockbackUsd).toBeCloseTo(4.625, 2);
    expect(preview.eligible).toBe(true);
  });

  it("rejects below minimum deposit", () => {
    const preview = computeStockbackPreview(50, []);
    expect(preview.eligible).toBe(false);
  });
});

describe("NAV math", () => {
  it("mints shares proportional to contribution", () => {
    const nav = 1_000_000n;
    const shares = 1_000_000n * 10n ** 18n;
    const price = computeSharePrice(nav, shares);
    const minted = computeSharesToMint(504_625n, price);
    expect(minted).toBeGreaterThan(0n);
  });

  it("computes vault NAV from holdings", () => {
    const nav = computeVaultNav([
      { rawBalance: 10n ** 18n, priceUsd8: 500n * 10n ** 8n },
    ]);
    expect(nav).toBe(500n);
  });
});

describe("ERC-8056", () => {
  it("converts raw to UI amount", () => {
    const raw = 10n ** 18n;
    const mult = 2n * UI_MULTIPLIER_SCALE;
    expect(rawToUiAmount(raw, mult)).toBe(2n * 10n ** 18n);
  });
});

describe("preview builder", () => {
  it("builds full deposit preview", () => {
    const preview = buildPreview({
      depositTicker: "NVDA",
      depositUsd: 500,
      strategy: "balanced",
      preferred: ["AAPL", "MSFT"],
    });
    expect(preview.allocation.length).toBeGreaterThan(0);
    expect(preview.stockback.totalStockbackUsd).toBeGreaterThan(0);
    expect(preview.externalCosts.platformFeeUsd).toBe(0);
  });
});

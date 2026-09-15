import { describe, expect, it } from "vitest";
import { APPROVED_STOCK_TOKENS, STRATEGIES, isPlaceholderAddress } from "@compose/config";
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
    // Balanced retains exactly 20% of the deposit; sleeves come out of the swap budget.
    expect(nvda!.usd).toBeCloseTo(100, 6);
    expect(nvda!.weight).toBeCloseTo(0.2, 6);
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

  it("never allocates to tokens without a deployed contract", () => {
    for (const strategy of ["defensive", "balanced", "aggressive"] as const) {
      const result = computeAllocation({
        depositTicker: "AAPL",
        depositUsd: 1000,
        strategy,
        maxTokens: 0,
      });
      for (const item of result.items) {
        const token = APPROVED_STOCK_TOKENS.find((t) => t.ticker === item.ticker);
        expect(token, item.ticker).toBeDefined();
        expect(isPlaceholderAddress(token!.address), `${item.ticker} placeholder`).toBe(false);
      }
      expect(result.items.some((i) => i.ticker === "EURUSD")).toBe(false);
    }
  });

  it("weights sum to 100% and USD sums to the deposit, even with sleeves excluded", () => {
    const cases = [
      { excluded: [] as string[] },
      { excluded: ["USDG"] },
      { excluded: ["EURUSD", "GBPUSD", "AUDUSD", "USDG"] },
    ];
    for (const c of cases) {
      const result = computeAllocation({
        depositTicker: "TSLA",
        depositUsd: 750,
        strategy: "defensive",
        excluded: c.excluded,
      });
      const weight = result.items.reduce((s, i) => s + i.weight, 0);
      expect(weight).toBeCloseTo(1, 6);
      expect(result.totalUsd).toBeCloseTo(750, 6);
      expect(result.violations).toHaveLength(0);
    }
  });

  it("keeps every line under the strategy's single-stock cap, widening the basket if needed", () => {
    for (const strategy of ["defensive", "balanced", "aggressive"] as const) {
      for (const maxTokens of [3, 5, 8, 0]) {
        const result = computeAllocation({ depositTicker: "NVDA", depositUsd: 500, strategy, maxTokens });
        const cap = STRATEGIES[strategy].maxSingleStock;
        expect(result.violations, `${strategy}/${maxTokens}`).toHaveLength(0);
        for (const item of result.items) {
          expect(item.weight, `${strategy}/${maxTokens}/${item.ticker}`).toBeLessThanOrEqual(cap + 1e-9);
        }
        expect(result.items.reduce((s, i) => s + i.weight, 0)).toBeCloseTo(1, 6);
      }
    }
  });

  it("rejects an undeployed deposit asset", () => {
    const result = computeAllocation({ depositTicker: "EURUSD", depositUsd: 500, strategy: "balanced" });
    expect(result.items).toHaveLength(0);
    expect(result.violations[0]).toMatch(/not deployed/);
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

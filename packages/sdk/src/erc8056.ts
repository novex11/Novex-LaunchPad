/** ERC-8056 Scaled UI Amount helpers for Robinhood Stock Tokens */

export const UI_MULTIPLIER_SCALE = 10n ** 18n;

export function rawToUiAmount(rawAmount: bigint, uiMultiplier: bigint): bigint {
  if (uiMultiplier === 0n) return 0n;
  return (rawAmount * uiMultiplier) / UI_MULTIPLIER_SCALE;
}

export function uiToRawAmount(uiAmount: bigint, uiMultiplier: bigint): bigint {
  if (uiMultiplier === 0n) return 0n;
  return (uiAmount * UI_MULTIPLIER_SCALE) / uiMultiplier;
}

export function formatUiShares(rawAmount: bigint, uiMultiplier: bigint): number {
  const ui = rawToUiAmount(rawAmount, uiMultiplier);
  return Number(ui) / 1e18;
}

/** Chainlink feeds on Robinhood Chain already include multiplier — use price directly */
export function tokenUsdValue(
  rawBalance: bigint,
  priceUsd8: bigint,
  decimals = 18,
): bigint {
  const scale = 10n ** BigInt(decimals);
  return (rawBalance * priceUsd8) / scale / 10n ** 8n;
}

export function isMultiplierPending(
  effectiveAt: bigint,
  currentTimestamp: bigint,
  safetyWindowSeconds: number,
): boolean {
  if (effectiveAt === 0n) return false;
  const window = BigInt(safetyWindowSeconds);
  return (
    effectiveAt > currentTimestamp &&
    effectiveAt - currentTimestamp <= window
  );
}

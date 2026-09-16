/**
 * Compose Pair Launchpad configuration
 *
 * Any wallet can launch a unique 2-token pair vault from the tokens listed on
 * the PairFactory. Pairs are funded in kind: depositors add both tokens in the
 * pair's current ratio and redeem a proportional slice of both. The creator's
 * seed is valued at on-chain oracle prices (1 share = $1 at launch).
 */

/**
 * Pairs left out of the public launchpad lists and stats (lowercase addresses).
 * They stay on-chain and remain reachable by address; the factory still treats
 * their token combination as taken.
 */
export const HIDDEN_LAUNCHPAD_PAIRS: readonly string[] = [
  // PTNT: Pons launch test pair (TSLA/NVDA) on mainnet
  "0x1f9e35a83c7f8cbfb66a9cd5730469d995c38372",
];

export const LAUNCHPAD_CONFIG = {
  /** Minimum weight per token in basis points (10%) */
  minWeightBps: 1_000,
  /** Maximum weight per token in basis points (90%) */
  maxWeightBps: 9_000,
  /** Minimum creator fee in basis points (1%) */
  minCreatorFeeBps: 100,
  /** Maximum creator fee in basis points (5%) */
  maxCreatorFeeBps: 500,
  /** Max pairs a single wallet can launch (on-chain enforced) */
  maxPairsPerCreator: 10,
  /** Minimum seed/deposit value in USD (UI-enforced; contract floor is $1) */
  minDepositUsd: 5,
  /** Upper sanity cap for a single seed/deposit (UI-enforced) */
  maxDepositUsd: 10_000_000,
  /** Default amount shown in the launch wizard */
  defaultSeedUsd: 25,
  /** $ increment for the custom amount field */
  depositStepUsd: 1,
  /** Quick-pick buttons — any value between min and max is allowed */
  depositPresets: [10, 25, 50, 100, 250] as const,
  /** Max deviation of the seed's value split from the target weight (on-chain) */
  weightToleranceBps: 300,
  /** DEX pool seeded at launch (Uniswap v3, share token vs USDG) */
  pool: {
    /** Default share of the creator's seed shares moved into the pool */
    defaultShareBps: 2_000,
    /** On-chain cap (PairFactory.MAX_POOL_SHARE_BPS) */
    maxShareBps: 5_000,
    /** Fee tier of the seeded pool */
    feeBps: 30,
    /** Slack added to the quote amount cap to absorb NAV drift between quote and mine */
    quoteBufferBps: 100,
  },
} as const;

/**
 * Safety margin applied to `minShares` and to the extra token headroom the UI
 * approves, so small price moves between quote and inclusion don't revert.
 */
export const LAUNCHPAD_SLIPPAGE_BPS = 100; // 1%

/** Validate a USD seed/deposit amount; returns an error string or null if OK. */
export function depositAmountError(amount: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) {
    return "Enter a deposit amount";
  }
  if (amount < LAUNCHPAD_CONFIG.minDepositUsd) {
    return `Minimum is $${LAUNCHPAD_CONFIG.minDepositUsd}`;
  }
  if (amount > LAUNCHPAD_CONFIG.maxDepositUsd) {
    return `Maximum is $${LAUNCHPAD_CONFIG.maxDepositUsd.toLocaleString()}`;
  }
  return null;
}

/** Parse free-form USD input (allows $15, 20.5, etc.). */
export function parseDepositUsdInput(raw: string): number {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Clamp a parsed deposit to configured min/max. */
export function clampDepositUsd(amount: number): number {
  const min = LAUNCHPAD_CONFIG.minDepositUsd;
  const max = LAUNCHPAD_CONFIG.maxDepositUsd;
  return Math.min(max, Math.max(min, Math.round(amount * 100) / 100));
}

export type LaunchpadConfig = typeof LAUNCHPAD_CONFIG;

/**
 * On-chain receipt symbol for a launched pair, e.g. pTSLA-AAPL.
 * Sorted alphabetically for consistency with the on-chain uniqueness key.
 */
export function pairReceiptSymbol(tickerA: string, tickerB: string): string {
  const [a, b] = [tickerA.toUpperCase(), tickerB.toUpperCase()].sort();
  return `p${a}-${b}`;
}

/** ERC-20 full name shown in wallets, e.g. "Compose TSLA-AAPL Pair" */
export function pairReceiptFullName(tickerA: string, tickerB: string): string {
  const [a, b] = [tickerA.toUpperCase(), tickerB.toUpperCase()].sort();
  return `Compose ${a}-${b} Pair`;
}

/** Max lengths for launch metadata (on-chain + indexer). */
export const LAUNCH_METADATA_LIMITS = {
  displayNameMax: 64,
  symbolMax: 16,
  descriptionMax: 500,
  imageUrlMax: 512,
  websiteUrlMax: 512,
  twitterUrlMax: 64,
} as const;

/**
 * Upload limits for pair cover images. SVG is not accepted: uploads are served
 * from the indexer origin and SVG can carry scripts.
 */
export const LAUNCH_IMAGE_UPLOAD = {
  maxBytes: 2 * 1024 * 1024,
  maxBytesLabel: "2 MB",
  accept: "image/jpeg,image/png,image/webp,image/gif",
  acceptLabel: "JPG, PNG, WebP, GIF",
} as const;

/** Sanitize user-supplied receipt symbol (uppercase alphanumeric + hyphen). */
export function sanitizeReceiptSymbol(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, LAUNCH_METADATA_LIMITS.symbolMax);
}

/** Sanitize display name for on-chain ERC-20 name field. */
export function sanitizeDisplayName(raw: string): string {
  return raw.trim().slice(0, LAUNCH_METADATA_LIMITS.displayNameMax);
}

export function isValidHttpUrl(raw: string, required = false): boolean {
  if (!raw.trim()) return !required;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * X profile in the form Pons stores it: "https://x.com/handle". Accepts
 * "handle", "@handle" or an x.com / twitter.com link. Returns "" for empty
 * input and undefined when it is not a valid X handle.
 */
export function normalizeXProfile(raw: string): string | undefined {
  const text = raw.trim();
  if (!text) return "";
  const handle = text
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.)?(x|twitter)\.com\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/)[0];
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? `https://x.com/${handle}` : undefined;
}

/** Message a creator signs to prove ownership when saving pair metadata. */
export function pairMetadataMessage(input: {
  pairAddress: string;
  displayName?: string;
  description?: string;
  imageUrl?: string;
  logoUrl?: string;
  websiteUrl?: string;
  twitterUrl?: string;
  numeraireTicker?: string;
  issuedAt: string;
}): string {
  return [
    "Compose pair metadata",
    `Pair: ${input.pairAddress.toLowerCase()}`,
    `Name: ${input.displayName ?? ""}`,
    `Description: ${input.description ?? ""}`,
    `Banner: ${input.imageUrl ?? ""}`,
    `Logo: ${input.logoUrl ?? ""}`,
    `Website: ${input.websiteUrl ?? ""}`,
    // Only when set, so profiles signed before the X field keep verifying.
    ...(input.twitterUrl ? [`X: ${input.twitterUrl}`] : []),
    `Quote leg: ${input.numeraireTicker ?? ""}`,
    `Issued: ${input.issuedAt}`,
  ].join("\n");
}

/** Category of a pair based on the two token categories */
export type PairCategory =
  | "stock-stock"
  | "stock-forex"
  | "stock-stable"
  | "stock-crypto"
  | "forex-forex"
  | "forex-stable"
  | "mixed";

export function classifyPair(
  categoryA: string,
  categoryB: string,
): PairCategory {
  const isStock = (c: string) =>
    c === "large-cap" || c === "growth" || c === "broad-market" || c === "thematic";
  const isForex = (c: string) => c === "forex";
  const isStable = (c: string) => c === "stable";
  const isCrypto = (c: string) => c === "crypto";

  const a = { stock: isStock(categoryA), forex: isForex(categoryA), stable: isStable(categoryA), crypto: isCrypto(categoryA) };
  const b = { stock: isStock(categoryB), forex: isForex(categoryB), stable: isStable(categoryB), crypto: isCrypto(categoryB) };

  if (a.stock && b.stock) return "stock-stock";
  if (a.forex && b.forex) return "forex-forex";
  if ((a.stock && b.forex) || (a.forex && b.stock)) return "stock-forex";
  if ((a.stock && b.stable) || (a.stable && b.stock)) return "stock-stable";
  if ((a.stock && b.crypto) || (a.crypto && b.stock)) return "stock-crypto";
  if ((a.forex && b.stable) || (a.stable && b.forex)) return "forex-stable";
  return "mixed";
}

/** Human-readable label for a pair category shown in the UI */
export const PAIR_CATEGORY_LABEL: Record<PairCategory, string> = {
  "stock-stock": "Stock × Stock",
  "stock-forex": "Stock × Forex",
  "stock-stable": "Stock × Stable",
  "stock-crypto": "Stock × Crypto",
  "forex-forex": "Forex × Forex",
  "forex-stable": "Forex × Stable",
  mixed: "Multi-asset",
};

/** Colored accent tokens for each category (matched to landing theme). */
export const PAIR_CATEGORY_ACCENT: Record<PairCategory, string> = {
  "stock-stock": "#F5A623",
  "stock-forex": "#3D8BFF",
  "stock-stable": "#22C55E",
  "stock-crypto": "#627EEA",
  "forex-forex": "#8B5CF6",
  "forex-stable": "#14B8A6",
  mixed: "#9CA3AF",
};

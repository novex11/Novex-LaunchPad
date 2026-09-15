import { isTestnetMode, testnetDeployments } from "./testnet.js";
import { mainnetDeployment, mainnetManifest } from "./mainnet.js";

/** Tradable token metadata — verify addresses against Robinhood Chain token registry */
export interface StockToken {
  ticker: string;
  name: string;
  address: `0x${string}`;
  priceFeed: `0x${string}`;
  category:
    | "large-cap"
    | "growth"
    | "broad-market"
    | "stable"
    | "thematic"
    | "forex"
    | "crypto";
  decimals: number;
  /**
   * Whether this token can be used as a leg in a launchpad pair. Defaults
   * to `true` for every approved token. Set to `false` to restrict a token
   * from being paired via the permissionless launchpad.
   */
  launchpadEligible?: boolean;
  /**
   * Whether this token can serve as a "numeraire" / quote asset in a pair
   * (inspired by Long.xyz where stock tokens like NVDA, AAPL are the quote
   * side of every pool). Numeraire-eligible tokens have deep on-chain
   * liquidity, reliable price feeds, and broad user familiarity.
   */
  numeraire?: boolean;
  /**
   * Trading session capabilities from Robinhood's RHJ `/assets` API.
   * Used to warn users about off-hours liquidity gaps — Long.xyz documents
   * this as "session mismatch risk" where 24/7 DEX prices can deviate from
   * the underlying equity during closed market hours.
   */
  tradingHours?: {
    /** Tradable during regular market hours (9:30–16:00 ET) */
    market: boolean;
    /** Tradable during extended/pre-post hours */
    extended: boolean;
    /** Tradable overnight (24/5 session) */
    overnight: boolean;
  };
  /**
   * Robinhood CDN logo URL derived from contract address.
   * Format: https://cdn.robinhood.com/ncw_assets/logos/{address}.png
   */
  logoUrl?: string;
}

/** All tokens that can be used as a leg in a launched pair */
export function launchpadEligibleTokens(): StockToken[] {
  return getActiveStockTokens().filter((t) => t.launchpadEligible !== false);
}

/**
 * Tokens suitable as a numeraire (quote / anchor asset) in a pair.
 * Inspired by Long.xyz where every pool trades COMMUNITY_TOKEN/STOCK_TOKEN —
 * the stock is the quote side. For Compose stock-stock pairs the numeraire is
 * the larger, deeper-liquidity leg that anchors the pair's value narrative.
 */
export function numeraireTokens(): StockToken[] {
  return getActiveStockTokens().filter((t) => t.numeraire === true);
}

/**
 * Check if the current time falls within the Robinhood Stock Token
 * tokenization window (Mon 02:00 CET – Sat 02:00 CET). Outside this
 * window, on-chain minting/burning is paused but DEX trading continues,
 * which can cause price dislocations. Long.xyz flags this as session
 * mismatch risk.
 */
export function isTokenizationWindowOpen(): boolean {
  const now = new Date();
  const utcDay = now.getUTCDay();
  const utcHour = now.getUTCHours();
  // CET = UTC+1 (CEST = UTC+2); use UTC+1 as conservative approximation
  // Mon 02:00 CET = Mon 01:00 UTC, Sat 02:00 CET = Sat 01:00 UTC
  if (utcDay === 0) return false; // Sunday
  if (utcDay === 6 && utcHour >= 1) return false; // Saturday after 01:00 UTC
  if (utcDay === 1 && utcHour < 1) return false; // Monday before 01:00 UTC
  return true;
}

/**
 * Check if US equity markets are in regular hours (approx 9:30–16:00 ET).
 * Used to show off-hours warnings on pair deposits.
 */
export function isUSMarketHours(): boolean {
  const now = new Date();
  const utcDay = now.getUTCDay();
  if (utcDay === 0 || utcDay === 6) return false;
  // ET ≈ UTC-4 (EDT) or UTC-5 (EST); use UTC-4 as approximation
  const etHour = (now.getUTCHours() - 4 + 24) % 24;
  const etMin = now.getUTCMinutes();
  const minutesSinceMidnight = etHour * 60 + etMin;
  return minutesSinceMidnight >= 570 && minutesSinceMidnight < 960; // 9:30–16:00
}

/**
 * Hand-written adjustments layered on top of the RHJ manifest: numeraire
 * flags for deep-liquidity names, category corrections, launchpad opt-outs.
 * Everything else (address, decimals, logo, trading hours) comes from
 * `mainnet-manifest.json` (regenerate with `pnpm manifest:mainnet`).
 */
export const TOKEN_OVERRIDES: Record<string, Partial<Omit<StockToken, "ticker" | "address">>> = {
  NVDA: { name: "NVIDIA", category: "growth", numeraire: true },
  AAPL: { name: "Apple", category: "large-cap", numeraire: true },
  MSFT: { name: "Microsoft", category: "large-cap", numeraire: true },
  SPY: { name: "SPDR S&P 500 ETF Trust", category: "broad-market", numeraire: true },
  QQQ: { name: "Invesco QQQ Trust", category: "broad-market", numeraire: true },
  GOOGL: { name: "Alphabet Class A", category: "large-cap", numeraire: true },
  AMZN: { name: "Amazon", category: "large-cap", numeraire: true },
  TSLA: { name: "Tesla", category: "growth", numeraire: true },
  META: { name: "Meta Platforms", category: "large-cap", numeraire: true },
  SNDK: { name: "SanDisk Corporation", category: "growth" },
  AMD: { name: "AMD", category: "growth" },
  PLTR: { name: "Palantir Technologies", category: "growth" },
  COIN: { name: "Coinbase", category: "growth" },
  SPCX: { name: "Space Exploration Technologies", category: "thematic" },
  INTC: { name: "Intel", category: "large-cap" },
  MU: { name: "Micron Technology", category: "growth" },
  ORCL: { name: "Oracle Corporation", category: "large-cap" },
  NFLX: { name: "Netflix", category: "large-cap" },
};

const NO_FEED = "0x0000000000000000000000000000000000000000" as const;
const ALL_SESSIONS = { market: true, extended: true, overnight: true };

/** Canonical non-stock assets on Robinhood Chain (not part of the RHJ registry). */
const MAINNET_BASE_TOKENS: StockToken[] = [
  {
    ticker: "USDG",
    name: "Global Dollar",
    address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    priceFeed: NO_FEED,
    category: "stable",
    decimals: 6,
    // USDG is the quote asset for pools and routers, not a launchable leg.
    launchpadEligible: false,
  },
  {
    ticker: "WETH",
    name: "Wrapped ETH",
    address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
    priceFeed: NO_FEED,
    category: "crypto",
    decimals: 18,
  },
];

function mainnetFeed(ticker: string): `0x${string}` {
  const feed = mainnetDeployment().feeds?.[ticker];
  return feed && /^0x[0-9a-fA-F]{40}$/.test(feed) ? (feed as `0x${string}`) : NO_FEED;
}

function buildMainnetTokens(): StockToken[] {
  const stocks: StockToken[] = mainnetManifest().tokens.map((m) => {
    const o = TOKEN_OVERRIDES[m.ticker] ?? {};
    return {
      ticker: m.ticker,
      name: o.name ?? m.name,
      address: m.address,
      priceFeed: mainnetFeed(m.ticker),
      category: o.category ?? m.category,
      decimals: m.decimals,
      numeraire: o.numeraire,
      launchpadEligible: o.launchpadEligible,
      tradingHours: m.tradingHours ?? ALL_SESSIONS,
      logoUrl: m.logoUrl,
    };
  });
  const base = MAINNET_BASE_TOKENS.map((t) => ({ ...t, priceFeed: mainnetFeed(t.ticker) }));
  return [...stocks, ...base];
}

/**
 * Every tokenized stock on Robinhood Chain mainnet (from the RHJ manifest)
 * plus USDG and WETH. Price feeds are filled in from `mainnet-deployments.json`
 * once the launchpad is deployed and synced.
 */
export const MAINNET_TOKENS: StockToken[] = buildMainnetTokens();

/** @deprecated alias kept for older imports — use MAINNET_TOKENS / getActiveStockTokens(). */
export const APPROVED_STOCK_TOKENS: StockToken[] = MAINNET_TOKENS;

/** Tokens that can be deposited into a managed basket (equities and ETFs only). */
export const DEPOSIT_ASSETS = MAINNET_TOKENS.filter(
  (t) => t.category !== "stable" && t.category !== "forex" && t.category !== "crypto",
);

/** All forex tokens (none on Robinhood Chain yet). */
export const FOREX_TOKENS = MAINNET_TOKENS.filter((t) => t.category === "forex");

/** All equity tokens (non-stable, non-forex, non-crypto). */
export const EQUITY_TOKENS = DEPOSIT_ASSETS;

/**
 * Robinhood Chain Testnet (46630): the real faucet Stock Tokens and canonical
 * testnet WETH. These are the only assets that exist on testnet — everything
 * else in APPROVED_STOCK_TOKENS is mainnet-only.
 */
export const TESTNET_TOKENS: StockToken[] = [
  { ticker: "TSLA", name: "Tesla", address: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E", priceFeed: NO_FEED, category: "growth", decimals: 18, numeraire: true, tradingHours: ALL_SESSIONS },
  { ticker: "AMZN", name: "Amazon", address: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02", priceFeed: NO_FEED, category: "large-cap", decimals: 18, numeraire: true, tradingHours: ALL_SESSIONS },
  { ticker: "AMD", name: "AMD", address: "0x71178BAc73cBeb415514eB542a8995b82669778d", priceFeed: NO_FEED, category: "growth", decimals: 18, tradingHours: ALL_SESSIONS },
  { ticker: "PLTR", name: "Palantir Technologies", address: "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0", priceFeed: NO_FEED, category: "growth", decimals: 18, tradingHours: ALL_SESSIONS },
  { ticker: "NFLX", name: "Netflix", address: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93", priceFeed: NO_FEED, category: "large-cap", decimals: 18, tradingHours: ALL_SESSIONS },
  { ticker: "WETH", name: "Wrapped ETH", address: "0x7943e237c7F95DA44E0301572D358911207852Fa", priceFeed: NO_FEED, category: "crypto", decimals: 18 },
];

function withTestnetFeed(token: StockToken): StockToken {
  const feed = (testnetDeployments as { feeds?: Record<string, string> }).feeds?.[token.ticker];
  return feed && /^0x[0-9a-fA-F]{40}$/.test(feed)
    ? { ...token, priceFeed: feed as `0x${string}` }
    : token;
}

/** Network-aware token list: testnet faucet tokens or the mainnet registry. */
export function getActiveStockTokens(): StockToken[] {
  return isTestnetMode() ? TESTNET_TOKENS.map(withTestnetFeed) : MAINNET_TOKENS;
}

export function getTokenByTicker(ticker: string): StockToken | undefined {
  const wanted = ticker.toUpperCase();
  return getActiveStockTokens().find((t) => t.ticker.toUpperCase() === wanted);
}

export function getTokenByAddress(address: string): StockToken | undefined {
  const wanted = address.toLowerCase();
  return (
    getActiveStockTokens().find((t) => t.address.toLowerCase() === wanted) ??
    MAINNET_TOKENS.find((t) => t.address.toLowerCase() === wanted) ??
    TESTNET_TOKENS.find((t) => t.address.toLowerCase() === wanted)
  );
}

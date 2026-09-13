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
    | "forex";
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
  return APPROVED_STOCK_TOKENS.filter((t) => t.launchpadEligible !== false);
}

/**
 * Tokens suitable as a numeraire (quote / anchor asset) in a pair.
 * Inspired by Long.xyz where every pool trades COMMUNITY_TOKEN/STOCK_TOKEN —
 * the stock is the quote side. For Novex stock-stock pairs the numeraire is
 * the larger, deeper-liquidity leg that anchors the pair's value narrative.
 */
export function numeraireTokens(): StockToken[] {
  return APPROVED_STOCK_TOKENS.filter((t) => t.numeraire === true);
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

/** Initial MVP whitelist — deepest liquidity tokens */
export const APPROVED_STOCK_TOKENS: StockToken[] = [
  // ──── Equities ────────────────────────────────────────
  {
    ticker: "NVDA",
    name: "NVIDIA",
    address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
    priceFeed: "0x0000000000000000000000000000000000000101",
    category: "growth",
    decimals: 18,
    numeraire: true,
    tradingHours: { market: true, extended: true, overnight: true },
    logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec.png",
  },
  {
    ticker: "AAPL",
    name: "Apple",
    address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
    priceFeed: "0x0000000000000000000000000000000000000102",
    category: "large-cap",
    decimals: 18,
    numeraire: true,
    tradingHours: { market: true, extended: true, overnight: true },
    logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0xaf3d76f1834a1d425780943c99ea8a608f8a93f9.png",
  },
  {
    ticker: "MSFT",
    name: "Microsoft",
    address: "0xe93237c50d904957cf27e7b1133b510c669c2e74",
    priceFeed: "0x0000000000000000000000000000000000000103",
    category: "large-cap",
    decimals: 18,
    numeraire: true,
    tradingHours: { market: true, extended: true, overnight: true },
    logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0xe93237c50d904957cf27e7b1133b510c669c2e74.png",
  },
  {
    ticker: "SPY",
    name: "SPDR S&P 500 ETF Trust",
    address: "0x117cc2133c37b721f49de2a7a74833232b3b4c0c",
    priceFeed: "0x0000000000000000000000000000000000000104",
    category: "broad-market",
    decimals: 18,
    numeraire: true,
    tradingHours: { market: true, extended: true, overnight: true },
    logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x117cc2133c37b721f49de2a7a74833232b3b4c0c.png",
  },
  {
    ticker: "QQQ",
    name: "Invesco QQQ Trust",
    address: "0xd5f3879160bc7c32ebb4dc785f8a4f505888de68",
    priceFeed: "0x0000000000000000000000000000000000000105",
    category: "broad-market",
    decimals: 18,
    numeraire: true,
    tradingHours: { market: true, extended: true, overnight: true },
    logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0xd5f3879160bc7c32ebb4dc785f8a4f505888de68.png",
  },
  {
    ticker: "GOOGL",
    name: "Alphabet Class A",
    address: "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3",
    priceFeed: "0x0000000000000000000000000000000000000106",
    category: "large-cap",
    decimals: 18,
    numeraire: true,
    tradingHours: { market: true, extended: true, overnight: true },
    logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3.png",
  },
  {
    ticker: "AMZN",
    name: "Amazon",
    address: "0x12f190a9f9d7d37a250758b26824b97ce941bf54",
    priceFeed: "0x0000000000000000000000000000000000000107",
    category: "large-cap",
    decimals: 18,
    numeraire: true,
    tradingHours: { market: true, extended: true, overnight: true },
    logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x12f190a9f9d7d37a250758b26824b97ce941bf54.png",
  },
  {
    ticker: "TSLA",
    name: "Tesla",
    address: "0x322f0929c4625ed5bad873c95208d54e1c003b2d",
    priceFeed: "0x0000000000000000000000000000000000000108",
    category: "growth",
    decimals: 18,
    numeraire: true,
    tradingHours: { market: true, extended: true, overnight: true },
    logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x322f0929c4625ed5bad873c95208d54e1c003b2d.png",
  },
  {
    ticker: "SNDK",
    name: "SanDisk Corporation",
    address: "0xb90a19ff0af67f7779aff50a882a9cff42446400",
    priceFeed: "0x0000000000000000000000000000000000000109",
    category: "growth",
    decimals: 18,
    tradingHours: { market: true, extended: true, overnight: true },
    logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0xb90a19ff0af67f7779aff50a882a9cff42446400.png",
  },
  {
    ticker: "USDG",
    name: "Global Dollar",
    address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    priceFeed: "0x0000000000000000000000000000000000000110",
    category: "stable",
    decimals: 6,
  },

  // ──── Additional Rialto-listed equities ───────────────
  {
    ticker: "META",
    name: "Meta Platforms",
    address: "0xc0d6457c16cc70d6790dd43521c899c87ce02f35",
    priceFeed: "0x0000000000000000000000000000000000000120",
    category: "large-cap",
    decimals: 18,
    numeraire: true,
    tradingHours: { market: true, extended: true, overnight: true },
    logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0xc0d6457c16cc70d6790dd43521c899c87ce02f35.png",
  },
  {
    ticker: "AMD",
    name: "AMD",
    address: "0x86923f96303d656e4aa86d9d42d1e57ad2023fdc",
    priceFeed: "0x0000000000000000000000000000000000000121",
    category: "growth",
    decimals: 18,
    tradingHours: { market: true, extended: true, overnight: true },
    logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x86923f96303d656e4aa86d9d42d1e57ad2023fdc.png",
  },
  {
    ticker: "PLTR",
    name: "Palantir Technologies",
    address: "0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a",
    priceFeed: "0x0000000000000000000000000000000000000122",
    category: "growth",
    decimals: 18,
    tradingHours: { market: true, extended: true, overnight: true },
    logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a.png",
  },
  {
    ticker: "COIN",
    name: "Coinbase",
    address: "0x6330d8c3178a418788df01a47479c0ce7ccf450b",
    priceFeed: "0x0000000000000000000000000000000000000123",
    category: "growth",
    decimals: 18,
    tradingHours: { market: true, extended: true, overnight: true },
    logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x6330d8c3178a418788df01a47479c0ce7ccf450b.png",
  },
  {
    ticker: "SPCX",
    name: "Space Exploration Technologies",
    address: "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea",
    priceFeed: "0x0000000000000000000000000000000000000124",
    category: "thematic",
    decimals: 18,
    tradingHours: { market: true, extended: false, overnight: false },
    logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea.png",
  },
  {
    ticker: "INTC",
    name: "Intel",
    address: "0xc72b96e0e48ecd4dc75e1e45396e26300bc39681",
    priceFeed: "0x0000000000000000000000000000000000000125",
    category: "large-cap",
    decimals: 18,
    tradingHours: { market: true, extended: true, overnight: true },
    logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0xc72b96e0e48ecd4dc75e1e45396e26300bc39681.png",
  },
  {
    ticker: "MU",
    name: "Micron Technology",
    address: "0xff080c8ce2e5feadaca0da81314ae59d232d4afd",
    priceFeed: "0x0000000000000000000000000000000000000126",
    category: "growth",
    decimals: 18,
    tradingHours: { market: true, extended: true, overnight: true },
    logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0xff080c8ce2e5feadaca0da81314ae59d232d4afd.png",
  },
  {
    ticker: "ORCL",
    name: "Oracle Corporation",
    address: "0xb0992820e760d836549ba69bc7598b4af75dee03",
    priceFeed: "0x0000000000000000000000000000000000000127",
    category: "large-cap",
    decimals: 18,
    tradingHours: { market: true, extended: true, overnight: true },
    logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0xb0992820e760d836549ba69bc7598b4af75dee03.png",
  },

  // ──── Forex ───────────────────────────────────────────
  {
    ticker: "EURUSD",
    name: "Euro / US Dollar",
    address: "0x0000000000000000000000000000000000000011",
    priceFeed: "0x0000000000000000000000000000000000000111",
    category: "forex",
    decimals: 18,
  },
  {
    ticker: "GBPUSD",
    name: "British Pound / US Dollar",
    address: "0x0000000000000000000000000000000000000012",
    priceFeed: "0x0000000000000000000000000000000000000112",
    category: "forex",
    decimals: 18,
  },
  {
    ticker: "AUDUSD",
    name: "Australian Dollar / US Dollar",
    address: "0x0000000000000000000000000000000000000013",
    priceFeed: "0x0000000000000000000000000000000000000113",
    category: "forex",
    decimals: 18,
  },
  {
    ticker: "NZDUSD",
    name: "New Zealand Dollar / US Dollar",
    address: "0x0000000000000000000000000000000000000014",
    priceFeed: "0x0000000000000000000000000000000000000114",
    category: "forex",
    decimals: 18,
  },
  {
    ticker: "USDCAD",
    name: "US Dollar / Canadian Dollar",
    address: "0x0000000000000000000000000000000000000015",
    priceFeed: "0x0000000000000000000000000000000000000115",
    category: "forex",
    decimals: 18,
  },
  {
    ticker: "USDCHF",
    name: "US Dollar / Swiss Franc",
    address: "0x0000000000000000000000000000000000000016",
    priceFeed: "0x0000000000000000000000000000000000000116",
    category: "forex",
    decimals: 18,
  },
];

/** Tokens available as deposit asset (excludes stable + forex) */
export const DEPOSIT_ASSETS = APPROVED_STOCK_TOKENS.filter(
  (t) => t.category !== "stable" && t.category !== "forex",
);

/** All forex tokens */
export const FOREX_TOKENS = APPROVED_STOCK_TOKENS.filter(
  (t) => t.category === "forex",
);

/** All equity tokens (non-stable, non-forex) */
export const EQUITY_TOKENS = APPROVED_STOCK_TOKENS.filter(
  (t) => t.category !== "stable" && t.category !== "forex",
);

export function getTokenByTicker(ticker: string): StockToken | undefined {
  return APPROVED_STOCK_TOKENS.find(
    (t) => t.ticker.toUpperCase() === ticker.toUpperCase(),
  );
}

export function getTokenByAddress(address: string): StockToken | undefined {
  return APPROVED_STOCK_TOKENS.find(
    (t) => t.address.toLowerCase() === address.toLowerCase(),
  );
}

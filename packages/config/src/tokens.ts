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
}

/** Initial MVP whitelist — deepest liquidity tokens */
export const APPROVED_STOCK_TOKENS: StockToken[] = [
  // ──── Equities ────────────────────────────────────────
  {
    ticker: "NVDA",
    name: "NVIDIA",
    address: "0x0000000000000000000000000000000000000001",
    priceFeed: "0x0000000000000000000000000000000000000101",
    category: "growth",
    decimals: 18,
  },
  {
    ticker: "AAPL",
    name: "Apple",
    address: "0x0000000000000000000000000000000000000002",
    priceFeed: "0x0000000000000000000000000000000000000102",
    category: "large-cap",
    decimals: 18,
  },
  {
    ticker: "MSFT",
    name: "Microsoft",
    address: "0x0000000000000000000000000000000000000003",
    priceFeed: "0x0000000000000000000000000000000000000103",
    category: "large-cap",
    decimals: 18,
  },
  {
    ticker: "SPY",
    name: "SPDR S&P 500 ETF",
    address: "0x0000000000000000000000000000000000000004",
    priceFeed: "0x0000000000000000000000000000000000000104",
    category: "broad-market",
    decimals: 18,
  },
  {
    ticker: "QQQ",
    name: "Invesco QQQ Trust",
    address: "0x0000000000000000000000000000000000000005",
    priceFeed: "0x0000000000000000000000000000000000000105",
    category: "broad-market",
    decimals: 18,
  },
  {
    ticker: "GOOGL",
    name: "Alphabet",
    address: "0x0000000000000000000000000000000000000006",
    priceFeed: "0x0000000000000000000000000000000000000106",
    category: "large-cap",
    decimals: 18,
  },
  {
    ticker: "AMZN",
    name: "Amazon",
    address: "0x0000000000000000000000000000000000000007",
    priceFeed: "0x0000000000000000000000000000000000000107",
    category: "large-cap",
    decimals: 18,
  },
  {
    ticker: "TSLA",
    name: "Tesla",
    address: "0x0000000000000000000000000000000000000008",
    priceFeed: "0x0000000000000000000000000000000000000108",
    category: "growth",
    decimals: 18,
  },
  {
    ticker: "SNDK",
    name: "SanDisk",
    address: "0x0000000000000000000000000000000000000009",
    priceFeed: "0x0000000000000000000000000000000000000109",
    category: "growth",
    decimals: 18,
  },
  {
    ticker: "USDG",
    name: "USD Stable Reserve",
    address: "0x0000000000000000000000000000000000000010",
    priceFeed: "0x0000000000000000000000000000000000000110",
    category: "stable",
    decimals: 18,
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

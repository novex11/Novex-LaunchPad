/** Extended catalog for markets UI — maps to TradingView symbols */
export interface MarketStock {
  ticker: string;
  name: string;
  exchange: "NASDAQ" | "NYSE" | "AMEX" | "FX";
  category: string;
  tradable: boolean;
}

export const MARKET_STOCKS: MarketStock[] = [
  { ticker: "NVDA", name: "NVIDIA", exchange: "NASDAQ", category: "Semiconductors", tradable: true },
  { ticker: "AAPL", name: "Apple", exchange: "NASDAQ", category: "Technology", tradable: true },
  { ticker: "MSFT", name: "Microsoft", exchange: "NASDAQ", category: "Technology", tradable: true },
  { ticker: "GOOGL", name: "Alphabet", exchange: "NASDAQ", category: "Technology", tradable: true },
  { ticker: "AMZN", name: "Amazon", exchange: "NASDAQ", category: "Consumer", tradable: true },
  { ticker: "META", name: "Meta Platforms", exchange: "NASDAQ", category: "Technology", tradable: true },
  { ticker: "TSLA", name: "Tesla", exchange: "NASDAQ", category: "Automotive", tradable: true },
  { ticker: "AMD", name: "Advanced Micro Devices", exchange: "NASDAQ", category: "Semiconductors", tradable: true },
  { ticker: "NFLX", name: "Netflix", exchange: "NASDAQ", category: "Media", tradable: true },
  { ticker: "PLTR", name: "Palantir", exchange: "NASDAQ", category: "Software", tradable: true },
  { ticker: "COIN", name: "Coinbase", exchange: "NASDAQ", category: "Fintech", tradable: true },
  { ticker: "INTC", name: "Intel", exchange: "NASDAQ", category: "Semiconductors", tradable: true },
  { ticker: "BABA", name: "Alibaba", exchange: "NYSE", category: "E-commerce", tradable: true },
  { ticker: "SPY", name: "SPDR S&P 500 ETF", exchange: "AMEX", category: "ETF", tradable: true },
  { ticker: "QQQ", name: "Invesco QQQ Trust", exchange: "NASDAQ", category: "ETF", tradable: true },
  { ticker: "SNDK", name: "SanDisk", exchange: "NASDAQ", category: "Storage", tradable: true },
  { ticker: "MU", name: "Micron Technology", exchange: "NASDAQ", category: "Semiconductors", tradable: true },
  { ticker: "ORCL", name: "Oracle", exchange: "NYSE", category: "Software", tradable: true },
  { ticker: "CRM", name: "Salesforce", exchange: "NYSE", category: "Software", tradable: true },
  { ticker: "AVGO", name: "Broadcom", exchange: "NASDAQ", category: "Semiconductors", tradable: true },
];

export const FOREX_PAIRS: MarketStock[] = [
  { ticker: "EURUSD", name: "Euro / US Dollar", exchange: "FX", category: "Major", tradable: false },
  { ticker: "GBPUSD", name: "British Pound / US Dollar", exchange: "FX", category: "Major", tradable: false },
  { ticker: "AUDUSD", name: "Australian Dollar / US Dollar", exchange: "FX", category: "Major", tradable: false },
  { ticker: "NZDUSD", name: "New Zealand Dollar / US Dollar", exchange: "FX", category: "Minor", tradable: false },
  { ticker: "USDCAD", name: "US Dollar / Canadian Dollar", exchange: "FX", category: "Major", tradable: false },
  { ticker: "USDCHF", name: "US Dollar / Swiss Franc", exchange: "FX", category: "Major", tradable: false },
];

/** All tradable assets */
export const ALL_MARKET_ASSETS = [...MARKET_STOCKS, ...FOREX_PAIRS];

/** Shape returned by `/api/quotes` for each ticker */
export interface QuoteData {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  currency: string;
  /** Intraday close series (5-minute bars), oldest → newest */
  sparkline: number[];
  marketState?: string;
}

export const MARKET_CATEGORIES = Array.from(
  new Set(MARKET_STOCKS.map((s) => s.category)),
);

export function tradingViewSymbol(stock: MarketStock): string {
  if (stock.exchange === "FX") return `FX:${stock.ticker}`;
  return `${stock.exchange}:${stock.ticker}`;
}

export function getMarketStock(ticker: string): MarketStock | undefined {
  return ALL_MARKET_ASSETS.find(
    (s) => s.ticker.toUpperCase() === ticker.toUpperCase(),
  );
}

export function isForexPair(ticker: string): boolean {
  return FOREX_PAIRS.some(
    (p) => p.ticker.toUpperCase() === ticker.toUpperCase(),
  );
}

import type { StockToken } from "./tokens.js";

export type TokenCategory = StockToken["category"];

/**
 * Category for tokens the RHJ registry lists but we have no hand-written
 * entry for. ETFs and index funds are "broad-market", mega-caps "large-cap",
 * frontier themes (space, quantum, nuclear, crypto-treasury) "thematic", and
 * everything else "growth". Add a ticker here to move it.
 */
const BROAD_MARKET = new Set([
  "SPY", "QQQ", "VTI", "SCHD", "SPMO", "XLK", "SMH", "SOXX", "INDA", "EWT", "EWY",
  "GLD", "SLV", "USO", "BND", "SHY", "SGOV", "XNDU", "SKHY", "P", "CBRS",
]);

const LARGE_CAP = new Set([
  "AAPL", "MSFT", "GOOGL", "AMZN", "META", "AVGO", "TSM", "ASML", "ORCL", "CSCO",
  "IBM", "INTC", "JNJ", "LLY", "PFE", "UNH", "XOM", "COST", "CRM", "ADBE", "NFLX",
  "QCOM", "AMAT", "LRCX", "KLAC", "INTU", "NOW", "BA", "GE", "LMT", "UPS", "BABA",
  "SHOP", "PANW", "FTNT", "ANET", "DELL", "HPE", "TER", "MU", "WDC", "SNDK", "F",
  "PWR", "HWM", "LHX", "HII", "FISV", "CTSH", "GEV", "CEG", "VST",
]);

const THEMATIC = new Set([
  "SPCX", "RKLB", "ASTS", "LUNR", "RDW", "SATS", "VSAT", "PL", "IONQ", "QBTS", "RGTI",
  "QUBT", "OKLO", "SMR", "NNE", "MSTR", "CLSK", "IREN", "WULF", "GLXY", "CRCL", "BULL",
  "DJT", "GME", "AMC", "JOBY", "ACHR", "AUR", "RIVN", "NBIS", "CRWV", "APLD", "USAR",
  "FLNC", "BE", "SOUN", "BB", "AVAV", "KTOS", "RCAT", "AAOI", "POET", "WYFI", "SLS",
]);

export function categorizeTicker(ticker: string): TokenCategory {
  const t = ticker.toUpperCase();
  if (t === "USDG") return "stable";
  if (t === "WETH") return "crypto";
  if (BROAD_MARKET.has(t)) return "broad-market";
  if (LARGE_CAP.has(t)) return "large-cap";
  if (THEMATIC.has(t)) return "thematic";
  return "growth";
}

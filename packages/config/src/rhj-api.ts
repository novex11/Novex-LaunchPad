import { RHJ_ASSETS_API, RHJ_CORPORATE_ACTIONS_API } from "./chain.js";
import type { StockToken } from "./tokens.js";
import { categorizeTicker } from "./categories.js";

export interface RhjAsset {
  id?: string;
  tokenSymbol: string;
  tokenName: string;
  deployments?: Array<{
    contractAddress: string;
    chainId: number;
    networkName: string;
  }>;
  currentMultiplier?: string;
  status?: string;
  logoUrl?: string;
  tokenDecimals?: number;
  tradingCapabilities?: {
    market?: { whole?: string; fractional?: string };
    extended?: { whole?: string; fractional?: string };
    overnight?: { whole?: string; fractional?: string };
  };
  isin?: string;
}

export interface RhjCorporateAction {
  symbol: string;
  actionType: string;
  effectiveAt: string;
  newMultiplier?: string;
}

export async function fetchRhjAssets(): Promise<RhjAsset[]> {
  const res = await fetch(RHJ_ASSETS_API, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`RHJ assets API error: ${res.status}`);
  }
  const data = (await res.json()) as { assets?: RhjAsset[] } | RhjAsset[];
  if (Array.isArray(data)) return data;
  return data.assets ?? [];
}

export async function fetchRhjCorporateActions(
  symbol?: string,
): Promise<RhjCorporateAction[]> {
  const url = symbol
    ? `${RHJ_CORPORATE_ACTIONS_API}?symbol=${symbol}`
    : RHJ_CORPORATE_ACTIONS_API;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`RHJ corporate actions API error: ${res.status}`);
  }
  const data = (await res.json()) as
    | { actions?: RhjCorporateAction[] }
    | RhjCorporateAction[];
  if (Array.isArray(data)) return data;
  return data.actions ?? [];
}

const NO_FEED = "0x0000000000000000000000000000000000000000" as const;

/** Convert a registry asset into a StockToken (no feed until the launchpad lists it). */
export function rhjAssetToToken(asset: RhjAsset): StockToken | undefined {
  const deploy = asset.deployments?.find((d) => d.chainId === 4663);
  const address = deploy?.contractAddress;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return undefined;
  if (asset.status && asset.status !== "ASSET_STATUS_ACTIVE") return undefined;
  const tc = asset.tradingCapabilities;
  const tradable = (s?: { whole?: string }) => s?.whole === "TRADING_STATUS_TRADABLE";
  return {
    ticker: asset.tokenSymbol.toUpperCase(),
    name: asset.tokenName.replace(/\s*[•·-]\s*Robinhood Token\s*$/i, "").trim(),
    address: address as `0x${string}`,
    priceFeed: NO_FEED,
    category: categorizeTicker(asset.tokenSymbol),
    decimals: asset.tokenDecimals ?? 18,
    tradingHours: { market: tradable(tc?.market), extended: tradable(tc?.extended), overnight: tradable(tc?.overnight) },
    logoUrl: `https://cdn.robinhood.com/ncw_assets/logos/${address.toLowerCase()}.png`,
  };
}

/**
 * Merge live Robinhood RHJ asset data into the token list.
 *
 * Tokens already in `configTokens` are enriched (address, logo, decimals,
 * trading capabilities). Registry assets missing from the list are appended
 * so a stock Robinhood tokenizes tomorrow is usable without a release; the
 * indexer/launchpad then decide whether it is listed on-chain.
 *
 * The RHJ API returns `tokenSymbol` (not `symbol`) and addresses
 * under `deployments[].contractAddress` for chainId 4663.
 */
export function mergeRhjAssetsWithConfig(
  rhjAssets: RhjAsset[],
  configTokens: StockToken[],
): StockToken[] {
  const known = new Set(configTokens.map((t) => t.ticker.toUpperCase()));
  const appended = rhjAssets
    .filter((a) => !known.has((a.tokenSymbol ?? "").toUpperCase()))
    .map(rhjAssetToToken)
    .filter((t): t is StockToken => t !== undefined);
  const enriched = configTokens.map((token) => {
    const rhj = rhjAssets.find(
      (a) =>
        (a.tokenSymbol ?? "").toUpperCase() === token.ticker.toUpperCase(),
    );
    if (!rhj) return token;

    const merged = { ...token };

    // Resolve contract address from deployments (prefer chainId 4663)
    const deploy = rhj.deployments?.find((d) => d.chainId === 4663);
    const contractAddress = deploy?.contractAddress;
    if (contractAddress) {
      merged.address = contractAddress as `0x${string}`;
      merged.logoUrl = `https://cdn.robinhood.com/ncw_assets/logos/${contractAddress.toLowerCase()}.png`;
    } else if (rhj.logoUrl) {
      merged.logoUrl = rhj.logoUrl;
    }

    if (rhj.tokenDecimals != null) {
      merged.decimals = rhj.tokenDecimals;
    }

    if (rhj.tradingCapabilities) {
      const tc = rhj.tradingCapabilities;
      merged.tradingHours = {
        market:
          tc.market?.whole === "TRADING_STATUS_TRADABLE",
        extended:
          tc.extended?.whole === "TRADING_STATUS_TRADABLE",
        overnight:
          tc.overnight?.whole === "TRADING_STATUS_TRADABLE",
      };
    }
    return merged;
  });
  return [...enriched, ...appended];
}

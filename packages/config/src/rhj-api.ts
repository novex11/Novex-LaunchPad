import { RHJ_ASSETS_API, RHJ_CORPORATE_ACTIONS_API } from "./chain.js";
import type { StockToken } from "./tokens.js";

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

/**
 * Merge live Robinhood RHJ asset data into local token config.
 * Updates contract addresses, logo URLs, and trading capabilities
 * so the app stays in sync with the on-chain registry.
 *
 * The RHJ API returns `tokenSymbol` (not `symbol`) and addresses
 * under `deployments[].contractAddress` for chainId 4663.
 */
export function mergeRhjAssetsWithConfig(
  rhjAssets: RhjAsset[],
  configTokens: StockToken[],
): StockToken[] {
  return configTokens.map((token) => {
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
}

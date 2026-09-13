import { RHJ_ASSETS_API, RHJ_CORPORATE_ACTIONS_API } from "./chain.js";
import type { StockToken } from "./tokens.js";

export interface RhjAsset {
  symbol: string;
  name: string;
  contractAddress?: string;
  tradingCapabilities?: {
    marketHours?: boolean;
    extendedHours?: boolean;
    overnight?: boolean;
  };
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

export function mergeRhjAssetsWithConfig(
  rhjAssets: RhjAsset[],
  configTokens: StockToken[],
): StockToken[] {
  return configTokens.map((token) => {
    const rhj = rhjAssets.find(
      (a) => a.symbol.toUpperCase() === token.ticker.toUpperCase(),
    );
    if (rhj?.contractAddress) {
      return { ...token, address: rhj.contractAddress as `0x${string}` };
    }
    return token;
  });
}

import { defineChain, type Chain } from "viem";
import { addRpcUrlOverrideToChain } from "@privy-io/chains";
import { robinhoodChain, robinhoodTestnet } from "@novex/config";

/** Resolve the RPC URL the browser should use (Alchemy when configured). */
export function resolveChainRpcUrl(useTestnet: boolean, serverRpcUrl?: string): string {
  const fromPublic = useTestnet
    ? process.env.NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC_URL
    : process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL;

  // NEXT_PUBLIC_* is the canonical Alchemy URL from .env — prefer over serverRpcUrl.
  if (fromPublic?.startsWith("http")) return fromPublic;
  if (serverRpcUrl?.startsWith("http")) return serverRpcUrl;

  const active = useTestnet ? robinhoodTestnet : robinhoodChain;
  return active.rpcUrls.default.http[0];
}

/** Short label for UI (hides API keys). */
export function rpcDisplayLabel(rpcUrl: string): string {
  try {
    const host = new URL(rpcUrl).hostname;
    if (host.includes("alchemy.com")) return "Alchemy";
    return host;
  } catch {
    return "configured RPC";
  }
}

/** Build viem chain definition with explicit RPC override for Privy/wagmi. */
export function buildRobinhoodChainViem(rpcUrl: string, useTestnet: boolean): Chain {
  const active = useTestnet ? robinhoodTestnet : robinhoodChain;
  const baseChain = defineChain({
    id: active.id,
    name: active.name,
    network: useTestnet ? "robinhood-testnet" : "robinhood-mainnet",
    nativeCurrency: active.nativeCurrency,
    rpcUrls: {
      default: { http: [rpcUrl] },
    },
    blockExplorers: active.blockExplorers,
    testnet: active.testnet,
  });
  return addRpcUrlOverrideToChain(baseChain, rpcUrl);
}

export const defaultUseTestnet =
  process.env.NEXT_PUBLIC_USE_TESTNET === "true";

export const defaultChainRpcUrl = resolveChainRpcUrl(
  defaultUseTestnet,
  undefined,
);

export const robinhoodChainViem = buildRobinhoodChainViem(
  defaultChainRpcUrl,
  defaultUseTestnet,
);

export const activeChainId = robinhoodChainViem.id;
export const isTestnetMode = defaultUseTestnet;
export const chainRpcUrl = defaultChainRpcUrl;

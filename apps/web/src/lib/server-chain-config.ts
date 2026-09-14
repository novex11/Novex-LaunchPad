import { resolveChainRpcUrl } from "@/lib/chain-config";
import { resolveExplorerBaseUrl } from "@/lib/explorer";

/**
 * Read chain RPC + explorer from server env at request time (Docker runtime).
 * Prefer NEXT_PUBLIC_* because shell exports can override ROBINHOOD_*.
 */
export function getServerChainConfig() {
  const useTestnet = process.env.NEXT_PUBLIC_USE_TESTNET === "true";

  const rpcCandidates = useTestnet
    ? [
        process.env.NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC_URL,
        process.env.ROBINHOOD_TESTNET_RPC_URL,
      ]
    : [
        process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL,
        process.env.ROBINHOOD_RPC_URL,
      ];

  const rpcUrl =
    rpcCandidates.find((url) => url?.startsWith("http")) ??
    resolveChainRpcUrl(useTestnet);

  const explorerBaseUrl = resolveExplorerBaseUrl(
    useTestnet,
    process.env.NEXT_PUBLIC_EXPLORER_URL,
  );

  return { rpcUrl, useTestnet, explorerBaseUrl };
}

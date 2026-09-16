import { robinhoodChain, robinhoodTestnet } from "@compose/config";

const TESTNET_EXPLORER = "https://explorer.testnet.chain.robinhood.com";
const MAINNET_EXPLORER = "https://explorer.robinhood.com";

/** Runtime base URL set from server env on each page load (Docker-safe). */
let runtimeExplorerBase: string | null = null;

export function configureExplorerBase(url: string): void {
  runtimeExplorerBase = url.replace(/\/$/, "");
}

/** Resolve Robinhood Chain explorer base URL. */
export function resolveExplorerBaseUrl(
  useTestnet: boolean,
  serverOverride?: string,
): string {
  if (serverOverride?.startsWith("http")) {
    return serverOverride.replace(/\/$/, "");
  }

  const fromPublic =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_EXPLORER_URL
      : undefined;
  if (fromPublic?.startsWith("http")) {
    return fromPublic.replace(/\/$/, "");
  }

  const active = useTestnet ? robinhoodTestnet : robinhoodChain;
  return active.blockExplorers.default.url.replace(/\/$/, "");
}

export function getExplorerBaseUrl(useTestnet = true): string {
  if (runtimeExplorerBase) return runtimeExplorerBase;
  return useTestnet ? TESTNET_EXPLORER : MAINNET_EXPLORER;
}

/** Build a Blockscout link for an address, token or transaction hash. */
export function explorerUrl(
  kind: "address" | "tx" | "token",
  value: string,
  useTestnet = true,
): string {
  const base = getExplorerBaseUrl(useTestnet);
  return `${base}/${kind}/${value}`;
}

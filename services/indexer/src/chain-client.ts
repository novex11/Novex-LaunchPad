import { createPublicClient, http, type PublicClient } from "viem";
import {
  isHexAddress,
  isTestnetMode,
  robinhoodChain,
  robinhoodTestnet,
  testnetDeployment,
} from "@novex/config";

export const USE_TESTNET = isTestnetMode();

export function chainRpcUrl(): string | undefined {
  return USE_TESTNET
    ? process.env.ROBINHOOD_TESTNET_RPC_URL || testnetDeployment().rpcUrl
    : process.env.ROBINHOOD_RPC_URL || undefined;
}

let client: PublicClient | null | undefined;

/** Shared read client for the active Robinhood Chain network. */
export function getPublicClient(): PublicClient | null {
  if (client !== undefined) return client;
  const url = chainRpcUrl();
  if (!url) {
    client = null;
    return null;
  }
  const chain = USE_TESTNET ? robinhoodTestnet : robinhoodChain;
  client = createPublicClient({
    chain: {
      id: chain.id,
      name: chain.name,
      nativeCurrency: chain.nativeCurrency,
      rpcUrls: { default: { http: [url] } },
    },
    transport: http(url),
  }) as PublicClient;
  return client;
}

/** On testnet the synced deployment file is authoritative; env configures mainnet. */
export function pairFactoryAddress(): `0x${string}` | undefined {
  const value = USE_TESTNET
    ? testnetDeployment().contracts.pairFactory
    : (process.env.PAIR_FACTORY_ADDRESS ?? process.env.NEXT_PUBLIC_PAIR_FACTORY_ADDRESS);
  return isHexAddress(value) ? value : undefined;
}

export function oracleAddress(): `0x${string}` | undefined {
  const value = USE_TESTNET
    ? testnetDeployment().contracts.oracle
    : (process.env.ORACLE_ADAPTER_ADDRESS ?? process.env.NEXT_PUBLIC_ORACLE_ADAPTER_ADDRESS);
  return isHexAddress(value) ? value : undefined;
}

/** Blockscout (Etherscan-compatible) API base for source verification. */
export function explorerApiUrl(): string {
  const base =
    process.env.EXPLORER_API_URL ||
    `${(USE_TESTNET ? robinhoodTestnet : robinhoodChain).blockExplorers.default.url}/api`;
  return base.replace(/\/$/, "");
}

/** Submit source verification for newly launched pairs (default on). */
export const AUTO_VERIFY_CONTRACTS = process.env.AUTO_VERIFY_CONTRACTS !== "false";

/** First block to index launchpad events from (the factory deployment block). */
export function launchpadStartBlock(): bigint {
  const raw =
    process.env.INDEXER_START_BLOCK ||
    (USE_TESTNET ? String(testnetDeployment().startBlock ?? 0) : "0");
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

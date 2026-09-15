import { parseAbi } from "viem";
import {
  getTokenByAddress,
  isHexAddress,
  receiptTokenName,
  type StrategyId,
} from "@novex/config";
import { USE_TESTNET, getPublicClient } from "./chain-client.js";

/*
 * Resolves the set of managed-basket vaults the indexer should track.
 * Production deploys one StrategyVault per deposit asset × strategy through the
 * VaultFactory; `VAULT_FACTORY_ADDRESS` enumerates them all. The legacy
 * `VAULT_CONTRACT_ADDRESS` single-vault mode is kept as a fallback.
 */

export interface BasketVault {
  address: `0x${string}`;
  receiptToken: `0x${string}`;
  depositAsset: `0x${string}`;
  depositTicker: string;
  strategy: StrategyId;
  /** Ledger id, e.g. tNVDA-B — matches the receipt symbol. */
  vaultId: string;
}

const STRATEGY_FROM_CHAIN: Record<number, StrategyId> = {
  0: "defensive",
  1: "balanced",
  2: "aggressive",
};

const factoryAbi = parseAbi([
  "function vaultCount() view returns (uint256)",
  "function vaults(uint256) view returns (address vault, address receiptToken, address depositAsset, uint8 strategy)",
]);

const vaultAbi = parseAbi([
  "function depositAsset() view returns (address)",
  "function receiptToken() view returns (address)",
  "function strategy() view returns (uint8)",
]);

export function vaultFactoryAddress(): `0x${string}` | undefined {
  if (USE_TESTNET) return undefined; // baskets are mainnet-only
  const value = process.env.VAULT_FACTORY_ADDRESS ?? process.env.NEXT_PUBLIC_FACTORY_ADDRESS;
  return isHexAddress(value) ? value : undefined;
}

function legacyVaultAddress(): `0x${string}` | undefined {
  if (USE_TESTNET) return undefined;
  const value = process.env.VAULT_CONTRACT_ADDRESS ?? process.env.NEXT_PUBLIC_VAULT_ADDRESS;
  return isHexAddress(value) ? value : undefined;
}

function describe(
  address: `0x${string}`,
  receiptToken: `0x${string}`,
  depositAsset: `0x${string}`,
  strategyEnum: number,
): BasketVault {
  const token = getTokenByAddress(depositAsset);
  const depositTicker = token?.ticker ?? depositAsset.slice(0, 8);
  const strategy = STRATEGY_FROM_CHAIN[strategyEnum] ?? "balanced";
  return {
    address,
    receiptToken,
    depositAsset,
    depositTicker,
    strategy,
    vaultId: receiptTokenName(depositTicker, strategy),
  };
}

let cache: { at: number; vaults: BasketVault[] } | null = null;
const CACHE_MS = 5 * 60_000;

/** Every basket vault on the active network (cached for 5 minutes). */
export async function listBasketVaults(force = false): Promise<BasketVault[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.vaults;
  const client = getPublicClient();
  if (!client) return [];

  const vaults: BasketVault[] = [];
  const factory = vaultFactoryAddress();
  if (factory) {
    const count = await client.readContract({ address: factory, abi: factoryAbi, functionName: "vaultCount" });
    for (let i = 0n; i < count; i++) {
      const [vault, receipt, depositAsset, strategyEnum] = await client.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: "vaults",
        args: [i],
      });
      vaults.push(describe(vault, receipt, depositAsset, Number(strategyEnum)));
    }
  } else {
    const legacy = legacyVaultAddress();
    if (legacy) {
      const [depositAsset, receipt, strategyEnum] = await Promise.all([
        client.readContract({ address: legacy, abi: vaultAbi, functionName: "depositAsset" }),
        client.readContract({ address: legacy, abi: vaultAbi, functionName: "receiptToken" }),
        client.readContract({ address: legacy, abi: vaultAbi, functionName: "strategy" }),
      ]);
      vaults.push(describe(legacy, receipt, depositAsset, Number(strategyEnum)));
    }
  }

  cache = { at: Date.now(), vaults };
  return vaults;
}

/** Whether any basket vault is configured for this network. */
export function basketVaultsConfigured(): boolean {
  return Boolean(vaultFactoryAddress() ?? legacyVaultAddress());
}

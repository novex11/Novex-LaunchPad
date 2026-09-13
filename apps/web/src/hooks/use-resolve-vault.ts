"use client";

import { useReadContract } from "wagmi";
import { getTokenByTicker, type StrategyId } from "@novex/config";
import {
  FACTORY_ADDRESS,
  VAULT_ADDRESS,
  RECEIPT_TOKEN_ADDRESS,
  factoryReady,
  contractsReady,
  vaultFactoryAbi,
  strategyVaultAbi,
} from "@/lib/contracts";
import { computeVaultKey } from "@/lib/vault-registry";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

/** Resolve vault + receipt token for a deposit ticker + strategy via factory. */
export function useResolveVault(depositTicker: string, strategy: StrategyId) {
  const token = getTokenByTicker(depositTicker);
  const depositAsset = token?.address as `0x${string}` | undefined;
  const vaultKey = depositAsset
    ? computeVaultKey(depositAsset, strategy)
    : undefined;

  const { data: vaultFromFactory, isLoading: loadingKey } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: vaultFactoryAbi as readonly unknown[],
    functionName: "vaultByKey",
    args: vaultKey ? [vaultKey] : undefined,
    query: { enabled: factoryReady && !!vaultKey },
  });

  const factoryVault =
    vaultFromFactory &&
    (vaultFromFactory as string).toLowerCase() !== ZERO
      ? (vaultFromFactory as `0x${string}`)
      : undefined;

  const { data: receiptFromVault } = useReadContract({
    address: factoryVault,
    abi: strategyVaultAbi as readonly unknown[],
    functionName: "receiptToken",
    query: { enabled: !!factoryVault },
  });

  const legacyMatch =
    contractsReady &&
    !factoryVault &&
    strategy === "balanced" &&
    depositTicker.toUpperCase() === "NVDA";

  const vaultAddress = factoryVault ?? (legacyMatch ? VAULT_ADDRESS : undefined);
  const receiptTokenAddress =
    (receiptFromVault as `0x${string}` | undefined) ??
    (legacyMatch ? RECEIPT_TOKEN_ADDRESS : undefined);

  return {
    vaultAddress,
    receiptTokenAddress,
    depositAsset,
    ready: Boolean(vaultAddress && receiptTokenAddress && depositAsset),
    isLoading: factoryReady && loadingKey,
  };
}

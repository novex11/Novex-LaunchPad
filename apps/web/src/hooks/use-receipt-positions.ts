"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient, useReadContract } from "wagmi";
import {
  getTokenByAddress,
  type StrategyId,
} from "@compose/config";
import {
  FACTORY_ADDRESS,
  VAULT_ADDRESS,
  RECEIPT_TOKEN_ADDRESS,
  factoryReady,
  contractsReady,
  vaultFactoryAbi,
  strategyVaultAbi,
  receiptTokenAbi,
} from "@/lib/contracts";
import { STRATEGY_FROM_CHAIN } from "@/lib/vault-registry";

/**
 * StrategyVault mints `depositValue8 * 1e18 / sharePrice` shares with an initial
 * share price of 1e18, so one whole share is 1e8 base units (= $1 at launch).
 */
export const RECEIPT_SHARE_DECIMALS = 8;

export interface OnChainReceiptPosition {
  vaultAddress: `0x${string}`;
  receiptTokenAddress: `0x${string}`;
  receiptSymbol: string;
  depositTicker: string;
  strategy: StrategyId;
  receiptBalance: bigint;
  sharePrice: bigint;
  /** Position value in 8-decimal USD, exactly as the vault computes it */
  valueUsd8: bigint;
  /** USD value from on-chain balance × sharePrice */
  valueUsd: number;
  /** Share price in USD (8-decimal oracle scale normalized) */
  sharePriceUsd: number;
  onChainVerified: true;
}

async function readPosition(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  userAddress: `0x${string}`,
  vault: `0x${string}`,
  receipt: `0x${string}`,
  depositAsset: `0x${string}`,
  strategyEnum: number,
): Promise<OnChainReceiptPosition | null> {
  const balance = (await publicClient.readContract({
    address: receipt,
    abi: receiptTokenAbi as readonly unknown[],
    functionName: "balanceOf",
    args: [userAddress],
  })) as bigint;

  if (balance === 0n) return null;

  const [sharePrice, symbol] = await Promise.all([
    publicClient.readContract({
      address: vault,
      abi: strategyVaultAbi as readonly unknown[],
      functionName: "sharePrice",
    }) as Promise<bigint>,
    publicClient.readContract({
      address: receipt,
      abi: receiptTokenAbi as readonly unknown[],
      functionName: "symbol",
    }) as Promise<string>,
  ]);

  const token = getTokenByAddress(depositAsset);
  const strategy = STRATEGY_FROM_CHAIN[strategyEnum] ?? "balanced";
  const valueUsd8 = (balance * sharePrice) / BigInt(1e18);
  const valueUsd = Number(valueUsd8) / 1e8;
  const sharePriceUsd = Number(sharePrice) / 1e18;

  return {
    vaultAddress: vault,
    receiptTokenAddress: receipt,
    receiptSymbol: symbol,
    depositTicker: token?.ticker ?? depositAsset.slice(0, 8),
    strategy,
    receiptBalance: balance,
    sharePrice,
    valueUsd8,
    valueUsd,
    sharePriceUsd,
    onChainVerified: true,
  };
}

/** All on-chain receipt positions for a wallet (factory vaults + legacy fallback). */
export function useReceiptPositions(userAddress: `0x${string}` | undefined) {
  const publicClient = usePublicClient();

  const { data: vaultCount } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: vaultFactoryAbi as readonly unknown[],
    functionName: "vaultCount",
    query: { enabled: factoryReady },
  });

  const vaultCountBig = vaultCount as bigint | undefined;

  return useQuery({
    queryKey: [
      "receipt-positions",
      userAddress,
      factoryReady ? vaultCountBig?.toString() : "legacy",
    ],
    enabled: Boolean(userAddress && publicClient && (factoryReady || contractsReady)),
    queryFn: async (): Promise<OnChainReceiptPosition[]> => {
      if (!userAddress || !publicClient) return [];

      const positions: OnChainReceiptPosition[] = [];

      if (factoryReady && vaultCountBig && vaultCountBig > 0n) {
        for (let i = 0n; i < vaultCountBig; i++) {
          const info = (await publicClient.readContract({
            address: FACTORY_ADDRESS,
            abi: vaultFactoryAbi as readonly unknown[],
            functionName: "vaults",
            args: [i],
          })) as readonly [`0x${string}`, `0x${string}`, `0x${string}`, number];

          const [vault, receipt, depositAsset, strategyEnum] = info;
          const pos = await readPosition(
            publicClient,
            userAddress,
            vault,
            receipt,
            depositAsset,
            strategyEnum,
          );
          if (pos) positions.push(pos);
        }
        return positions;
      }

      if (contractsReady) {
        const depositAsset = (await publicClient.readContract({
          address: VAULT_ADDRESS,
          abi: strategyVaultAbi as readonly unknown[],
          functionName: "depositAsset",
        })) as `0x${string}`;

        const pos = await readPosition(
          publicClient,
          userAddress,
          VAULT_ADDRESS,
          RECEIPT_TOKEN_ADDRESS,
          depositAsset,
          1,
        );
        if (pos) positions.push(pos);
      }

      return positions;
    },
    refetchInterval: 30_000,
  });
}

"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePublicClient, useReadContract } from "wagmi";
import type { Hash } from "viem";
import { getTokenByAddress, type StrategyId } from "@compose/config";
import {
  FACTORY_ADDRESS,
  cashbackReserveAbi,
  factoryReady,
  strategyVaultAbi,
  vaultFactoryAbi,
} from "@/lib/contracts";
import { useContractTx } from "@/lib/tx";
import { STRATEGY_FROM_CHAIN } from "@/lib/vault-registry";

interface ChainGrant {
  token: `0x${string}`;
  unlockAt: bigint;
  amount: bigint;
  rewardUsd8: bigint;
  shares: bigint;
}

export interface VaultStockback {
  vaultAddress: `0x${string}`;
  depositTicker: string;
  strategy: StrategyId;
  /** Vested and claimable now. */
  claimableUsd: number;
  claimableAmount: bigint;
  /** Still vesting; forfeited if the vault's shares are redeemed first. */
  pendingUsd: number;
  pendingAmount: bigint;
  /** Unix seconds of the earliest vesting grant, if any. */
  nextUnlockAt: number | undefined;
}

export interface StockbackState {
  reserve: `0x${string}` | undefined;
  vaults: VaultStockback[];
  claimableUsd: number;
  pendingUsd: number;
}

const EMPTY: StockbackState = { reserve: undefined, vaults: [], claimableUsd: 0, pendingUsd: 0 };

/**
 * Stockback grants for a wallet across every factory vault, read straight from the
 * CashbackReserve. Vaults whose reserve predates vesting (no `grantsOf`) are skipped.
 */
export function useStockback(userAddress: `0x${string}` | undefined) {
  const publicClient = usePublicClient();

  const { data: vaultCount } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: vaultFactoryAbi as readonly unknown[],
    functionName: "vaultCount",
    query: { enabled: factoryReady },
  });
  const vaultCountBig = vaultCount as bigint | undefined;

  return useQuery({
    queryKey: ["stockback", userAddress, vaultCountBig?.toString()],
    enabled: Boolean(userAddress && publicClient && factoryReady && vaultCountBig),
    refetchInterval: 60_000,
    queryFn: async (): Promise<StockbackState> => {
      if (!userAddress || !publicClient || !vaultCountBig) return EMPTY;
      const now = Math.floor(Date.now() / 1000);
      const vaults: VaultStockback[] = [];
      let reserve: `0x${string}` | undefined;

      for (let i = 0n; i < vaultCountBig; i++) {
        const [vault, , depositAsset, strategyEnum] = (await publicClient.readContract({
          address: FACTORY_ADDRESS,
          abi: vaultFactoryAbi as readonly unknown[],
          functionName: "vaults",
          args: [i],
        })) as readonly [`0x${string}`, `0x${string}`, `0x${string}`, number];

        // Every vault of one factory shares its reserve.
        reserve ??= (await publicClient.readContract({
          address: vault,
          abi: strategyVaultAbi as readonly unknown[],
          functionName: "cashbackReserve",
        })) as `0x${string}`;

        let grants: readonly ChainGrant[];
        try {
          grants = (await publicClient.readContract({
            address: reserve,
            abi: cashbackReserveAbi as readonly unknown[],
            functionName: "grantsOf",
            args: [vault, userAddress],
          })) as readonly ChainGrant[];
        } catch {
          return EMPTY;
        }
        if (grants.length === 0) continue;

        const row: VaultStockback = {
          vaultAddress: vault,
          depositTicker: getTokenByAddress(depositAsset)?.ticker ?? depositAsset.slice(0, 8),
          strategy: STRATEGY_FROM_CHAIN[strategyEnum] ?? "balanced",
          claimableUsd: 0,
          claimableAmount: 0n,
          pendingUsd: 0,
          pendingAmount: 0n,
          nextUnlockAt: undefined,
        };
        for (const g of grants) {
          const unlockAt = Number(g.unlockAt);
          const usd = Number(g.rewardUsd8) / 1e8;
          if (unlockAt <= now) {
            row.claimableUsd += usd;
            row.claimableAmount += g.amount;
          } else {
            row.pendingUsd += usd;
            row.pendingAmount += g.amount;
            row.nextUnlockAt = row.nextUnlockAt == null ? unlockAt : Math.min(row.nextUnlockAt, unlockAt);
          }
        }
        vaults.push(row);
      }

      return {
        reserve,
        vaults,
        claimableUsd: vaults.reduce((s, v) => s + v.claimableUsd, 0),
        pendingUsd: vaults.reduce((s, v) => s + v.pendingUsd, 0),
      };
    },
  });
}

/** Claims every vested grant for the wallet in one transaction (`claimMany`). */
export function useClaimStockback() {
  const { send, ensureReady } = useContractTx();
  const qc = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async (state: StockbackState): Promise<Hash> => {
      const vaults = state.vaults.filter((v) => v.claimableAmount > 0n).map((v) => v.vaultAddress);
      if (!state.reserve || vaults.length === 0) throw new Error("No vested Stockback to claim yet.");
      setIsPending(true);
      setError(null);
      try {
        const account = await ensureReady();
        const { hash } = await send({
          address: state.reserve,
          abi: cashbackReserveAbi,
          functionName: "claimMany",
          args: [vaults, account],
        });
        qc.invalidateQueries({ queryKey: ["stockback"] });
        qc.invalidateQueries({ queryKey: ["activity"] });
        return hash;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [send, ensureReady, qc],
  );

  return { execute, isPending, error };
}

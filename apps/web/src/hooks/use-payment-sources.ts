"use client";

import { useMemo } from "react";
import { formatUnits, zeroAddress } from "viem";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import {
  erc20Abi,
  oracleAdapterAbi,
  USDG_ADDRESS,
  WRHT_ADDRESS,
  launchpadZapReady,
} from "@/lib/contracts";
import {
  PAYMENT_SOURCE_META,
  PAYMENT_SOURCE_PRIORITY,
  type PaymentSourceKind,
} from "@novex/config";

const ORACLE_ADDRESS = (process.env.NEXT_PUBLIC_ORACLE_ADAPTER_ADDRESS ??
  zeroAddress) as `0x${string}`;

const ORACLE_READY = ORACLE_ADDRESS !== zeroAddress;

export type PaymentSource = {
  kind: PaymentSourceKind;
  /** Token contract address; `zeroAddress` for native RHT */
  address: `0x${string}`;
  symbol: string;
  /** Full display name (e.g. "Tesla") */
  label: string;
  /** UI hint copy */
  hint: string;
  /** Badge chip copy */
  badge: string;
  /** User's balance in wei */
  balance: bigint;
  /** Balance in raw display units (18-dec assumed for local mocks) */
  balanceDisplay: number;
  /** USD price per token, 1e8 scaled from oracle (0 if unknown) */
  priceUsd8: bigint;
  /** Approximate USD value of the balance */
  balanceUsd: number;
  /** True if the user actually has enough (>0) to pay */
  hasBalance: boolean;
  /** True if we can source from this option right now */
  usable: boolean;
};

export interface UsePaymentSourcesResult {
  sources: PaymentSource[];
  best: PaymentSource | null;
  isLoading: boolean;
  /** True when the Zap contract isn't deployed; only USDG works. */
  zapMissing: boolean;
}

/**
 * Detects the four payment sources a user might seed a pair with:
 *   - USDG (direct pass-through)
 *   - tokenA (pair leg A)
 *   - tokenB (pair leg B)
 *   - Native RHT (auto-wraps to WRHT)
 *
 * Returns them ranked with `best` as the recommended source based on
 * priority + balance sufficiency for the requested USD target.
 */
export function usePaymentSources({
  tokenA,
  tokenB,
  tokenASymbol,
  tokenALabel,
  tokenBSymbol,
  tokenBLabel,
  usdTarget,
}: {
  tokenA: `0x${string}` | undefined;
  tokenB: `0x${string}` | undefined;
  tokenASymbol?: string;
  tokenALabel?: string;
  tokenBSymbol?: string;
  tokenBLabel?: string;
  /** How much USD the user is trying to seed with (used for ranking) */
  usdTarget?: number;
}): UsePaymentSourcesResult {
  const { address: account } = useAccount();

  // Native balance (RHT)
  const native = useBalance({
    address: account,
    query: { enabled: !!account },
  });

  // Balances + prices via multicall
  const contracts = useMemo(() => {
    if (!account) return [];
    const list: {
      address: `0x${string}`;
      abi: readonly unknown[];
      functionName: string;
      args: readonly unknown[];
    }[] = [];
    // USDG balance
    if (USDG_ADDRESS !== zeroAddress) {
      list.push({
        address: USDG_ADDRESS,
        abi: erc20Abi as readonly unknown[],
        functionName: "balanceOf",
        args: [account],
      });
    }
    // tokenA balance
    if (tokenA && tokenA !== zeroAddress) {
      list.push({
        address: tokenA,
        abi: erc20Abi as readonly unknown[],
        functionName: "balanceOf",
        args: [account],
      });
    }
    // tokenB balance
    if (tokenB && tokenB !== zeroAddress) {
      list.push({
        address: tokenB,
        abi: erc20Abi as readonly unknown[],
        functionName: "balanceOf",
        args: [account],
      });
    }
    // Oracle prices (USDG, tokenA, tokenB, WRHT)
    if (ORACLE_READY) {
      if (USDG_ADDRESS !== zeroAddress) {
        list.push({
          address: ORACLE_ADDRESS,
          abi: oracleAdapterAbi as readonly unknown[],
          functionName: "getPrice",
          args: [USDG_ADDRESS],
        });
      }
      if (tokenA && tokenA !== zeroAddress) {
        list.push({
          address: ORACLE_ADDRESS,
          abi: oracleAdapterAbi as readonly unknown[],
          functionName: "getPrice",
          args: [tokenA],
        });
      }
      if (tokenB && tokenB !== zeroAddress) {
        list.push({
          address: ORACLE_ADDRESS,
          abi: oracleAdapterAbi as readonly unknown[],
          functionName: "getPrice",
          args: [tokenB],
        });
      }
      if (WRHT_ADDRESS !== zeroAddress) {
        list.push({
          address: ORACLE_ADDRESS,
          abi: oracleAdapterAbi as readonly unknown[],
          functionName: "getPrice",
          args: [WRHT_ADDRESS],
        });
      }
    }
    return list;
  }, [account, tokenA, tokenB]);

  const multi = useReadContracts({
    // Wagmi's strong types can't infer this composed multicall, so we
    // erase the tuple and read results defensively below.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contracts: contracts as any,
    query: { enabled: contracts.length > 0 && !!account },
  });

  const results = multi.data as
    | ReadonlyArray<{ status: "success" | "failure"; result?: unknown }>
    | undefined;

  const sources = useMemo<PaymentSource[]>(() => {
    if (!account) return [];

    // Rebuild an index into the multicall results in the same order we pushed.
    let cursor = 0;
    const next = () => {
      const item = results?.[cursor++];
      if (!item) return 0n;
      if (item.status === "success" && typeof item.result === "bigint") {
        return item.result;
      }
      return 0n;
    };

    const balUsdg = USDG_ADDRESS !== zeroAddress ? next() : 0n;
    const balA = tokenA && tokenA !== zeroAddress ? next() : 0n;
    const balB = tokenB && tokenB !== zeroAddress ? next() : 0n;
    const priceUsdg = ORACLE_READY && USDG_ADDRESS !== zeroAddress ? next() : 0n;
    const priceA = ORACLE_READY && tokenA && tokenA !== zeroAddress ? next() : 0n;
    const priceB = ORACLE_READY && tokenB && tokenB !== zeroAddress ? next() : 0n;
    const priceRht = ORACLE_READY && WRHT_ADDRESS !== zeroAddress ? next() : 0n;

    const balNative = native.data?.value ?? 0n;

    const usdTargetSafe = usdTarget ?? 0;

    function build(
      kind: PaymentSourceKind,
      address: `0x${string}`,
      symbol: string,
      label: string,
      balance: bigint,
      priceUsd8: bigint,
    ): PaymentSource {
      const balanceDisplay = Number(formatUnits(balance, 18));
      const balanceUsd = priceUsd8 > 0n ? balanceDisplay * (Number(priceUsd8) / 1e8) : 0;
      const hasBalance = balance > 0n;
      const priorityAllowsNonUsdg = kind === "usdg" || launchpadZapReady;
      const meetsTarget = usdTargetSafe > 0 ? balanceUsd >= usdTargetSafe : hasBalance;
      const usable = hasBalance && priorityAllowsNonUsdg && meetsTarget;
      const meta = PAYMENT_SOURCE_META[kind];
      return {
        kind,
        address,
        symbol,
        label,
        hint: meta.hint,
        badge: meta.badge,
        balance,
        balanceDisplay,
        priceUsd8,
        balanceUsd,
        hasBalance,
        usable,
      };
    }

    const list: PaymentSource[] = [];
    list.push(
      build("usdg", USDG_ADDRESS, "USDG", "USD Stable Reserve", balUsdg, priceUsdg || 100000000n),
    );
    if (tokenA && tokenA !== zeroAddress) {
      list.push(
        build(
          "tokenA",
          tokenA,
          tokenASymbol ?? "TKA",
          tokenALabel ?? tokenASymbol ?? "Pair leg A",
          balA,
          priceA,
        ),
      );
    }
    if (tokenB && tokenB !== zeroAddress) {
      list.push(
        build(
          "tokenB",
          tokenB,
          tokenBSymbol ?? "TKB",
          tokenBLabel ?? tokenBSymbol ?? "Pair leg B",
          balB,
          priceB,
        ),
      );
    }
    list.push(
      build(
        "native",
        zeroAddress,
        "ETH",
        "ETH on Robinhood Chain",
        balNative,
        priceRht,
      ),
    );

    // Sort: usable first, then by PAYMENT_SOURCE_PRIORITY within groups.
    list.sort((a, b) => {
      if (a.usable && !b.usable) return -1;
      if (b.usable && !a.usable) return 1;
      return (
        PAYMENT_SOURCE_PRIORITY.indexOf(a.kind) -
        PAYMENT_SOURCE_PRIORITY.indexOf(b.kind)
      );
    });
    return list;
  }, [
    account,
    native.data?.value,
    results,
    tokenA,
    tokenB,
    tokenASymbol,
    tokenALabel,
    tokenBSymbol,
    tokenBLabel,
    usdTarget,
  ]);

  const best = sources.find((s) => s.usable) ?? sources[0] ?? null;

  return {
    sources,
    best,
    isLoading: multi.isLoading || native.isLoading,
    zapMissing: !launchpadZapReady,
  };
}

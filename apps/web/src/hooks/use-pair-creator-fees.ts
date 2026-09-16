"use client";

import { useCallback } from "react";
import { formatUnits, type Address } from "viem";
import { composeCurveReady, ponsLauncherReady } from "@/lib/contracts";
import { useCurveOnchain, usePairCurveToken, type CurveOnchainState } from "@/hooks/use-curve-token";
import {
  usePonsCreatorFees,
  usePonsLaunchInfo,
  usePonsOnchain,
  type PonsCreatorFeeState,
  type PonsOnchainState,
} from "@/hooks/use-pons-token";

export type PairCreatorFees =
  | { venue: "loading" }
  | { venue: "none" }
  | { venue: "pons"; token: Address; pons: PonsOnchainState; fees?: PonsCreatorFeeState; usd?: number }
  | { venue: "compose"; token: Address; curve: CurveOnchainState; usd?: number };

/**
 * Where a pair creator actually earns: the trading fees of the pair's token,
 * on Pons or on the Compose curve. Pair vault deposits are creator-only, so
 * the vault's own deposit fee is never charged and is not counted here.
 * `usd` is what the creator can still sweep or claim.
 */
export function usePairCreatorFees(i: {
  pair?: Address;
  tokenA?: Address;
  tokenB?: Address;
  sharePriceUsd?: number;
}): { data: PairCreatorFees; refetch: () => Promise<unknown> } {
  const compose = usePairCurveToken(i.pair);
  const composeToken = composeCurveReady ? compose.token : null;
  const ponsInfo = usePonsLaunchInfo({ pair: i.pair, tokenA: i.tokenA, tokenB: i.tokenB });
  const ponsToken = ponsLauncherReady ? ponsInfo.launchedToken : null;
  const pons = usePonsOnchain(ponsToken ?? undefined);
  const ponsFees = usePonsCreatorFees({
    curve: pons.data?.curve,
    quoteToken: pons.data?.quoteToken,
    creator: pons.data?.creator,
  });
  const curve = useCurveOnchain(composeToken ?? undefined);

  const refetch = useCallback(
    () => Promise.all([pons.refetch(), ponsFees.refetch(), curve.refetch(), compose.refetch(), ponsInfo.refetch()]),
    [pons, ponsFees, curve, compose, ponsInfo],
  );

  let data: PairCreatorFees;
  if (composeToken && curve.data) {
    const usd =
      i.sharePriceUsd != null ? Number(formatUnits(curve.data.creatorFees, 18)) * i.sharePriceUsd : undefined;
    data = { venue: "compose", token: composeToken, curve: curve.data, usd };
  } else if (ponsToken && pons.data) {
    const p = pons.data;
    // USD per quote unit, read off the router's USD and quote prices per token.
    const quoteUsd =
      p.priceInQuote > 0n
        ? Number(p.priceUsd8) / 1e8 / Number(formatUnits(p.priceInQuote, p.quoteDecimals))
        : undefined;
    const owed = ponsFees.data ? ponsFees.data.sweepable + ponsFees.data.claimable : undefined;
    const usd =
      owed !== undefined && quoteUsd != null ? Number(formatUnits(owed, p.quoteDecimals)) * quoteUsd : undefined;
    data = { venue: "pons", token: ponsToken, pons: p, fees: ponsFees.data, usd };
  } else if (composeToken !== null || ponsToken !== null) {
    // Still resolving which token the pair has, or its market state.
    data = { venue: "loading" };
  } else {
    data = { venue: "none" };
  }
  return { data, refetch };
}

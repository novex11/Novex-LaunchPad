import { EventEmitter } from "node:events";
import type { Db } from "./db.js";
import * as launchpadStore from "./launchpad-store.js";

/** One NAV / share-price observation, pushed to live pair pages over SSE. */
export interface PairLiveSnapshot {
  pairAddress: string;
  navUsd: number;
  sharePrice: number;
  totalShares: string;
  timestamp: string;
  /** "trade" = written right after a buy/sell; "tick" = periodic price sample */
  reason: "trade" | "tick";
}

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function subscribePairSnapshots(
  pairAddress: string,
  listener: (snapshot: PairLiveSnapshot) => void,
): () => void {
  const key = pairAddress.toLowerCase();
  bus.on(key, listener);
  return () => bus.off(key, listener);
}

/** Persist a pair snapshot and push it to every open stream for that pair. */
export async function recordAndPublishSnapshot(
  db: Db,
  input: launchpadStore.PairSnapshotInput & { reason: PairLiveSnapshot["reason"] },
): Promise<PairLiveSnapshot> {
  const createdAt = input.createdAt ?? new Date();
  await launchpadStore.recordPairSnapshot(db, { ...input, createdAt });
  const snapshot: PairLiveSnapshot = {
    pairAddress: input.pairAddress.toLowerCase(),
    navUsd: input.navUsd,
    sharePrice: input.sharePrice,
    totalShares: input.totalShares,
    timestamp: createdAt.toISOString(),
    reason: input.reason,
  };
  bus.emit(snapshot.pairAddress, snapshot);
  return snapshot;
}

/** A creator-token trade, pushed to live token pages. */
export interface TokenLiveTrade {
  tokenAddress: string;
  trader: string;
  isBuy: boolean;
  shares: string;
  tokens: string;
  priceUsd: number;
  marketCapUsd: number;
  valueUsd: number;
  txHash: string;
  timestamp: string;
}

const tokenKey = (token: string) => `token:${token.toLowerCase()}`;

export function publishTokenTrade(trade: TokenLiveTrade) {
  bus.emit(tokenKey(trade.tokenAddress), trade);
}

export function subscribeTokenTrades(token: string, listener: (trade: TokenLiveTrade) => void): () => void {
  const key = tokenKey(token);
  bus.on(key, listener);
  return () => bus.off(key, listener);
}

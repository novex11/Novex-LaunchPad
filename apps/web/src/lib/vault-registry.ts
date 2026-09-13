import { encodeAbiParameters, keccak256, parseAbiParameters } from "viem";
import {
  DEPOSIT_ASSETS,
  type StrategyId,
  strategyToChainEnum,
  receiptTokenName,
} from "@novex/config";

const STRATEGY_IDS: StrategyId[] = ["defensive", "balanced", "aggressive"];

/** keccak256(abi.encode(depositAsset, strategy)) — matches VaultFactory.vaultByKey */
export function computeVaultKey(
  depositAsset: `0x${string}`,
  strategy: StrategyId,
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("address, uint8"), [
      depositAsset,
      strategyToChainEnum(strategy),
    ]),
  );
}

export const VAULT_LOOKUP_PAIRS = DEPOSIT_ASSETS.flatMap((token) =>
  STRATEGY_IDS.map((strategy) => ({
    depositTicker: token.ticker,
    depositAsset: token.address as `0x${string}`,
    strategy,
    receiptSymbol: receiptTokenName(token.ticker, strategy),
  })),
);

export const STRATEGY_FROM_CHAIN: Record<number, StrategyId> = {
  0: "defensive",
  1: "balanced",
  2: "aggressive",
};

import { parseAbiItem, type Log } from "viem";
import * as jsonStore from "./store.js";
import * as dbStore from "./db-store.js";
import * as volumeTracker from "./volume-tracker.js";
import { createDb } from "./db.js";
import { getPublicClient } from "./chain-client.js";
import { basketVaultsConfigured, listBasketVaults, type BasketVault } from "./basket-vaults.js";

/*
 * Managed-basket (StrategyVault) event listener. Every vault created by the
 * VaultFactory is watched, and each event is attributed to its own vault id
 * (tNVDA-B, tAAPL-D, ...). Launchpad pairs are indexed by launchpad-indexer.ts.
 */

const DepositedEvent = parseAbiItem(
  "event Deposited(address indexed user, uint256 amountIn, uint256 sharesMinted, uint256 navUsd8AtDeposit)",
);
const RedeemedEvent = parseAbiItem(
  "event Redeemed(address indexed user, uint256 sharesBurned, uint8 mode, uint256 valueUsd8)",
);
const BasketSwapEvent = parseAbiItem(
  "event BasketSwap(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut)",
);

/** Re-scan the factory for newly created vaults at this cadence. */
const VAULT_REFRESH_MS = Number(process.env.VAULT_REFRESH_MS ?? 10 * 60_000);

export function startChainListener(): (() => void) | null {
  const client = getPublicClient();
  if (!client) {
    console.log("[chain-listener] No RPC URL configured, skipping");
    return null;
  }
  if (!basketVaultsConfigured()) {
    console.log("[chain-listener] No basket vault or factory configured, skipping");
    return null;
  }

  const db = createDb();
  const watched = new Map<string, () => void>();
  let stopped = false;

  const byAddress = new Map<string, BasketVault>();

  function watch(vault: BasketVault) {
    const key = vault.address.toLowerCase();
    if (watched.has(key)) return;
    byAddress.set(key, vault);
    console.log(`[chain-listener] Watching ${vault.vaultId} at ${vault.address}`);

    const unwatchers = [
      client!.watchEvent({
        address: vault.address,
        event: DepositedEvent,
        onLogs: (logs) => {
          for (const log of logs) void handleDepositEvent(vault, log, db);
        },
        onError: (err) => console.error(`[chain-listener] ${vault.vaultId} deposit watch error:`, err.message),
      }),
      client!.watchEvent({
        address: vault.address,
        event: RedeemedEvent,
        onLogs: (logs) => {
          for (const log of logs) void handleRedeemEvent(vault, log, db);
        },
        onError: (err) => console.error(`[chain-listener] ${vault.vaultId} redeem watch error:`, err.message),
      }),
      client!.watchEvent({
        address: vault.address,
        event: BasketSwapEvent,
        onLogs: (logs) => {
          for (const log of logs) void handleSwapEvent(vault, log, db);
        },
        onError: (err) => console.error(`[chain-listener] ${vault.vaultId} swap watch error:`, err.message),
      }),
    ];
    watched.set(key, () => {
      for (const u of unwatchers) u();
    });
  }

  async function refresh() {
    if (stopped) return;
    try {
      const vaults = await listBasketVaults(true);
      for (const v of vaults) watch(v);
      if (vaults.length === 0) console.log("[chain-listener] Factory has no vaults yet");
    } catch (err) {
      console.error("[chain-listener] Could not list vaults:", err instanceof Error ? err.message : err);
    }
  }

  void refresh();
  const timer = setInterval(() => void refresh(), VAULT_REFRESH_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
    for (const stop of watched.values()) stop();
    watched.clear();
    console.log("[chain-listener] Stopped watching events");
  };
}

async function handleDepositEvent(
  vault: BasketVault,
  log: Log<bigint, number, false, typeof DepositedEvent>,
  db: ReturnType<typeof createDb>,
): Promise<void> {
  const { user, amountIn, sharesMinted, navUsd8AtDeposit } = log.args;
  if (!user) return;

  const valueUsd = Number(navUsd8AtDeposit ?? 0n) / 1e8;
  const txHash = log.transactionHash ?? "";
  const input = {
    wallet: user,
    txHash,
    depositTicker: vault.depositTicker,
    depositUsd: valueUsd,
    strategy: vault.strategy,
    openingNetUsd: valueUsd,
    stockbackUsd: 0,
    allocation: [],
    vaultId: vault.vaultId,
  };

  try {
    if (db) {
      await dbStore.recordDeposit(db, input);
      await volumeTracker.recordDeposit(db, {
        txHash,
        blockNumber: log.blockNumber ?? 0n,
        userAddress: user,
        amountIn: amountIn ?? 0n,
        sharesMinted: sharesMinted ?? 0n,
        valueUsd,
        vaultId: vault.vaultId,
      });
    } else {
      jsonStore.recordDeposit(input);
    }
  } catch (err) {
    console.error(`[chain-listener] Error recording ${vault.vaultId} deposit:`, err);
  }
}

async function handleRedeemEvent(
  vault: BasketVault,
  log: Log<bigint, number, false, typeof RedeemedEvent>,
  db: ReturnType<typeof createDb>,
): Promise<void> {
  const { user, sharesBurned, mode, valueUsd8 } = log.args;
  if (!user) return;

  const valueUsd = Number(valueUsd8 ?? 0n) / 1e8;
  const txHash = log.transactionHash ?? "";
  const vaultId = vault.vaultId;

  try {
    if (db) {
      await dbStore.recordRedeem(db, { wallet: user, valueUsd, txHash, vaultId });
      await volumeTracker.recordRedeem(db, {
        txHash,
        blockNumber: log.blockNumber ?? 0n,
        userAddress: user,
        sharesBurned: sharesBurned ?? 0n,
        redeemMode: Number(mode ?? 0),
        valueUsd,
        vaultId,
      });
    } else {
      jsonStore.recordRedeem({ wallet: user, valueUsd, txHash, vaultId });
    }
  } catch (err) {
    console.error(`[chain-listener] Error recording ${vaultId} redeem:`, err);
  }
}

async function handleSwapEvent(
  vault: BasketVault,
  log: Log<bigint, number, false, typeof BasketSwapEvent>,
  db: ReturnType<typeof createDb>,
): Promise<void> {
  const { tokenIn, tokenOut, amountIn, amountOut } = log.args;
  if (!tokenIn || !tokenOut || !db) return;

  try {
    await volumeTracker.recordSwap(db, {
      txHash: log.transactionHash ?? "",
      blockNumber: log.blockNumber ?? 0n,
      logIndex: Number(log.logIndex ?? 0),
      vaultAddress: vault.address,
      tokenIn,
      tokenOut,
      amountIn: amountIn ?? 0n,
      amountOut: amountOut ?? 0n,
      vaultId: vault.vaultId,
    });
  } catch (err) {
    console.error(`[chain-listener] Error recording ${vault.vaultId} swap:`, err);
  }
}

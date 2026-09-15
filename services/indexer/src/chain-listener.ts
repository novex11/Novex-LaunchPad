import { parseAbiItem, type Address, type Log } from "viem";
import * as jsonStore from "./store.js";
import * as dbStore from "./db-store.js";
import * as volumeTracker from "./volume-tracker.js";
import { createDb } from "./db.js";
import { USE_TESTNET, getPublicClient } from "./chain-client.js";
import {
  findVaultByAddress,
  getVaults,
  onVaultsChanged,
  type RegisteredVault,
} from "./vault-registry.js";

/*
 * Managed-basket (StrategyVault) event listener. Watches every vault known
 * to the registry (discovered from the VaultFactory, or the legacy env
 * vault) and resolves each log's `vaultId` from `log.address`. Launchpad
 * pairs are indexed by launchpad-indexer.ts.
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

export function startChainListener(): (() => void) | null {
  const client = getPublicClient();
  if (!client) {
    console.log("[chain-listener] No RPC URL configured, skipping");
    return null;
  }
  // Basket vaults are mainnet-only; testnet has no DEX liquidity for them.
  if (USE_TESTNET) {
    console.log("[chain-listener] Basket vaults are mainnet-only, skipping on testnet");
    return null;
  }

  const db = createDb();
  let unwatchers: Array<() => void> = [];

  const stop = () => {
    for (const u of unwatchers) u();
    unwatchers = [];
  };

  const watch = (vaults: RegisteredVault[]) => {
    stop();
    const addresses = vaults.map((v) => v.vault);
    if (addresses.length === 0) {
      console.log("[chain-listener] No basket vaults registered yet — waiting for discovery");
      return;
    }
    console.log(
      `[chain-listener] Watching ${addresses.length} vault(s): ${vaults.map((v) => `${v.vaultId}@${v.vault}`).join(", ")}`,
    );

    unwatchers = [
      client.watchEvent({
        address: addresses,
        event: DepositedEvent,
        onLogs: (logs) => {
          for (const log of logs) void handleDepositEvent(log, db);
        },
        onError: (err) => console.error("[chain-listener] Deposit watch error:", err.message),
      }),
      client.watchEvent({
        address: addresses,
        event: RedeemedEvent,
        onLogs: (logs) => {
          for (const log of logs) void handleRedeemEvent(log, db);
        },
        onError: (err) => console.error("[chain-listener] Redeem watch error:", err.message),
      }),
      client.watchEvent({
        address: addresses,
        event: BasketSwapEvent,
        onLogs: (logs) => {
          for (const log of logs) void handleSwapEvent(log, db);
        },
        onError: (err) => console.error("[chain-listener] Swap watch error:", err.message),
      }),
    ];
  };

  watch(getVaults());
  // Re-subscribe whenever the registry discovers a new vault.
  const unsubscribe = onVaultsChanged(watch);

  return () => {
    unsubscribe();
    stop();
    console.log("[chain-listener] Stopped watching events");
  };
}

/** Resolve which basket a log came from; unknown addresses are skipped. */
function resolveVault(address: Address, kind: string): RegisteredVault | undefined {
  const vault = findVaultByAddress(address);
  if (!vault) {
    console.warn(`[chain-listener] ${kind} from unknown vault ${address}, skipping`);
  }
  return vault;
}

async function handleDepositEvent(
  log: Log<bigint, number, false, typeof DepositedEvent>,
  db: ReturnType<typeof createDb>,
): Promise<void> {
  const { user, amountIn, sharesMinted, navUsd8AtDeposit } = log.args;
  if (!user) return;
  const vault = resolveVault(log.address, "Deposited");
  if (!vault) return;

  const valueUsd = Number(navUsd8AtDeposit ?? 0n) / 1e8;
  const txHash = log.transactionHash ?? "";
  const { depositTicker, strategy, vaultId } = vault;
  const input = {
    wallet: user,
    txHash,
    depositTicker,
    depositUsd: valueUsd,
    strategy,
    openingNetUsd: valueUsd,
    stockbackUsd: 0,
    allocation: [],
    vaultId,
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
        vaultId,
      });
    } else {
      jsonStore.recordDeposit(input);
    }
  } catch (err) {
    console.error("[chain-listener] Error recording deposit:", err);
  }
}

async function handleRedeemEvent(
  log: Log<bigint, number, false, typeof RedeemedEvent>,
  db: ReturnType<typeof createDb>,
): Promise<void> {
  const { user, sharesBurned, mode, valueUsd8 } = log.args;
  if (!user) return;
  const vault = resolveVault(log.address, "Redeemed");
  if (!vault) return;

  const valueUsd = Number(valueUsd8 ?? 0n) / 1e8;
  const txHash = log.transactionHash ?? "";
  const { vaultId } = vault;

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
    console.error("[chain-listener] Error recording redeem:", err);
  }
}

async function handleSwapEvent(
  log: Log<bigint, number, false, typeof BasketSwapEvent>,
  db: ReturnType<typeof createDb>,
): Promise<void> {
  const { tokenIn, tokenOut, amountIn, amountOut } = log.args;
  if (!tokenIn || !tokenOut || !db) return;
  const vault = resolveVault(log.address, "BasketSwap");
  if (!vault) return;

  try {
    await volumeTracker.recordSwap(db, {
      txHash: log.transactionHash ?? "",
      blockNumber: log.blockNumber ?? 0n,
      logIndex: Number(log.logIndex ?? 0),
      vaultAddress: vault.vault,
      vaultId: vault.vaultId,
      tokenIn,
      tokenOut,
      amountIn: amountIn ?? 0n,
      amountOut: amountOut ?? 0n,
    });
  } catch (err) {
    console.error("[chain-listener] Error recording swap:", err);
  }
}

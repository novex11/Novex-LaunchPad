import { createPublicClient, http, parseAbi, type PublicClient } from "viem";
import { robinhoodTestnet, robinhoodChain } from "@compose/config";
import { createDb } from "./db.js";
import { positions, tvlSnapshots, vaults as vaultsTable } from "./schema.js";
import { eq } from "drizzle-orm";
import * as launchpadStore from "./launchpad-store.js";
import { recordAndPublishSnapshot } from "./pair-live.js";
import { pairFactoryAddress } from "./chain-client.js";
import {
  findVaultById,
  getVaults,
  readContracts,
  type RegisteredVault,
} from "./vault-registry.js";

const USE_TESTNET = process.env.NEXT_PUBLIC_USE_TESTNET === "true";
const chain = USE_TESTNET ? robinhoodTestnet : robinhoodChain;

/** StrategyVault shares are minted at 1e-8 USD scale (initial share price 1e18). */
const RECEIPT_SHARE_SCALE = 1e8;

const vaultAbi = parseAbi([
  "function navUsd8() view returns (uint256)",
  "function sharePrice() view returns (uint256)",
  "function totalShares() view returns (uint256)",
]);

// PairVault exposes the same three read functions as StrategyVault so we
// reuse the same ABI to snapshot each launched pair's on-chain NAV.
const pairAbi = vaultAbi;

const receiptAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

const INTERVAL_MS = Number(process.env.MARK_TO_MARKET_INTERVAL_MS ?? 60_000);
/** How often each pair's NAV / share price is sampled for live charts. */
const PAIR_SNAPSHOT_INTERVAL_MS = Number(process.env.PAIR_SNAPSHOT_INTERVAL_MS ?? 10_000);
/** An unchanged value is stored at most this often, keeping candles continuous. */
const PAIR_HEARTBEAT_MS = Number(process.env.PAIR_SNAPSHOT_HEARTBEAT_MS ?? 60_000);
const lastPairSnapshot = new Map<string, { navUsd: number; sharePrice: number; at: number }>();

function getClient() {
  const rpcUrl = USE_TESTNET
    ? process.env.ROBINHOOD_TESTNET_RPC_URL
    : process.env.ROBINHOOD_RPC_URL;
  if (!rpcUrl) return null;

  return createPublicClient({
    chain: {
      id: chain.id,
      name: chain.name,
      nativeCurrency: chain.nativeCurrency,
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    transport: http(rpcUrl),
  });
}

interface VaultStats {
  vault: RegisteredVault;
  navUsd: number;
  sharePrice: number;
  totalShares: string;
}

/** navUsd8 / sharePrice / totalShares for every registered vault in one multicall. */
async function readVaultStats(
  client: PublicClient,
  list: RegisteredVault[],
): Promise<VaultStats[]> {
  const calls = list.flatMap((v) =>
    (["navUsd8", "sharePrice", "totalShares"] as const).map((functionName) => ({
      address: v.vault,
      abi: vaultAbi,
      functionName,
    })),
  );
  const results = await readContracts(client, calls);

  const out: VaultStats[] = [];
  list.forEach((vault, i) => {
    const navUsd8Raw = results[i * 3];
    const sharePriceRaw = results[i * 3 + 1];
    const totalSharesRaw = results[i * 3 + 2];
    if (
      typeof navUsd8Raw !== "bigint" ||
      typeof sharePriceRaw !== "bigint" ||
      typeof totalSharesRaw !== "bigint"
    ) {
      console.warn(`[mark-to-market] Could not read ${vault.vaultId} at ${vault.vault}, skipping`);
      return;
    }
    out.push({
      vault,
      navUsd: Number(navUsd8Raw) / 1e8,
      sharePrice: Number(sharePriceRaw) / 1e18,
      totalShares: totalSharesRaw.toString(),
    });
  });
  return out;
}

/** Receipt-token balances for wallet positions, batched per tick. */
const POSITION_BATCH = 100;

async function updatePortfolioValues(): Promise<void> {
  const list = getVaults();
  if (list.length === 0) return;

  const client = getClient() as PublicClient | null;
  if (!client) return;

  const db = createDb();

  try {
    const stats = await readVaultStats(client, list);
    if (stats.length === 0) return;

    for (const s of stats) {
      console.log(
        `[mark-to-market] ${s.vault.vaultId} NAV: $${s.navUsd.toFixed(2)}, Share Price: ${s.sharePrice.toFixed(6)}, Total Shares: ${s.totalShares}`,
      );
    }

    if (!db) return;

    await db.insert(tvlSnapshots).values(
      stats.map((s) => ({
        vaultId: s.vault.vaultId,
        vaultAddress: s.vault.vault.toLowerCase(),
        navUsd: String(s.navUsd.toFixed(4)),
        sharePrice: String(s.sharePrice.toFixed(8)),
        totalShares: s.totalShares,
      })),
    );

    // Keep the vault summary rows (served by /vault/:id) marked to market.
    for (const s of stats) {
      await db
        .update(vaultsTable)
        .set({
          tvlUsd: String(s.navUsd.toFixed(4)),
          sharePrice: String(s.sharePrice.toFixed(8)),
          receiptSupply: (Number(s.totalShares) / RECEIPT_SHARE_SCALE).toFixed(3),
          contractAddress: s.vault.vault,
        })
        .where(eq(vaultsTable.id, s.vault.vaultId));
    }

    const sharePriceById = new Map(stats.map((s) => [s.vault.vaultId, s.sharePrice]));

    // Update all wallet positions using each vault's own receipt token.
    const allPositions = await db.select().from(positions);
    const targets = allPositions.flatMap((pos) => {
      const vault =
        findVaultById(pos.vaultId) ??
        // Legacy rows predate per-vault ids; with a single vault they belong to it.
        (list.length === 1 ? list[0] : undefined);
      const sharePrice = vault ? sharePriceById.get(vault.vaultId) : undefined;
      if (!vault || sharePrice === undefined || vault.receiptToken === "0x0000000000000000000000000000000000000000") {
        return [];
      }
      return [{ pos, vault, sharePrice }];
    });

    for (let i = 0; i < targets.length; i += POSITION_BATCH) {
      const slice = targets.slice(i, i + POSITION_BATCH);
      const balances = await readContracts(
        client,
        slice.map(({ pos, vault }) => ({
          address: vault.receiptToken,
          abi: receiptAbi,
          functionName: "balanceOf",
          args: [pos.wallet as `0x${string}`],
        })),
      );

      for (let j = 0; j < slice.length; j++) {
        const balance = balances[j];
        if (typeof balance !== "bigint") continue; // skip individual wallet errors
        const { pos, sharePrice } = slice[j];
        try {
          const receiptBalNum = Number(balance) / RECEIPT_SHARE_SCALE;
          const currentValue = receiptBalNum * sharePrice;
          await db
            .update(positions)
            .set({
              currentValueUsd: String(currentValue.toFixed(4)),
              receiptBalance: receiptBalNum.toFixed(3),
              updatedAt: new Date(),
            })
            .where(eq(positions.wallet, pos.wallet));
        } catch {
          // Skip individual wallet errors
        }
      }
    }
  } catch (err) {
    console.error(
      "[mark-to-market] Update failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Snapshot the on-chain NAV of every launched pair vault so the pair-detail
 * chart can render a real time-series curve. Skips silently when the DB or
 * an RPC is unavailable so failures never block the primary vault update.
 */
async function snapshotAllPairs(): Promise<void> {
  const client = getClient();
  if (!client) return;

  const db = createDb();
  if (!db) return;

  try {
    const addresses = await launchpadStore.listActivePairAddresses(db, pairFactoryAddress());
    if (addresses.length === 0) return;

    // Fan-out with a small concurrency limit so we don't hammer the RPC when
    // hundreds of pairs are live.
    const CONCURRENCY = 6;
    for (let i = 0; i < addresses.length; i += CONCURRENCY) {
      const slice = addresses.slice(i, i + CONCURRENCY);
      await Promise.all(
        slice.map(async (addr) => {
          const pairAddress = addr as `0x${string}`;
          try {
            const [navUsd8Raw, sharePriceRaw, totalSharesRaw] = await Promise.all([
              client.readContract({
                address: pairAddress,
                abi: pairAbi,
                functionName: "navUsd8",
              }),
              client.readContract({
                address: pairAddress,
                abi: pairAbi,
                functionName: "sharePrice",
              }),
              client.readContract({
                address: pairAddress,
                abi: pairAbi,
                functionName: "totalShares",
              }),
            ]);
            const navUsd = Number(navUsd8Raw) / 1e8;
            // PairVault.sharePrice() is USD (8 decimals) per 1e18 shares
            const sharePrice = Number(sharePriceRaw) / 1e8;
            const key = pairAddress.toLowerCase();
            const prev = lastPairSnapshot.get(key);
            const now = Date.now();
            const changed = !prev || prev.navUsd !== navUsd || prev.sharePrice !== sharePrice;
            if (!changed && now - prev.at < PAIR_HEARTBEAT_MS) return;
            lastPairSnapshot.set(key, { navUsd, sharePrice, at: now });
            await recordAndPublishSnapshot(db, {
              pairAddress,
              navUsd,
              sharePrice,
              totalShares: totalSharesRaw.toString(),
              reason: "tick",
            });
            await launchpadStore.updatePairTvl(db, pairAddress, navUsd);
          } catch {
            // Skip individual pair failures — one bad RPC read
            // should not poison the whole batch.
          }
        }),
      );
    }
  } catch (err) {
    console.error(
      "[mark-to-market] Pair snapshot batch failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

async function tick(): Promise<void> {
  await updatePortfolioValues();
}

export function startMarkToMarket(): NodeJS.Timeout | null {
  const rpcUrl = USE_TESTNET
    ? process.env.ROBINHOOD_TESTNET_RPC_URL
    : process.env.ROBINHOOD_RPC_URL;
  if (!rpcUrl) {
    console.log("[mark-to-market] No RPC URL configured, skipping");
    return null;
  }

  const vaultCount = getVaults().length;
  if (vaultCount === 0) {
    console.log(
      "[mark-to-market] No basket vaults registered — pair snapshots only",
    );
  } else {
    console.log(`[mark-to-market] Marking ${vaultCount} basket vault(s) to market`);
  }

  console.log(
    `[mark-to-market] Starting periodic updates every ${INTERVAL_MS / 1000}s`,
  );

  tick();

  // Pair charts sample much faster than portfolio marks; skip a round if the last is still running.
  let pairRoundBusy = false;
  const samplePairs = async () => {
    if (pairRoundBusy) return;
    pairRoundBusy = true;
    try {
      await snapshotAllPairs();
    } finally {
      pairRoundBusy = false;
    }
  };
  void samplePairs();
  setInterval(samplePairs, PAIR_SNAPSHOT_INTERVAL_MS).unref();
  console.log(`[mark-to-market] Sampling pair prices every ${PAIR_SNAPSHOT_INTERVAL_MS / 1000}s`);

  return setInterval(tick, INTERVAL_MS);
}

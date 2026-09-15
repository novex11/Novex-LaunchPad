import { createPublicClient, http, parseAbi } from "viem";
import { robinhoodTestnet, robinhoodChain, receiptTokenName } from "@novex/config";
import { createDb } from "./db.js";
import { positions, tvlSnapshots } from "./schema.js";
import { eq } from "drizzle-orm";
import * as jsonStore from "./store.js";
import * as launchpadStore from "./launchpad-store.js";
import { recordAndPublishSnapshot } from "./pair-live.js";
import { pairFactoryAddress } from "./chain-client.js";

const DEFAULT_VAULT_ID = receiptTokenName(
  process.env.DEFAULT_DEPOSIT_TICKER ?? "NVDA",
  (process.env.DEFAULT_STRATEGY ?? "balanced") as "defensive" | "balanced" | "aggressive",
);

const USE_TESTNET = process.env.NEXT_PUBLIC_USE_TESTNET === "true";
const chain = USE_TESTNET ? robinhoodTestnet : robinhoodChain;
const VAULT_ADDRESS = (process.env.VAULT_CONTRACT_ADDRESS ??
  process.env.NEXT_PUBLIC_VAULT_ADDRESS) as `0x${string}` | undefined;
const RECEIPT_TOKEN_ADDRESS = (process.env.RECEIPT_TOKEN_CONTRACT_ADDRESS ??
  process.env.NEXT_PUBLIC_RECEIPT_TOKEN_ADDRESS) as `0x${string}` | undefined;

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

async function updatePortfolioValues(): Promise<void> {
  if (!VAULT_ADDRESS || !RECEIPT_TOKEN_ADDRESS) return;

  const client = getClient();
  if (!client) return;

  const db = createDb();

  try {
    const [navUsd8Raw, sharePriceRaw, totalSharesRaw] = await Promise.all([
      client.readContract({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "navUsd8",
      }),
      client.readContract({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "sharePrice",
      }),
      client.readContract({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "totalShares",
      }),
    ]);

    const navUsd = Number(navUsd8Raw) / 1e8;
    const sharePrice = Number(sharePriceRaw) / 1e18;
    const totalShares = totalSharesRaw.toString();

    console.log(
      `[mark-to-market] Vault NAV: $${navUsd.toFixed(2)}, Share Price: ${sharePrice.toFixed(6)}, Total Shares: ${totalShares}`,
    );

    if (db) {
      await db.insert(tvlSnapshots).values({
        vaultId: DEFAULT_VAULT_ID,
        vaultAddress: VAULT_ADDRESS.toLowerCase(),
        navUsd: String(navUsd.toFixed(4)),
        sharePrice: String(sharePrice.toFixed(8)),
        totalShares,
      });

      // Update all wallet positions
      const allPositions = await db.select().from(positions);

      for (const pos of allPositions) {
        try {
          const balance = await client.readContract({
            address: RECEIPT_TOKEN_ADDRESS,
            abi: receiptAbi,
            functionName: "balanceOf",
            args: [pos.wallet as `0x${string}`],
          });

          const receiptBalNum = Number(balance) / 1e18;
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

  const hasMainVault = Boolean(VAULT_ADDRESS && RECEIPT_TOKEN_ADDRESS);
  if (!hasMainVault) {
    console.log(
      "[mark-to-market] Main vault not configured — pair snapshots only",
    );
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

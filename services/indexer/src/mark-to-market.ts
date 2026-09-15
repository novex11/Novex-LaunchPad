import { createPublicClient, http, parseAbi } from "viem";
import { robinhoodTestnet, robinhoodChain } from "@novex/config";
import { createDb } from "./db.js";
import { positions, tvlSnapshots } from "./schema.js";
import { eq } from "drizzle-orm";
import * as launchpadStore from "./launchpad-store.js";
import { pairFactoryAddress } from "./chain-client.js";
import { basketVaultsConfigured, listBasketVaults, type BasketVault } from "./basket-vaults.js";

const USE_TESTNET = process.env.NEXT_PUBLIC_USE_TESTNET === "true";
const chain = USE_TESTNET ? robinhoodTestnet : robinhoodChain;

/** StrategyVault shares are minted at 1e-8 USD scale (initial share price 1e18). */
const RECEIPT_SHARE_DECIMALS = 8;

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

async function snapshotVault(
  client: NonNullable<ReturnType<typeof getClient>>,
  db: ReturnType<typeof createDb>,
  vault: BasketVault,
  walletsByVault: Map<string, string[]>,
): Promise<void> {
  const [navUsd8Raw, sharePriceRaw, totalSharesRaw] = await Promise.all([
    client.readContract({ address: vault.address, abi: vaultAbi, functionName: "navUsd8" }),
    client.readContract({ address: vault.address, abi: vaultAbi, functionName: "sharePrice" }),
    client.readContract({ address: vault.address, abi: vaultAbi, functionName: "totalShares" }),
  ]);

  const navUsd = Number(navUsd8Raw) / 1e8;
  const sharePrice = Number(sharePriceRaw) / 1e18;
  const totalShares = totalSharesRaw.toString();

  if (!db) {
    console.log(`[mark-to-market] ${vault.vaultId} NAV $${navUsd.toFixed(2)} share ${sharePrice.toFixed(6)}`);
    return;
  }

  await db.insert(tvlSnapshots).values({
    vaultId: vault.vaultId,
    vaultAddress: vault.address.toLowerCase(),
    navUsd: String(navUsd.toFixed(4)),
    sharePrice: String(sharePrice.toFixed(8)),
    totalShares,
  });

  // Refresh every wallet position that lives in this vault
  for (const wallet of walletsByVault.get(vault.vaultId) ?? []) {
    try {
      const balance = await client.readContract({
        address: vault.receiptToken,
        abi: receiptAbi,
        functionName: "balanceOf",
        args: [wallet as `0x${string}`],
      });
      const receiptBalNum = Number(balance) / 10 ** RECEIPT_SHARE_DECIMALS;
      const currentValue = receiptBalNum * sharePrice;
      await db
        .update(positions)
        .set({
          currentValueUsd: String(currentValue.toFixed(4)),
          receiptBalance: receiptBalNum.toFixed(3),
          updatedAt: new Date(),
        })
        .where(eq(positions.wallet, wallet));
    } catch {
      // Skip individual wallet errors
    }
  }
}

async function updatePortfolioValues(): Promise<void> {
  if (!basketVaultsConfigured()) return;

  const client = getClient();
  if (!client) return;

  const db = createDb();

  try {
    const vaults = await listBasketVaults();
    if (vaults.length === 0) return;

    const walletsByVault = new Map<string, string[]>();
    if (db) {
      const allPositions = await db.select().from(positions);
      for (const pos of allPositions) {
        const list = walletsByVault.get(pos.vaultId) ?? [];
        list.push(pos.wallet);
        walletsByVault.set(pos.vaultId, list);
      }
    }

    let totalNav = 0;
    for (const vault of vaults) {
      try {
        await snapshotVault(client, db, vault, walletsByVault);
        const nav = await client.readContract({ address: vault.address, abi: vaultAbi, functionName: "navUsd8" });
        totalNav += Number(nav) / 1e8;
      } catch (err) {
        console.error(`[mark-to-market] ${vault.vaultId} snapshot failed:`, err instanceof Error ? err.message : err);
      }
    }
    console.log(`[mark-to-market] ${vaults.length} basket vaults, total NAV $${totalNav.toFixed(2)}`);
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
            await launchpadStore.recordPairSnapshot(db, {
              pairAddress,
              navUsd,
              // PairVault.sharePrice() is USD (8 decimals) per 1e18 shares
              sharePrice: Number(sharePriceRaw) / 1e8,
              totalShares: totalSharesRaw.toString(),
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
  await snapshotAllPairs();
}

export function startMarkToMarket(): NodeJS.Timeout | null {
  const rpcUrl = USE_TESTNET
    ? process.env.ROBINHOOD_TESTNET_RPC_URL
    : process.env.ROBINHOOD_RPC_URL;
  if (!rpcUrl) {
    console.log("[mark-to-market] No RPC URL configured, skipping");
    return null;
  }

  if (!basketVaultsConfigured()) {
    console.log(
      "[mark-to-market] No basket vault factory configured — pair snapshots only",
    );
  }

  console.log(
    `[mark-to-market] Starting periodic updates every ${INTERVAL_MS / 1000}s`,
  );

  tick();
  return setInterval(tick, INTERVAL_MS);
}

import { parseAbiItem, type Address } from "viem";
import { getPublicClient, launchpadStartBlock } from "./chain-client.js";
import { getVaults } from "./vault-registry.js";

/*
 * Cumulative basket volume (deposits + redeems, USD) read from the vaults' own
 * Deposited / Redeemed events, so it counts every basket transaction on-chain no
 * matter how it was submitted. One catch-up scan at startup, then a small
 * incremental scan every poll; the total only ever grows.
 */

const DEPOSITED = parseAbiItem(
  "event Deposited(address indexed user, uint256 amountIn, uint256 sharesMinted, uint256 valueUsd8)",
);
const REDEEMED = parseAbiItem(
  "event Redeemed(address indexed user, uint256 sharesBurned, uint8 mode, uint256 valueUsd8)",
);

const CHUNK = 50_000n;
const POLL_MS = 15_000;

interface VolumeState {
  vaultsKey: string;
  nextBlock: bigint;
  depositUsd8: bigint;
  redeemUsd8: bigint;
  deposits: number;
  redeems: number;
  ready: boolean;
  updatedAt: string | null;
}

const EMPTY = (): VolumeState => ({
  vaultsKey: "",
  nextBlock: 0n,
  depositUsd8: 0n,
  redeemUsd8: 0n,
  deposits: 0,
  redeems: 0,
  ready: false,
  updatedAt: null,
});

let state = EMPTY();
let running = false;

/** First block to scan: `BASKET_START_BLOCK`, else the launchpad start block. */
function startBlock(): bigint {
  const raw = process.env.BASKET_START_BLOCK;
  if (raw) {
    try {
      return BigInt(raw);
    } catch {
      // fall through
    }
  }
  return launchpadStartBlock();
}

async function poll(): Promise<void> {
  const client = getPublicClient();
  const vaults = getVaults().map((v) => v.vault.toLowerCase() as Address);
  if (!client || vaults.length === 0 || running) return;
  running = true;
  try {
    const key = [...vaults].sort().join(",");
    // A new vault set (new factory or newly discovered vault) needs its full history.
    if (key !== state.vaultsKey) state = { ...EMPTY(), vaultsKey: key, nextBlock: startBlock() };

    const latest = await client.getBlockNumber();
    while (state.nextBlock <= latest) {
      const to = state.nextBlock + CHUNK - 1n > latest ? latest : state.nextBlock + CHUNK - 1n;
      const logs = await client.getLogs({
        address: vaults,
        events: [DEPOSITED, REDEEMED],
        fromBlock: state.nextBlock,
        toBlock: to,
      });
      for (const log of logs) {
        const value = log.args.valueUsd8 ?? 0n;
        if (log.eventName === "Deposited") {
          state.depositUsd8 += value;
          state.deposits += 1;
        } else {
          state.redeemUsd8 += value;
          state.redeems += 1;
        }
      }
      state.nextBlock = to + 1n;
    }
    state.ready = true;
    state.updatedAt = new Date().toISOString();
  } catch (err) {
    console.warn("[basket-volume] scan failed, retrying next poll:", err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

export function getBasketVolume() {
  const depositUsd = Number(state.depositUsd8) / 1e8;
  const redeemUsd = Number(state.redeemUsd8) / 1e8;
  return {
    volumeUsd: depositUsd + redeemUsd,
    depositUsd,
    redeemUsd,
    deposits: state.deposits,
    redeems: state.redeems,
    vaults: getVaults().length,
    scannedToBlock: state.nextBlock > 0n ? String(state.nextBlock - 1n) : null,
    ready: state.ready,
    updatedAt: state.updatedAt,
  };
}

export function startBasketVolume(): () => void {
  void poll();
  const timer = setInterval(() => void poll(), POLL_MS);
  return () => clearInterval(timer);
}

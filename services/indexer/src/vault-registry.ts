import {
  parseAbi,
  parseAbiItem,
  type Address,
  type ContractFunctionParameters,
  type PublicClient,
} from "viem";
import {
  getTokenByAddress,
  getTokenByTicker,
  isHexAddress,
  receiptTokenName,
  type StrategyId,
} from "@compose/config";
import {
  USE_TESTNET,
  getPublicClient,
  multicall3Address,
  vaultFactoryAddress,
} from "./chain-client.js";

/*
 * Managed-basket vault registry.
 *
 * Discovers every StrategyVault from the on-chain VaultFactory
 * (`vaultCount()` + `vaults(i)`), keeps the list in memory, and keeps it
 * fresh by watching `VaultCreated`. When no factory is configured it falls
 * back to the legacy single VAULT_ADDRESS / RECEIPT_TOKEN_ADDRESS env pair so
 * existing deployments keep working unchanged.
 *
 * Every vault is keyed by `vaultId` — the receipt symbol derived from its
 * deposit ticker and strategy (e.g. "tNVDA-B") — which is how positions,
 * activity, daily volume and TVL snapshots are keyed in the stores.
 */

export interface RegisteredVault {
  /** Receipt symbol, e.g. "tNVDA-B"; the key used across the stores. */
  vaultId: string;
  vault: Address;
  receiptToken: Address;
  depositAsset: Address;
  depositTicker: string;
  strategy: StrategyId;
}

export type VaultRegistrySource = "factory" | "legacy-env" | "none";

/** AllocationController.Strategy enum → config strategy id. */
const STRATEGY_FROM_CHAIN: Record<number, StrategyId> = {
  0: "defensive",
  1: "balanced",
  2: "aggressive",
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

const factoryAbi = parseAbi([
  "function vaultCount() view returns (uint256)",
  "function vaults(uint256) view returns (address vault, address receiptToken, address depositAsset, uint8 strategy)",
]);

const VaultCreatedEvent = parseAbiItem(
  "event VaultCreated(address indexed vault, address indexed receiptToken, address depositAsset, uint8 strategy)",
);

/** Safety-net re-read of the factory in case a VaultCreated log is missed. */
const REFRESH_INTERVAL_MS = Number(process.env.VAULT_REGISTRY_REFRESH_MS ?? 300_000);

type Listener = (vaults: RegisteredVault[]) => void;

let vaults: RegisteredVault[] = [];
let byAddress = new Map<string, RegisteredVault>();
let byId = new Map<string, RegisteredVault>();
let source: VaultRegistrySource = "none";
let initialised = false;
const listeners = new Set<Listener>();

// ─── Legacy single-vault fallback ───────────────────────

/** The env-configured default basket (pre-factory deployments). */
export function defaultVaultId(): {
  depositTicker: string;
  strategy: StrategyId;
  vaultId: string;
} {
  const depositTicker = (process.env.DEFAULT_DEPOSIT_TICKER ?? "NVDA").toUpperCase();
  const raw = process.env.DEFAULT_STRATEGY ?? "balanced";
  const strategy: StrategyId =
    raw === "defensive" || raw === "aggressive" || raw === "balanced" ? raw : "balanced";
  return { depositTicker, strategy, vaultId: receiptTokenName(depositTicker, strategy) };
}

function legacyVault(): RegisteredVault | null {
  const vault = process.env.VAULT_CONTRACT_ADDRESS ?? process.env.NEXT_PUBLIC_VAULT_ADDRESS;
  const receiptToken =
    process.env.RECEIPT_TOKEN_CONTRACT_ADDRESS ?? process.env.NEXT_PUBLIC_RECEIPT_TOKEN_ADDRESS;
  if (!isHexAddress(vault)) return null;
  const { depositTicker, strategy, vaultId } = defaultVaultId();
  const depositAsset = getTokenByTicker(depositTicker)?.address;
  return {
    vaultId,
    vault,
    receiptToken: isHexAddress(receiptToken) ? receiptToken : ZERO_ADDRESS,
    depositAsset: isHexAddress(depositAsset) ? depositAsset : ZERO_ADDRESS,
    depositTicker,
    strategy,
  };
}

// ─── Batched reads ──────────────────────────────────────

let multicallAvailable = true;

/**
 * Read many contract calls via Multicall3, falling back to sequential
 * `readContract` calls when the chain has no Multicall3 (or the batch
 * fails). Failed individual reads come back as `undefined`.
 */
export async function readContracts(
  client: PublicClient,
  contracts: ContractFunctionParameters[],
): Promise<Array<unknown | undefined>> {
  if (contracts.length === 0) return [];

  if (multicallAvailable) {
    try {
      const results = await client.multicall({
        contracts,
        allowFailure: true,
        multicallAddress: multicall3Address(),
      });
      return results.map((r) => (r.status === "success" ? r.result : undefined));
    } catch (err) {
      multicallAvailable = false;
      console.warn(
        "[vault-registry] Multicall unavailable, falling back to sequential reads:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const out: Array<unknown | undefined> = [];
  for (const call of contracts) {
    try {
      out.push(await client.readContract(call));
    } catch {
      out.push(undefined);
    }
  }
  return out;
}

// ─── Discovery ──────────────────────────────────────────

function toRegistered(info: {
  vault: Address;
  receiptToken: Address;
  depositAsset: Address;
  strategy: number;
}): RegisteredVault {
  const strategy = STRATEGY_FROM_CHAIN[info.strategy] ?? "balanced";
  const token = getTokenByAddress(info.depositAsset);
  const depositTicker = token?.ticker.toUpperCase() ?? info.depositAsset.slice(0, 10).toUpperCase();
  if (!token) {
    console.warn(
      `[vault-registry] Unknown deposit asset ${info.depositAsset} for vault ${info.vault}; using ${depositTicker}`,
    );
  }
  return {
    vaultId: receiptTokenName(depositTicker, strategy),
    vault: info.vault,
    receiptToken: info.receiptToken,
    depositAsset: info.depositAsset,
    depositTicker,
    strategy,
  };
}

/**
 * Read every vault registered on the VaultFactory. Uses one multicall for
 * all `vaults(i)` slots and falls back to sequential reads.
 */
export async function loadVaults(client: PublicClient): Promise<RegisteredVault[]> {
  const factory = vaultFactoryAddress();
  if (!factory) return [];

  const count = Number(
    await client.readContract({ address: factory, abi: factoryAbi, functionName: "vaultCount" }),
  );
  if (count === 0) return [];

  const calls: ContractFunctionParameters[] = Array.from({ length: count }, (_, i) => ({
    address: factory,
    abi: factoryAbi,
    functionName: "vaults",
    args: [BigInt(i)],
  }));
  const rows = await readContracts(client, calls);

  const out: RegisteredVault[] = [];
  rows.forEach((row, i) => {
    if (!Array.isArray(row)) {
      console.warn(`[vault-registry] Could not read vaults(${i}) from factory ${factory}`);
      return;
    }
    const [vault, receiptToken, depositAsset, strategy] = row as [Address, Address, Address, number];
    if (!isHexAddress(vault) || vault === ZERO_ADDRESS) return;
    out.push(toRegistered({ vault, receiptToken, depositAsset, strategy: Number(strategy) }));
  });
  return out;
}

function setVaults(next: RegisteredVault[], nextSource: VaultRegistrySource): void {
  const before = vaults.map((v) => v.vault.toLowerCase()).join(",");
  vaults = next;
  byAddress = new Map(next.map((v) => [v.vault.toLowerCase(), v]));
  byId = new Map(next.map((v) => [v.vaultId, v]));
  source = nextSource;
  const after = next.map((v) => v.vault.toLowerCase()).join(",");
  if (before !== after) {
    for (const fn of listeners) {
      try {
        fn(vaults);
      } catch (err) {
        console.error("[vault-registry] Listener failed:", err);
      }
    }
  }
}

function addVault(v: RegisteredVault): boolean {
  if (byAddress.has(v.vault.toLowerCase())) return false;
  setVaults([...vaults, v], source);
  return true;
}

/** Re-read the factory (or legacy env) and replace the cached list. */
export async function refreshVaults(): Promise<RegisteredVault[]> {
  const factory = vaultFactoryAddress();
  if (!factory) {
    const legacy = legacyVault();
    setVaults(legacy ? [legacy] : [], legacy ? "legacy-env" : "none");
    return vaults;
  }
  const client = getPublicClient();
  if (!client) {
    setVaults([], "factory");
    return vaults;
  }
  setVaults(await loadVaults(client), "factory");
  return vaults;
}

/**
 * Populate the registry once at startup. Logs which source is in use so
 * operators can tell a factory deployment from the legacy env fallback.
 */
export async function initVaultRegistry(): Promise<RegisteredVault[]> {
  if (initialised) return vaults;
  initialised = true;

  const factory = vaultFactoryAddress();
  if (!factory) {
    const legacy = legacyVault();
    if (legacy) {
      console.log(
        `[vault-registry] No vault factory configured — using legacy env vault ${legacy.vault} as ${legacy.vaultId}`,
      );
    } else {
      console.log(
        USE_TESTNET
          ? "[vault-registry] No vault factory on testnet (baskets are mainnet-only) — no basket vaults"
          : "[vault-registry] No vault factory configured and no VAULT_ADDRESS env — no basket vaults",
      );
    }
    setVaults(legacy ? [legacy] : [], legacy ? "legacy-env" : "none");
    return vaults;
  }

  const client = getPublicClient();
  if (!client) {
    console.log("[vault-registry] No RPC URL configured — cannot read vault factory");
    setVaults([], "factory");
    return vaults;
  }

  try {
    const list = await loadVaults(client);
    setVaults(list, "factory");
    console.log(
      `[vault-registry] Loaded ${list.length} vault(s) from factory ${factory}` +
        (list.length ? `: ${list.map((v) => v.vaultId).join(", ")}` : ""),
    );
  } catch (err) {
    console.error(
      "[vault-registry] Failed to read vault factory:",
      err instanceof Error ? err.message : err,
    );
    setVaults([], "factory");
  }
  return vaults;
}

/**
 * Watch `VaultCreated` on the factory so newly deployed baskets are picked
 * up live, plus a periodic full refresh as a safety net. Returns a cleanup.
 */
export function startVaultDiscovery(): (() => void) | null {
  const factory = vaultFactoryAddress();
  const client = getPublicClient();
  if (!factory || !client) return null;

  const unwatch = client.watchEvent({
    address: factory,
    event: VaultCreatedEvent,
    onLogs: (logs) => {
      for (const log of logs) {
        const { vault, receiptToken, depositAsset, strategy } = log.args;
        if (!vault || !receiptToken || !depositAsset) continue;
        const v = toRegistered({ vault, receiptToken, depositAsset, strategy: Number(strategy ?? 1) });
        if (addVault(v)) {
          console.log(`[vault-registry] New vault ${v.vaultId} at ${v.vault}`);
        }
      }
    },
    onError: (err) => console.error("[vault-registry] VaultCreated watch error:", err.message),
  });

  let timer: NodeJS.Timeout | null = null;
  if (REFRESH_INTERVAL_MS > 0) {
    timer = setInterval(() => {
      refreshVaults().catch((err) =>
        console.error(
          "[vault-registry] Refresh failed:",
          err instanceof Error ? err.message : err,
        ),
      );
    }, REFRESH_INTERVAL_MS);
    timer.unref();
  }

  console.log(`[vault-registry] Watching VaultCreated on factory ${factory}`);
  return () => {
    unwatch();
    if (timer) clearInterval(timer);
  };
}

// ─── Lookups ────────────────────────────────────────────

/** Snapshot of the cached vault list. */
export function getVaults(): RegisteredVault[] {
  return vaults;
}

export function vaultRegistrySource(): VaultRegistrySource {
  return source;
}

/** Resolve a vault from a contract address (e.g. `log.address`). */
export function findVaultByAddress(address: string): RegisteredVault | undefined {
  return byAddress.get(address.toLowerCase());
}

export function findVaultById(vaultId: string): RegisteredVault | undefined {
  return byId.get(vaultId);
}

/** Subscribe to changes of the vault set; returns an unsubscribe. */
export function onVaultsChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

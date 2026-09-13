import { getAddress } from "viem";
import strategyVaultAbi from "./abis/StrategyVault.json";
import receiptTokenAbi from "./abis/ReceiptToken.json";
import vaultFactoryAbi from "./abis/VaultFactory.json";
import oracleAdapterAbi from "./abis/OracleAdapter.json";
import pairFactoryAbi from "./abis/PairFactory.json";
import pairVaultAbi from "./abis/PairVault.json";
import launchpadZapAbi from "./abis/LaunchpadZap.json";
import wrhtAbi from "./abis/WRHT.json";

export {
  strategyVaultAbi,
  receiptTokenAbi,
  vaultFactoryAbi,
  oracleAdapterAbi,
  pairFactoryAbi,
  pairVaultAbi,
  launchpadZapAbi,
  wrhtAbi,
};

// ERC-20 minimal ABI for approve/balanceOf
export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
] as const;

/**
 * Deployed contract addresses.
 *
 * After deploying via `forge script`, update these from deployments.json.
 * For local dev / pre-deploy, these are zero addresses that the UI
 * detects and falls back to mock/indexer flow.
 */
const ZERO = "0x0000000000000000000000000000000000000000" as `0x${string}`;

function envAddr(key: string): `0x${string}` {
  const raw =
    typeof process !== "undefined"
      ? (process.env as Record<string, string | undefined>)[key]
      : undefined;
  if (raw && raw.startsWith("0x") && raw.length === 42) {
    return getAddress(raw) as `0x${string}`;
  }
  return ZERO;
}

export const VAULT_ADDRESS = envAddr("NEXT_PUBLIC_VAULT_ADDRESS");
export const RECEIPT_TOKEN_ADDRESS = envAddr(
  "NEXT_PUBLIC_RECEIPT_TOKEN_ADDRESS",
);
export const FACTORY_ADDRESS = envAddr("NEXT_PUBLIC_FACTORY_ADDRESS");
export const PAIR_FACTORY_ADDRESS = envAddr(
  "NEXT_PUBLIC_PAIR_FACTORY_ADDRESS",
);
export const USDG_ADDRESS = envAddr("NEXT_PUBLIC_USDG_ADDRESS");
export const LAUNCHPAD_ZAP_ADDRESS = envAddr(
  "NEXT_PUBLIC_LAUNCHPAD_ZAP_ADDRESS",
);
export const WRHT_ADDRESS = envAddr("NEXT_PUBLIC_WETH_ADDRESS");
export const WETH_ADDRESS = WRHT_ADDRESS;

/** Factory deployed — resolves vaults per deposit asset (tTSLA-B, etc.) */
export const factoryReady = FACTORY_ADDRESS !== ZERO;

/** Pair launchpad deployed */
export const pairFactoryReady = PAIR_FACTORY_ADDRESS !== ZERO;

/** Launchpad Zap deployed — enables non-USDG payment sources */
export const launchpadZapReady = LAUNCHPAD_ZAP_ADDRESS !== ZERO;

/** Legacy single-vault mode (backward compatible) */
export const contractsReady =
  factoryReady || (VAULT_ADDRESS !== ZERO && RECEIPT_TOKEN_ADDRESS !== ZERO);

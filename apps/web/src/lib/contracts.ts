import { getAddress, type Abi } from "viem";
import { isHexAddress, isTestnetMode, testnetDeployment } from "@novex/config";
import strategyVaultAbiJson from "./abis/StrategyVault.json";
import receiptTokenAbiJson from "./abis/ReceiptToken.json";
import vaultFactoryAbiJson from "./abis/VaultFactory.json";
import oracleAdapterAbiJson from "./abis/OracleAdapter.json";
import pairFactoryAbiJson from "./abis/PairFactory.json";
import pairVaultAbiJson from "./abis/PairVault.json";
import pairRouterAbiJson from "./abis/PairRouter.json";
import oracleSwapRouterAbiJson from "./abis/OracleSwapRouter.json";
import testUsdgAbiJson from "./abis/TestUSDG.json";
import novexCurveAbiJson from "./abis/NovexCurve.json";
import curveRouterAbiJson from "./abis/CurveRouter.json";

export const strategyVaultAbi = strategyVaultAbiJson as Abi;
export const receiptTokenAbi = receiptTokenAbiJson as Abi;
export const vaultFactoryAbi = vaultFactoryAbiJson as Abi;
export const oracleAdapterAbi = oracleAdapterAbiJson as Abi;
export const pairFactoryAbi = pairFactoryAbiJson as Abi;
export const pairVaultAbi = pairVaultAbiJson as Abi;
export const pairRouterAbi = pairRouterAbiJson as Abi;
/** Testnet-only oracle-priced stand-in for Uniswap SwapRouter02 (also serves quotes). */
export const oracleSwapRouterAbi = oracleSwapRouterAbiJson as Abi;
export const testUsdgAbi = testUsdgAbiJson as Abi;
export const novexCurveAbi = novexCurveAbiJson as Abi;
export const curveRouterAbi = curveRouterAbiJson as Abi;

/** ERC-20 subset used across the app. */
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

const ZERO = "0x0000000000000000000000000000000000000000" as `0x${string}`;

function addr(value: string | undefined): `0x${string}` {
  return isHexAddress(value) ? (getAddress(value) as `0x${string}`) : ZERO;
}

const testnet = isTestnetMode() ? testnetDeployment() : null;

/*
 * On testnet the synced deployment file (`pnpm sync:testnet`) is the only
 * source of addresses, so stale env vars can never point the app at contracts
 * that don't exist on this chain. Env vars (referenced statically so Next.js
 * inlines them) configure mainnet.
 */
export const PAIR_FACTORY_ADDRESS = testnet
  ? addr(testnet.contracts.pairFactory)
  : addr(process.env.NEXT_PUBLIC_PAIR_FACTORY_ADDRESS);
export const ORACLE_ADDRESS = testnet
  ? addr(testnet.contracts.oracle)
  : addr(process.env.NEXT_PUBLIC_ORACLE_ADAPTER_ADDRESS);
export const WETH_ADDRESS = testnet
  ? addr(testnet.tokens.WETH)
  : addr(process.env.NEXT_PUBLIC_WETH_ADDRESS);

/** Buy/sell pairs with USDG or ETH (PairRouter). */
export const PAIR_ROUTER_ADDRESS = testnet
  ? addr(testnet.contracts.pairRouter)
  : addr(process.env.NEXT_PUBLIC_PAIR_ROUTER_ADDRESS);
/** Swap venue PairRouter trades through: the oracle-priced test router on testnet, Uniswap on mainnet. */
export const SWAP_ROUTER_ADDRESS = testnet
  ? addr(testnet.contracts.swapRouter)
  : addr(process.env.NEXT_PUBLIC_UNISWAP_V3_ROUTER);
export const USDG_ADDRESS = testnet
  ? addr(testnet.contracts.usdg)
  : addr(process.env.NEXT_PUBLIC_USDG_ADDRESS);

/** Bonding-curve creator tokens (NovexCurve) and their ETH/USDG router. */
export const NOVEX_CURVE_ADDRESS = testnet
  ? addr(testnet.contracts.novexCurve)
  : addr(process.env.NEXT_PUBLIC_NOVEX_CURVE_ADDRESS);
export const CURVE_ROUTER_ADDRESS = testnet
  ? addr(testnet.contracts.curveRouter)
  : addr(process.env.NEXT_PUBLIC_CURVE_ROUTER_ADDRESS);

/** Managed-basket contracts are mainnet-only (they need DEX liquidity). */
export const FACTORY_ADDRESS = testnet ? ZERO : addr(process.env.NEXT_PUBLIC_FACTORY_ADDRESS);
export const VAULT_ADDRESS = testnet ? ZERO : addr(process.env.NEXT_PUBLIC_VAULT_ADDRESS);
export const RECEIPT_TOKEN_ADDRESS = testnet
  ? ZERO
  : addr(process.env.NEXT_PUBLIC_RECEIPT_TOKEN_ADDRESS);

/** Pair launchpad deployed on the active network */
export const pairFactoryReady = PAIR_FACTORY_ADDRESS !== ZERO;
export const oracleReady = ORACLE_ADDRESS !== ZERO;
export const usdgReady = USDG_ADDRESS !== ZERO;
/** USDG/ETH buy & sell is live on this network */
export const pairRouterReady = PAIR_ROUTER_ADDRESS !== ZERO && usdgReady && SWAP_ROUTER_ADDRESS !== ZERO;
/**
 * On-chain quotes via the swap venue's `quoteExactInput` view. Only the testnet
 * router exposes it as a view; mainnet Uniswap quoting (QuoterV2) is not wired yet.
 */
export const swapQuotesReady = testnet !== null && pairRouterReady;
/** Creator tokens can be launched and traded on this network. */
export const novexCurveReady = NOVEX_CURVE_ADDRESS !== ZERO;
export const curveRouterReady = novexCurveReady && CURVE_ROUTER_ADDRESS !== ZERO && pairRouterReady;

/** Factory deployed — resolves basket vaults per deposit asset (tTSLA-B, etc.) */
export const factoryReady = FACTORY_ADDRESS !== ZERO;

/** Legacy single-vault mode (backward compatible) */
export const contractsReady =
  factoryReady || (VAULT_ADDRESS !== ZERO && RECEIPT_TOKEN_ADDRESS !== ZERO);

/** Managed baskets can be created on this network */
export const basketsAvailable = !testnet && contractsReady;

export function isWeth(token: string | undefined): boolean {
  return !!token && WETH_ADDRESS !== ZERO && token.toLowerCase() === WETH_ADDRESS.toLowerCase();
}

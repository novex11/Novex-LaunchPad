/** Robinhood Chain — Arbitrum Orbit L2 for Stock Tokens */

const alchemyKey = process.env.ALCHEMY_API_KEY ?? "demo";

export const robinhoodChain = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.ROBINHOOD_RPC_URL ??
          `https://rpc.mainnet.chain.robinhood.com`,
      ],
    },
    alchemy: {
      http: [
        `https://robinhood-chain-mainnet.g.alchemy.com/v2/${alchemyKey}`,
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Explorer",
      url: "https://robinhoodchain.blockscout.com",
    },
  },
  testnet: false,
} as const;

export const robinhoodTestnet = {
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.ROBINHOOD_TESTNET_RPC_URL ??
          "https://rpc.testnet.chain.robinhood.com",
      ],
    },
    alchemy: {
      http: [
        `https://robinhood-chain-testnet.g.alchemy.com/v2/${alchemyKey}`,
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Testnet Explorer",
      url: "https://explorer.testnet.chain.robinhood.com",
    },
  },
  testnet: true,
} as const;

// ─── Canonical mainnet contract addresses ───────────────

/** USDG stablecoin (Global Dollar) — 6 decimals, Paxos-issued */
export const USDG_ADDRESS =
  "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;

/** Wrapped ETH on Robinhood Chain */
export const WETH_ADDRESS =
  "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as const;

/** Uniswap V3 SwapRouter02 — canonical deployment */
export const UNISWAP_V3_ROUTER =
  "0xCaf681a66D020601342297493863E78C959E5cb2" as const;

/** Uniswap V3 Factory */
export const UNISWAP_V3_FACTORY =
  "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA" as const;

/** Uniswap V3 QuoterV2 */
export const UNISWAP_V3_QUOTER =
  "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7" as const;

/** USDG decimals on Robinhood Chain (different from stock tokens which are 18) */
export const USDG_DECIMALS = 6 as const;

// ─── API endpoints ──────────────────────────────────────

export const RHJ_ASSETS_API = "https://api.robinhood.com/rhj/assets";
export const RHJ_CORPORATE_ACTIONS_API =
  "https://api.robinhood.com/rhj/corporate-actions";

export const ORACLE_STALENESS_SECONDS = 3600;

/** Official faucet for testnet ETH and Stock Tokens */
export const TESTNET_FAUCET_URL = "https://faucet.testnet.chain.robinhood.com";

/** Canonical WETH on Robinhood Chain Testnet */
export const TESTNET_WETH_ADDRESS =
  "0x7943e237c7F95DA44E0301572D358911207852Fa" as const;
export const MULTIPLIER_SAFETY_WINDOW_SECONDS = 300;

// ─── Rialto Swap API (production execution venue) ─────

/** Rialto trade API base URL */
export const RIALTO_API_URL = "https://rialto-trade-api.rialto.xyz";

/** Robinhood Chain ID used in Rialto requests */
export const RIALTO_CHAIN_ID = 4663;

/**
 * Known Rialto contract addresses on Robinhood Chain.
 * The RialtoRouter settles all swaps atomically on-chain.
 * WETH is the wrapped native token used for ETH swaps.
 */
export const RIALTO_CONTRACTS = {
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as `0x${string}`,
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as `0x${string}`,
} as const;

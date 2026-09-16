import type { DocPage } from "../registry";
import { Callout, Code, C, Table, Pill } from "@/components/docs/docs-ui";

export const contracts: DocPage = {
  slug: "reference/contracts",
  href: "/docs/reference/contracts",
  title: "Smart contracts",
  description: "Every contract in packages/contracts/src, its role, access control and the revert reasons you may see.",
  sections: [
    {
      id: "baskets",
      title: "Basket stack",
      keywords: ["StrategyVault", "VaultFactory", "ReceiptToken", "AllocationController", "CashbackReserve", "ExecutionRouter", "EmergencyRegistry"],
      body: (
        <Table
          head={["Contract", "Role", "Access"]}
          mono={[0]}
          rows={[
            ["VaultFactory", "Creates a StrategyVault + ReceiptToken per (deposit asset, strategy); vaultByKey lookup", "owner"],
            ["StrategyVault", "deposit(params) validates, prices, swaps legs and mints shares; redeem(shares, mode, minOut)", "public"],
            ["ReceiptToken", "Non-transferable share token; mint/burn only by its vault", "vault"],
            ["AllocationController", "Approved assets, weights sum to 10,000 bps, per-strategy max single stock", "owner sets, anyone reads"],
            ["ExecutionRouter", "Routes basket swaps through the configured swap router; pausable", "authorised vaults"],
            ["CashbackReserve", "Pays Stockback within floor, budget, wallet cap and duplicate guard", "authorised vaults"],
            ["EmergencyRegistry", "Independent pause switches for deposits, swaps, rebalances, cashback", "owner"],
          ]}
        />
      ),
    },
    {
      id: "launchpad-contracts",
      title: "Launchpad stack",
      keywords: ["PairFactory", "PairDeployer", "PairVault", "PairRouter", "ComposeCurve", "CurveRouter"],
      body: (
        <Table
          head={["Contract", "Role", "Access"]}
          mono={[0]}
          rows={[
            ["PairFactory", "launchPair / launchPairWithPool; token listing; pool config; poolIdOf / poolKeyOf / poolPositionOf", "launch is permissionless; listing and pool config are owner"],
            ["PairDeployer", "Deploys each PairVault so the factory stays under the 24 KB limit", "factory"],
            ["PairVault", "Two-token in-kind vault that is its own transferable ERC-20 share: deposit, depositFor, redeem, redeemFrom (ERC-20 allowance), quotes and NAV. Shares are minted only against deposits and burned only by their holder", "public"],
            ["PairRouter", "Buy pairs with USDG or ETH and sell back, with oracle-floored slippage", "public"],
            ["ComposeCurve / CurveRouter", "Testnet creator tokens on a constant-product curve quoted in the pair share", "public"],
          ]}
        />
      ),
    },
    {
      id: "oracle-stack",
      title: "Oracle stack",
      keywords: ["OracleAdapter", "PushPriceFeed", "PriceFeedUpdater"],
      body: (
        <Table
          head={["Contract", "Role"]}
          mono={[0]}
          rows={[
            ["OracleAdapter", "Token → feed registry; getPrice (stale-checked), getPriceUnchecked, getTokenValueUsd, isMultiplierPending"],
            ["PushPriceFeed", "Chainlink-shaped feed updated by a keeper (testnet)"],
            ["PriceFeedUpdater", "Batch pushPrices for a keeper allow-list"],
          ]}
        />
      ),
    },
    {
      id: "revert-reasons",
      title: "Revert reasons",
      keywords: ["errors", "stale", "weight mismatch", "slippage", "unapproved asset"],
      body: (
        <Table
          head={["Reason", "Where", "Meaning"]}
          mono={[0]}
          rows={[
            ["OracleAdapter: stale", "any stale-checked read", "Feed older than the staleness threshold; run the keeper"],
            ["OracleAdapter: no feed", "listing, pricing", "Token has no registered feed"],
            ["AllocationController: unapproved asset", "basket deposit", "A basket line is not approved on this network"],
            ["AllocationController: weights must sum to 100%", "basket deposit", "Basis points do not total 10,000"],
            ["Max single stock exceeded", "basket deposit", "A line is above the strategy cap"],
            ["StrategyVault: multiplier pending / PairVault: multiplier pending", "deposits", "A stock split is scheduled; retry after it applies"],
            ["PairVault: weight mismatch", "launch seed", "Seed value split is more than 3% off the target weight"],
            ["PairVault: seed too small", "launch seed", "Seed worth less than $1"],
            ["PairFactory: exists", "launch", "That sorted pair already has a vault"],
            ["PairFactory: quote amount", "pool launch", "USDG needed for the pool exceeds your cap"],
            ["PairFactory: pool disabled", "pool launch", "Pool seeding is not configured on this factory"],
          ]}
        />
      ),
    },
  ],
};

export const addresses: DocPage = {
  slug: "reference/addresses",
  href: "/docs/reference/addresses",
  title: "Deployed addresses",
  description: "Live contract addresses per network. Testnet values are synced into the app from deployments-testnet.json.",
  sections: [
    {
      id: "testnet",
      title: "Robinhood Chain testnet (46630)",
      keywords: ["testnet addresses", "pair factory", "oracle", "usdg"],
      body: (
        <>
          <Table
            head={["Contract", "Address"]}
            mono={[1]}
            rows={[
              ["PairFactory", "0x15227319f1C9413004D9B639A2b3363e54DCbc16"],
              ["PairRouter", "0xe8d157Ff1E6d74809f6cF17D7eded59302117E3A"],
              ["OracleAdapter", "0xd41aADa55e57878696d4d74a310A0cBBC847279C"],
              ["EmergencyRegistry", "0xE37892736cb2d865B687953540BfE272e0912C1f"],
              ["PriceFeedUpdater", "0x2C7e4386eB96f02665CFe446Ed54f25e95c7300a"],
              ["Test USDG", "0x5817D7934ecf0da56C96E3CC9DD8a685376D382B"],
              ["ComposeCurve", "0x06fA411b8aa5f8Cb539A470d076562F3Ec45f977"],
              ["CurveRouter", "0x25FF6e6c6e37D1A9A1467797b71D5FB6FDe9660d"],
            ]}
          />
          <Table
            head={["Faucet stock token", "Address"]}
            mono={[1]}
            rows={[
              ["TSLA", "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E"],
              ["AMZN", "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02"],
              ["AMD", "0x71178BAc73cBeb415514eB542a8995b82669778d"],
              ["PLTR", "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0"],
              ["NFLX", "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93"],
              ["WETH", "0x7943e237c7F95DA44E0301572D358911207852Fa"],
            ]}
          />
          <Callout type="note">
            Source of truth is <C>packages/config/src/testnet-deployments.json</C>, written by <C>pnpm sync:testnet</C> after a deploy.
          </Callout>
        </>
      ),
    },
    {
      id: "uniswap-v4",
      title: "Uniswap v4 (testnet and mainnet)",
      keywords: ["pool manager", "position manager", "permit2", "state view"],
      body: (
        <Table
          head={["Contract", "Address"]}
          mono={[1]}
          rows={[
            ["PoolManager", "0x8366a39cc670b4001a1121b8f6a443a643e40951"],
            ["PositionManager", "0x58daec3116aae6d93017baaea7749052e8a04fa7"],
            ["StateView", "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b"],
            ["V4 Quoter", "0x8dc178efb8111bb0973dd9d722ebeff267c98f94"],
            ["Universal Router", "0x8876789976decbfcbbbe364623c63652db8c0904"],
            ["Permit2", "0x000000000022D473030F116dDEE9F6B43aC78BA3"],
          ]}
        />
      ),
    },
    {
      id: "mainnet",
      title: "Robinhood Chain mainnet (4663)",
      keywords: ["mainnet addresses", "usdg", "weth", "stock tokens", "doppler"],
      body: (
        <>
          <Table
            head={["Asset", "Address"]}
            mono={[1]}
            rows={[
              ["USDG (6 decimals)", "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"],
              ["WETH", "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"],
              ["NVDA", "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC"],
              ["AAPL", "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9"],
              ["MSFT", "0xe93237C50D904957Cf27E7B1133b510C669c2e74"],
              ["TSLA", "0x322F0929c4625eD5bAd873c95208D54E1c003b2d"],
              ["Doppler Airlock", "0xeb7C034704eF8Dcd2D32324c1545f62fB4aD0862"],
            ]}
          />
          <Table
            head={["Compose contract", "Address"]}
            mono={[1]}
            rows={[
              ["ComposeCurve", "0x1D85caDc8A15d6E4E16574a14dF44Ecd55eA489f"],
              ["CurveRouter", "0xbDeb514dFb936d22C61100Ae20387E7542d97CeB"],
            ]}
          />
          <p>
            The remaining mainnet contracts (pair factory, baskets, oracle) are published here once deployed. <Pill tone="gold">pending</Pill>
          </p>
        </>
      ),
    },
  ],
};

export const api: DocPage = {
  slug: "reference/api",
  href: "/docs/reference/api",
  title: "Services API",
  description: "HTTP endpoints exposed by the indexer, allocator and quote services.",
  sections: [
    {
      id: "indexer",
      title: "Indexer",
      keywords: ["portfolio", "activity", "launchpad", "candles", "stream", "sse"],
      body: (
        <>
          <Table
            head={["Endpoint", "Description"]}
            mono={[0]}
            rows={[
              ["GET /health", "Service status and storage mode"],
              ["GET /portfolio/:wallet", "Basket position, allocation, Stockback and direct holdings"],
              ["GET /activity/:wallet", "Ledger of deposits, redemptions, trades and rewards"],
              ["POST /deposits · /redeems · /trades", "Record an action after its transaction confirms"],
              ["GET /launchpad/pairs · /launchpad/stats", "Launched pairs with TVL, depositors and creator earnings"],
              ["GET /launchpad/pair/:address", "One pair with metadata and recent activity"],
              ["GET /launchpad/pair/:address/history?range=1h|24h|7d|30d|all", "NAV and share-price points"],
              ["GET /launchpad/pair/:address/candles?interval=1m|5m|15m|1h&metric=sharePrice|navUsd", "OHLC candles from on-chain snapshots"],
              ["GET /launchpad/pair/:address/stream", "Server-sent events: a snapshot on every trade or price move"],
              ["GET /launchpad/pair/:address/tokens", "Creator tokens launched on a pair"],
              ["GET /launchpad/tokens · /launchpad/token/:address", "Creator token listing and detail, with candles and a live stream"],
              ["POST /launchpad/launch · /launchpad/upload-image", "Signed metadata and cover images for a pair"],
            ]}
          />
          <Code
            title="Example"
            code={`curl "http://localhost:3003/launchpad/pair/0xf7ef.../candles?interval=5m&metric=sharePrice"
# {"interval":"5m","metric":"sharePrice","candles":[{"time":"2026-09-14T19:35:00.000Z","open":1,"high":1.0025,"low":1,"close":1.0025}, ...]}`}
          />
        </>
      ),
    },
    {
      id: "allocator",
      title: "Allocator",
      keywords: ["preview", "rebalance", "tokens"],
      body: (
        <>
          <Table
            head={["Endpoint", "Description"]}
            mono={[0]}
            rows={[
              ["GET /tokens", "Token universe the allocator resolves on this network"],
              ["POST /preview", "Allocation, Stockback and cost estimate for a deposit; header x-wallet-address applies the wallet's lifetime cap"],
              ["POST /rebalance/simulate", "Re-run the allocation for an existing vault's TVL"],
            ]}
          />
          <Code
            title="POST /preview"
            code={`{
  "depositTicker": "NVDA",
  "depositUsd": 500,
  "strategy": "balanced",
  "preferred": ["AAPL", "MSFT"],
  "excluded": [],
  "maxTokens": 5
}`}
            lang="json"
          />
        </>
      ),
    },
    {
      id: "quote",
      title: "Quote",
      keywords: ["estimate-deposit-costs", "rialto"],
      body: (
        <Table
          head={["Endpoint", "Description"]}
          mono={[0]}
          rows={[
            ["POST /quote", "Swap quote through Rialto when configured, otherwise a published formula"],
            ["POST /estimate-deposit-costs", "Gas and market cost estimate for a basket deposit"],
          ]}
        />
      ),
    },
  ],
};

export const config: DocPage = {
  slug: "reference/config",
  href: "/docs/reference/config",
  title: "Configuration",
  description: "The shared config package.",
  sections: [
    {
      id: "config-package",
      title: "The config package",
      keywords: ["strategies", "cashback", "launchpad config", "tokens", "basket config"],
      body: (
        <>
          <p>
            <C>@compose/config</C> is the single source of shared constants. Apps and services consume its build output, so
            run <C>pnpm --filter @compose/config build</C> after editing it.
          </p>
          <Table
            head={["Module", "Contains"]}
            mono={[0]}
            rows={[
              ["chain.ts", "Chain definitions, USDG, WETH and Uniswap addresses"],
              ["tokens.ts", "Mainnet stock token registry and the testnet faucet list, categories, trading hours"],
              ["strategies.ts", "Category bands, single-stock caps, retention per strategy"],
              ["cashback.ts", "Stockback floor, bonus bands, per-ticker rates, lifetime cap"],
              ["basket.ts", "Minimum basket deposit per network and amount presets"],
              ["launchpad.ts", "Weight and fee ranges, seed presets, pool defaults"],
              ["testnet.ts", "Loader for testnet-deployments.json"],
            ]}
          />
        </>
      ),
    },
  ],
};

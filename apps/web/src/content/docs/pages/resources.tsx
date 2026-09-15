import Link from "next/link";
import type { DocPage } from "../registry";
import { Callout, C, Table } from "@/components/docs/docs-ui";

export const security: DocPage = {
  slug: "security",
  href: "/docs/security",
  title: "Security & risk",
  description: "What protects users on chain, what is still unaudited, and the risks that no contract can remove.",
  sections: [
    {
      id: "on-chain-protections",
      title: "On-chain protections",
      keywords: ["reentrancy", "pause", "caps", "slippage", "oracle"],
      body: (
        <ul>
          <li>Reentrancy guards on every vault and factory entry point.</li>
          <li>Allocation rules and single-stock caps enforced by the AllocationController, not just the UI.</li>
          <li>Pause switches for deposits, swaps, rebalances and cashback, independent of each other.</li>
          <li>Redemptions never depend on oracle freshness and cannot be paused by a stale feed.</li>
          <li>Pair launches require fresh prices and a seed within 3% of the target weight, so a pool cannot open at a wrong price.</li>
          <li>Pool seeding prices the pool at vault NAV and hands the LP position to the creator; the factory holds nothing after the transaction.</li>
        </ul>
      ),
    },
    {
      id: "status",
      title: "Audit status",
      keywords: ["audit", "unaudited", "testnet"],
      body: (
        <Callout type="warning" title="Unaudited">
          Compose contracts have not been independently audited. The pair launchpad is live on Robinhood Chain testnet only.
          Do not use mainnet deployments with funds you cannot afford to lose until an audit report is published here.
        </Callout>
      ),
    },
    {
      id: "market-risks",
      title: "Market risks",
      keywords: ["stock split", "market hours", "liquidity", "nav drift"],
      body: (
        <Table
          head={["Risk", "What it means"]}
          rows={[
            ["Tokenized stock mechanics", "Robinhood stock tokens follow the underlying share, including splits handled through ERC-8056 multipliers. Deposits pause while a multiplier change is pending."],
            ["Trading hours", "Pair shares can trade on a DEX around the clock, but the underlying stock tokens have market windows. Redemption into stocks is most useful when those windows are open."],
            ["Pool price vs NAV", "A thin pool can trade away from NAV. In-kind redemption gives arbitrage a way to pull it back, but there can be a gap."],
            ["Redemption value", "Redeeming a basket returns current basket value, not the original quantity of the deposit stock."],
          ]}
        />
      ),
    },
    {
      id: "disclosures",
      title: "Disclosures",
      body: (
        <p>
          Read the <Link href="/legal/risk">risk disclosures</Link>, <Link href="/legal/terms">terms</Link> and{" "}
          <Link href="/legal/privacy">privacy policy</Link>.
        </p>
      ),
    },
  ],
};

export const faq: DocPage = {
  slug: "faq",
  href: "/docs/faq",
  title: "FAQ",
  description: "Short answers to the questions we hear most.",
  sections: [
    {
      id: "why-cant-i-confirm",
      title: "Why can't I confirm a basket?",
      keywords: ["disabled button", "allocator", "violation"],
      body: (
        <p>
          The button enables only when the allocator has returned a live preview, the basket has no rule violations, the
          indexer is reachable and a vault exists for your deposit asset and strategy on this network. The summary card
          tells you which of these is missing.
        </p>
      ),
    },
    {
      id: "stale-price",
      title: "The app says it cannot determine the deposit token price",
      keywords: ["stale", "keeper", "oracle"],
      body: (
        <p>
          The oracle feed for that token is older than one hour. On testnet this means the price keeper is not running; on
          mainnet it would indicate a Chainlink outage. Existing positions still redeem normally.
        </p>
      ),
    },
    {
      id: "pool-toggle-disabled",
      title: "The DEX pool toggle says it is not enabled",
      keywords: ["pool disabled", "setPoolConfig"],
      body: (
        <p>
          Pool seeding is switched on per factory by its owner with <C>setPoolConfig</C>. Until it is configured, launches
          create the vault and share token without a pool. You can still launch and add liquidity manually later.
        </p>
      ),
    },
    {
      id: "will-my-pair-show-on-axiom",
      title: "Will my pair show on Axiom or DexScreener?",
      keywords: ["axiom", "dexscreener", "visibility"],
      body: (
        <p>
          On mainnet, a pair launched with pool seeding creates a real Uniswap v4 pool, which those terminals index. A pair
          launched without a pool is not visible to them until a pool exists. See{" "}
          <Link href="/docs/dex-pools">DEX pools &amp; visibility</Link>.
        </p>
      ),
    },
    {
      id: "fees",
      title: "What does Compose charge?",
      keywords: ["fees", "platform fee"],
      body: (
        <p>
          There is no platform fee on basket deposits. Pair creators set a 1–5% creator fee that applies to other people's
          deposits into their pair. DEX swaps pay the pool's 0.30% fee to liquidity providers.
        </p>
      ),
    },
  ],
};

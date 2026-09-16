import Link from "next/link";
import { Stack, Rocket, ChartLineUp, Gift, Terminal, Cube } from "@phosphor-icons/react/dist/ssr";
import type { DocPage } from "../registry";
import { Callout, Code, C, Cards, Card, Steps, Step, Figure, Table } from "@/components/docs/docs-ui";
import { ArchitectureDiagram } from "@/components/docs/diagrams";

export const introduction: DocPage = {
  slug: "",
  href: "/docs",
  title: "Compose documentation",
  description:
    "Compose is an onchain protocol on Robinhood Chain for tokenized stocks: deposit one stock and receive a managed basket with Stockback rewards, or launch a stock × stock pair that anyone can trade.",
  sections: [
    {
      id: "what-is-compose",
      title: "What is Compose?",
      keywords: ["overview", "robinhood chain", "tokenized stocks", "baskets", "launchpad"],
      body: (
        <>
          <p>
            Compose runs on <strong>Robinhood Chain</strong>, an Ethereum L2 where Robinhood issues tokenized US stocks as
            ERC-20 tokens. Compose gives those tokens two things they do not have on their own: a way to hold a{" "}
            <em>managed, diversified position</em> from a single deposit, and a way to <em>create new tradable assets</em>{" "}
            out of pairs of stocks.
          </p>
          <Figure src="/docs/home.png" alt="Compose landing page" caption="The Compose app: deposit one stock, own the market." />
          <Cards>
            <Card href="/docs/baskets" title="Managed baskets" description="Deposit NVDA, receive a basket of stocks built to a strategy, plus Stockback rewards. Redeem any time." icon={<Stack size={16} weight="bold" />} />
            <Card href="/docs/launchpad" title="Pair launchpad" description="Pair any two listed stocks into a vault with a transferable share token, listed on Uniswap v4 from block one." icon={<Rocket size={16} weight="bold" />} />
            <Card href="/docs/stockback" title="Stockback" description="1% of every qualifying deposit plus per-stock rewards, vesting for 7 days and then claimable in tokens." icon={<Gift size={16} weight="bold" />} />
            <Card href="/docs/dex-pools" title="DEX visibility" description="Why pair shares live in real Uniswap v4 pools, and what that means for Axiom and DexScreener." icon={<ChartLineUp size={16} weight="bold" />} />
          </Cards>
        </>
      ),
    },
    {
      id: "how-it-fits-together",
      title: "How it fits together",
      keywords: ["architecture", "services", "contracts", "indexer", "allocator"],
      body: (
        <>
          <p>
            The product is a Next.js app backed by three small services and a set of Foundry contracts. Wallets connect
            through Privy; every value-bearing action is an on-chain transaction the user signs.
          </p>
          <Figure caption="High-level architecture. See the Architecture page for the full picture.">
            <div className="p-4">
              <ArchitectureDiagram />
            </div>
          </Figure>
          <Table
            head={["Layer", "What it does", "Where"]}
            rows={[
              ["Web app", "Basket builder, launchpad, markets, portfolio, this documentation", <C key="w">apps/web</C>],
              ["Allocator", "Turns a deposit + strategy into a concrete allocation and Stockback preview", <C key="a">services/allocator</C>],
              ["Quote", "Estimates swap and gas costs; talks to Rialto when configured", <C key="q">services/quote</C>],
              ["Indexer", "Ledger, portfolio, launchpad metadata, NAV candles and live streams", <C key="i">services/indexer</C>],
              ["Contracts", "Strategy vaults, pair vaults, oracles, price feeds", <C key="c">packages/contracts</C>],
            ]}
          />
        </>
      ),
    },
    {
      id: "next-steps",
      title: "Next steps",
      body: (
        <Cards>
          <Card href="/docs/quickstart" title="Quickstart" description="Run the whole stack on your machine in a few minutes." icon={<Terminal size={16} weight="bold" />} />
          <Card href="/docs/reference/contracts" title="Contract reference" description="Every contract, its role, key functions and revert reasons." icon={<Cube size={16} weight="bold" />} />
        </Cards>
      ),
    },
  ],
};

export const quickstart: DocPage = {
  slug: "quickstart",
  href: "/docs/quickstart",
  title: "Quickstart",
  description: "Get the web app, services and contracts running locally against Robinhood Chain testnet.",
  sections: [
    {
      id: "prerequisites",
      title: "Prerequisites",
      keywords: ["node", "pnpm", "foundry", "docker", "requirements"],
      body: (
        <Table
          head={["Tool", "Version", "Notes"]}
          rows={[
            ["Node.js", "20 or newer", "The workspace pins pnpm through packageManager"],
            ["pnpm", "9.15", <><C>corepack enable</C> installs it automatically</>],
            ["Foundry", "stable", "Only needed to build, test or deploy contracts"],
            ["Docker", "optional", "Runs Postgres, Redis and the three services as containers"],
          ]}
        />
      ),
    },
    {
      id: "install",
      title: "Install and configure",
      keywords: ["install", "privy", "rpc"],
      body: (
        <>
          <Steps>
            <Step title="Clone and install">
              <Code code={`git clone https://github.com/novex11/Basket-protocol.git
cd Basket-protocol
pnpm install`} />
            </Step>
            <Step title="Create your environment file">
              <p>Copy the example file and fill in your own values. Keep it local; it is never committed.</p>
              <Code code={`cp .env.example .env`} />
            </Step>
            <Step title="Build the shared packages">
              <p>The web app and services import the config and SDK packages from their build output.</p>
              <Code code={`pnpm --filter @compose/config build && pnpm --filter @compose/sdk build`} />
            </Step>
          </Steps>
        </>
      ),
    },
    {
      id: "run",
      title: "Run everything",
      keywords: ["dev server", "docker compose", "ports"],
      body: (
        <>
          <p>The simplest path runs the backends in Docker and the web app on your machine.</p>
          <Code
            title="Backends in Docker, web on the host"
            code={`pnpm docker:up            # indexer :3003, allocator :3001, quote :3002, redis
pnpm --filter @compose/web dev   # web on http://localhost:3000`}
          />
          <p>Or run every process with the turbo dev pipeline, plus the testnet price keeper:</p>
          <Code code={`pnpm dev:testnet`} />
          <Table
            head={["Service", "URL"]}
            rows={[
              ["Web app", <C key="1">http://localhost:3000</C>],
              ["Allocator", <C key="2">http://localhost:3001</C>],
              ["Quote", <C key="3">http://localhost:3002</C>],
              ["Indexer", <C key="4">http://localhost:3003</C>],
            ]}
          />
        </>
      ),
    },
    {
      id: "verify",
      title: "Verify",
      keywords: ["health", "tests", "forge", "typecheck"],
      body: (
        <>
          <Code
            code={`curl http://localhost:3003/health      # {"status":"ok",...}
pnpm typecheck                          # all packages
cd packages/contracts && forge test     # contract suite`}
          />
          <p>
            Open the app, connect a wallet on Robinhood Chain testnet and visit <Link href="/create">Create</Link> or{" "}
            <Link href="/launch">Launch</Link>. Test stock tokens come from the Robinhood faucet.
          </p>
        </>
      ),
    },
  ],
};

export const architecture: DocPage = {
  slug: "architecture",
  href: "/docs/architecture",
  title: "Architecture",
  description: "How the web app, services and contracts share responsibility, and which data comes from where.",
  sections: [
    {
      id: "overview",
      title: "Overview",
      keywords: ["diagram", "system", "components"],
      body: (
        <>
          <Figure caption="Every value-bearing action is an on-chain transaction; services only preview, index and price.">
            <div className="p-4">
              <ArchitectureDiagram />
            </div>
          </Figure>
          <p>
            The design rule is simple: <strong>contracts hold the truth, services make it usable</strong>. The allocator
            proposes an allocation, but the on-chain controller validates it. The indexer records deposits, but the
            vault's NAV is read from chain. If every service were offline, deposits and redemptions would still work.
          </p>
        </>
      ),
    },
    {
      id: "monorepo",
      title: "Monorepo layout",
      keywords: ["packages", "apps", "services", "turbo"],
      body: (
        <Table
          head={["Path", "Contents"]}
          mono={[0]}
          rows={[
            ["apps/web", "Next.js 15 app: markets, create, launch, launchpad, pair, portfolio, docs"],
            ["apps/admin", "Internal admin surface"],
            ["services/indexer", "Hono API + Postgres/Redis: ledger, portfolio, launchpad, candles, SSE streams"],
            ["services/allocator", "Hono API wrapping @compose/sdk: previews and rebalance simulation"],
            ["services/quote", "Hono API: swap cost estimates via Rialto or a formula fallback"],
            ["packages/contracts", "Foundry project: vaults, factories, oracle, feeds, tests, deploy scripts"],
            ["packages/config", "Chain, token registry, strategies, Stockback and launchpad parameters"],
            ["packages/sdk", "Allocation engine, Stockback math, preview builder, schemas"],
            ["scripts", "Price keeper, testnet deploy and sync, smoke tests"],
          ]}
        />
      ),
    },
    {
      id: "data-sources",
      title: "Data sources",
      keywords: ["oracle", "yahoo", "rialto", "chainlink", "prices"],
      body: (
        <>
          <p>Three kinds of price exist and they are deliberately kept apart:</p>
          <Table
            head={["Price", "Source", "Used for"]}
            rows={[
              ["On-chain oracle", "OracleAdapter → Chainlink feeds (mainnet) or PushPriceFeed + keeper (testnet)", "Every value calculation in contracts: deposits, NAV, pool seeding"],
              ["Market quote", "Yahoo Finance proxy in the web app, refreshed every 15 s", "Charts, sparklines and display prices in the UI"],
              ["Execution quote", "Rialto swap API through the quote service, formula fallback", "Estimated market and gas costs shown before you confirm"],
            ]}
          />
          <Callout type="note">
            The indexer never invents prices. Its NAV candles and share-price history are snapshots of on-chain reads taken
            on every trade and on a timer.
          </Callout>
        </>
      ),
    },
    {
      id: "networks",
      title: "Networks",
      keywords: ["testnet", "mainnet", "46630", "4663"],
      body: (
        <Table
          head={["Network", "Chain id", "What runs there"]}
          rows={[
            ["Robinhood Chain testnet", "46630", "Pair launchpad on real faucet stock tokens, push price feeds, Uniswap v4, creator tokens on the Compose curve"],
            ["Robinhood Chain mainnet", "4663", "Managed baskets, pair launchpad, Uniswap v4 pools, creator tokens via Doppler"],
          ]}
        />
      ),
    },
  ],
};

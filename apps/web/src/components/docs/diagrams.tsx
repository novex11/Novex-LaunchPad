/* Inline SVG diagrams for the docs. Colours come from design tokens so they
 * read in both themes. Kept dependency-free. */

const box = "fill-[var(--surface)] stroke-[var(--border)]";
const label = "fill-[var(--foreground)] font-medium";
const sub = "fill-[var(--muted-foreground)]";
const line = "stroke-[var(--muted-foreground)]";

function Node({ x, y, w, h, title, subtitle, accent }: { x: number; y: number; w: number; h: number; title: string; subtitle?: string; accent?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10} className={accent ? "fill-[var(--accent-subtle)] stroke-[var(--accent)]" : box} strokeWidth={1} />
      <text x={x + w / 2} y={y + (subtitle ? h / 2 - 4 : h / 2 + 4)} textAnchor="middle" fontSize={12} className={label}>
        {title}
      </text>
      {subtitle && (
        <text x={x + w / 2} y={y + h / 2 + 12} textAnchor="middle" fontSize={10} className={sub}>
          {subtitle}
        </text>
      )}
    </g>
  );
}

function Arrow({ x1, y1, x2, y2, text }: { x1: number; y1: number; x2: number; y2: number; text?: string }) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} className={line} strokeWidth={1} markerEnd="url(#arrow)" />
      {text && (
        <text x={mx} y={my - 6} textAnchor="middle" fontSize={10} className={sub}>
          {text}
        </text>
      )}
    </g>
  );
}

function Defs() {
  return (
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" className="fill-[var(--muted-foreground)]" />
      </marker>
    </defs>
  );
}

/** System overview: wallet → web → services → chain. */
export function ArchitectureDiagram() {
  return (
    <svg viewBox="0 0 760 330" className="block w-full" role="img" aria-label="Compose architecture">
      <Defs />
      <Node x={20} y={130} w={120} h={56} title="Wallet" subtitle="Privy · wagmi" />
      <Node x={200} y={30} w={170} h={56} title="Web app" subtitle="Next.js · /create /launch" accent />
      <Node x={200} y={130} w={170} h={56} title="Allocator" subtitle="/preview · @compose/sdk" />
      <Node x={200} y={230} w={170} h={56} title="Quote" subtitle="/quote · costs" />
      <Node x={430} y={130} w={150} h={56} title="Indexer" subtitle="Postgres · Redis · SSE" />
      <Node x={620} y={30} w={120} h={56} title="StrategyVault" subtitle="baskets" />
      <Node x={620} y={130} w={120} h={56} title="PairVault" subtitle="stock × stock" accent />
      <Node x={620} y={230} w={120} h={56} title="Uniswap v4" subtitle="share / USDG pool" />
      <Arrow x1={140} y1={158} x2={200} y2={70} text="sign" />
      <Arrow x1={285} y1={86} x2={285} y2={130} text="preview" />
      <Arrow x1={285} y1={186} x2={285} y2={230} />
      <Arrow x1={370} y1={58} x2={620} y2={58} text="deposit / redeem" />
      <Arrow x1={370} y1={58} x2={620} y2={150} />
      <Arrow x1={680} y1={186} x2={680} y2={230} text="seed at NAV" />
      <Arrow x1={580} y1={158} x2={370} y2={158} text="events → candles" />
      <Arrow x1={505} y1={130} x2={505} y2={86} />
      <Arrow x1={620} y1={158} x2={580} y2={158} />
      <text x={20} y={310} fontSize={10} className={sub}>
        Prices: OracleAdapter ← Chainlink (mainnet) / PushPriceFeed + keeper (testnet). Quotes for the UI come from a Yahoo Finance proxy.
      </text>
    </svg>
  );
}

/** Basket deposit lifecycle. */
export function BasketFlowDiagram() {
  const steps = [
    ["Deposit", "one stock token"],
    ["Allocator", "strategy bands"],
    ["Validate", "AllocationController"],
    ["Swap legs", "ExecutionRouter"],
    ["Mint", "nTICKER-B receipt"],
    ["Stockback", "CashbackReserve"],
  ];
  return (
    <svg viewBox="0 0 760 120" className="block w-full" role="img" aria-label="Basket deposit flow">
      <Defs />
      {steps.map(([t, s], i) => (
        <g key={t}>
          <Node x={10 + i * 125} y={30} w={110} h={56} title={t} subtitle={s} accent={i === 0 || i === 4} />
          {i < steps.length - 1 && <Arrow x1={120 + i * 125} y1={58} x2={135 + i * 125} y2={58} />}
        </g>
      ))}
    </svg>
  );
}

/** Pair launch with pool seeding. */
export function LaunchFlowDiagram() {
  return (
    <svg viewBox="0 0 760 250" className="block w-full" role="img" aria-label="Pair launch flow">
      <Defs />
      <Node x={20} y={40} w={150} h={56} title="Creator" subtitle="two stock tokens" />
      <Node x={230} y={40} w={170} h={56} title="PairFactory" subtitle="launchPairWithPool" accent />
      <Node x={470} y={20} w={140} h={50} title="PairVault" subtitle="in-kind reserves" />
      <Node x={470} y={95} w={140} h={50} title="PairShareToken" subtitle="transferable" />
      <Node x={470} y={170} w={140} h={50} title="Uniswap v4 pool" subtitle="share / USDG @ NAV" accent />
      <Node x={640} y={170} w={100} h={50} title="Axiom" subtitle="DexScreener" />
      <Arrow x1={170} y1={68} x2={230} y2={68} text="seed + USDG" />
      <Arrow x1={400} y1={60} x2={470} y2={45} text="deposit" />
      <Arrow x1={400} y1={68} x2={470} y2={120} text="mint shares" />
      <Arrow x1={400} y1={76} x2={470} y2={195} text="LP position → creator" />
      <Arrow x1={610} y1={195} x2={640} y2={195} />
      <text x={20} y={235} fontSize={10} className={sub}>
        Redemption is always in kind and never depends on the oracle, so the pool price stays anchored to vault NAV.
      </text>
    </svg>
  );
}

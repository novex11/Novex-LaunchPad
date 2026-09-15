"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatUnits, type Address } from "viem";
import { useReadContract } from "wagmi";
import { ArrowRight, CheckCircle, CircleNotch, Coins, RocketLaunch, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn, explorerUrl, formatUsd } from "@/lib/utils";
import { composeCurveReady, receiptTokenAbi } from "@/lib/contracts";
import { useWallet } from "@/hooks/use-wallet";
import {
  useClaimCurveCreatorFees,
  useCreateCurveToken,
  useCurveOnchain,
  useCurveStartMarketCap,
  usePairCreatorCurveFees,
  usePairCurveToken,
} from "@/hooks/use-curve-token";

const SUPPLY = 10n ** 27n; // 1B × 1e18
const MAX_DEV_BUY_BPS = 500n; // 5% of supply, enforced on-chain
const CURVE_FEE_BPS = 100n; // 1% of every buy, in shares
const DEV_BUY_PRESETS = [0, 1, 2, 3, 5];

export interface PairTokenCardProps {
  pair: Address;
  share: Address;
  isCreator: boolean;
  userShares: bigint;
  sharePriceUsd?: number;
  /** USD (8 decimals) per 1e18 shares, straight from the vault. */
  sharePriceUsd8?: bigint;
  /** The pair's identity — its token launches with exactly this. */
  logoUrl?: string;
  imageUrl?: string;
  displayName: string;
  symbol: string;
  className?: string;
}

/**
 * On a pair page: the pair's single creator token (one per pair, launched by the
 * pair creator with the pair's own name, ticker, logo and banner), and the pair
 * creator's cut of that token's trading fees.
 */
export function PairTokenCard(props: PairTokenCardProps) {
  const { pair, share, isCreator, userShares, sharePriceUsd, sharePriceUsd8, logoUrl, imageUrl, displayName, symbol, className } =
    props;
  const { token, isLoading, refetch } = usePairCurveToken(pair);
  const wallet = useWallet();
  if (!composeCurveReady) return null;

  return (
    <div className={cn("space-y-4", className)}>
      {isCreator && <PairCreatorCurveFees pair={pair} sharePriceUsd={sharePriceUsd} />}

      {token ? (
        <section className="rounded-[1.75rem] border border-accent/50 bg-accent-subtle/40 p-4">
          <p className="flex items-center gap-1.5 px-1 text-xs font-semibold text-accent-strong">
            <RocketLaunch size={14} weight="fill" />
            Pair token
          </p>
          <div className="mt-3">
            <TokenLinkRow token={token} logoUrl={logoUrl} />
          </div>
          <p className="mt-2 px-1 text-[11px] text-muted-foreground">
            One token per pair. It trades on a bonding curve backed by this pair&apos;s stocks.
          </p>
        </section>
      ) : isLoading ? (
        <div className="h-24 animate-pulse rounded-[1.75rem] bg-surface-muted" />
      ) : isCreator && wallet.address ? (
        <CreateTokenCard
          pair={pair}
          share={share}
          userShares={userShares}
          sharePriceUsd={sharePriceUsd}
          sharePriceUsd8={sharePriceUsd8}
          logoUrl={logoUrl}
          imageUrl={imageUrl}
          displayName={displayName}
          symbol={symbol}
          onCreated={() => void refetch()}
        />
      ) : (
        <p className="rounded-[1.5rem] border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          The pair creator hasn&apos;t launched this pair&apos;s token yet.
        </p>
      )}
    </div>
  );
}

function TokenLinkRow({ token, logoUrl }: { token: Address; logoUrl?: string }) {
  const { data } = useCurveOnchain(token);
  const symbol = useReadContract({ address: token, abi: receiptTokenAbi, functionName: "symbol" });
  const mcap = data ? Number(data.marketCapUsd8) / 1e8 : undefined;
  const sym = (symbol.data as string | undefined) ?? "…";
  return (
    <Link
      href={`/token/${token}`}
      className="group flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5 transition-colors hover:border-accent"
    >
      <div className="flex min-w-0 items-center gap-3">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="h-9 w-9 shrink-0 rounded-xl border border-border object-cover" />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-subtle font-mono text-xs font-bold text-accent-strong">
            {sym.slice(0, 2)}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-semibold">${sym}</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {mcap !== undefined ? `${formatUsd(mcap)} mcap` : "Loading…"}
            {data && (data.graduated ? " · graduated" : ` · ${(data.progressBps / 100).toFixed(1)}% to graduation`)}
          </p>
        </div>
      </div>
      <ArrowRight size={14} className="shrink-0 text-accent-strong transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function PairCreatorCurveFees({ pair, sharePriceUsd }: { pair: Address; sharePriceUsd?: number }) {
  const { owed, refetch } = usePairCreatorCurveFees(pair);
  const claimer = useClaimCurveCreatorFees();
  const busy = claimer.stage === "submit";
  const owedUsd = sharePriceUsd != null ? Number(formatUnits(owed, 18)) * sharePriceUsd : undefined;

  async function claim() {
    claimer.reset();
    try {
      await claimer.claimPair(pair);
      void refetch();
    } catch {
      /* shown below */
    }
  }

  return (
    <section className="rounded-[1.75rem] border border-accent/60 bg-accent-subtle/50 p-5 shadow-float">
      <div className="flex items-center gap-2 text-sm font-semibold text-accent-strong">
        <Coins size={16} weight="fill" />
        Token trading fees
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        As pair creator you earn 10% of the 1% trade fee on this pair&apos;s token, on top of the 60% you earn as its
        creator.
      </p>
      <p className="mt-3 font-mono text-2xl font-semibold tabular-nums">{owedUsd != null ? formatUsd(owedUsd) : "—"}</p>
      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
        {Number(formatUnits(owed, 18)).toLocaleString(undefined, { maximumFractionDigits: 6 })} pair shares unclaimed
      </p>
      {claimer.error && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-destructive">
          <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
          {claimer.error}
        </p>
      )}
      {claimer.stage === "done" && claimer.hash && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-success">
          <CheckCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
          <span>
            Claimed to your wallet as pair shares.{" "}
            <a href={explorerUrl("tx", claimer.hash)} target="_blank" rel="noopener noreferrer" className="underline">
              View transaction ↗
            </a>
          </span>
        </p>
      )}
      <Button className="mt-4 w-full" disabled={owed === 0n || busy} onClick={claim}>
        {busy ? (
          <>
            <CircleNotch size={16} className="animate-spin" />
            Claiming…
          </>
        ) : owed === 0n ? (
          "Nothing to claim yet"
        ) : (
          `Claim ${owedUsd != null ? formatUsd(owedUsd) : "fees"}`
        )}
      </Button>
    </section>
  );
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

/**
 * Mirrors ComposeCurve: the whole 1B supply sits on the curve against a virtual
 * quote reserve q0 = startMcap / sharePrice. A dev buy of `sharesIn` shares
 * (1% fee) takes tokensOut = S − ceil(q0·S / (q0 + sharesIn − fee)).
 */
function devBuyMath(q0: bigint, targetBps: bigint) {
  if (q0 <= 0n || targetBps <= 0n) return { sharesIn: 0n, tokensOut: 0n };
  const net = (q0 * targetBps) / (10_000n - targetBps);
  const sharesIn = ceilDiv(net * 10_000n, 10_000n - CURVE_FEE_BPS);
  const fee = (sharesIn * CURVE_FEE_BPS) / 10_000n;
  const newReserve = ceilDiv(q0 * SUPPLY, q0 + sharesIn - fee);
  return { sharesIn, tokensOut: SUPPLY - newReserve };
}

function compactTokens(amount: bigint): string {
  const n = Number(formatUnits(amount, 18));
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function CreateTokenCard({
  pair,
  share,
  userShares,
  sharePriceUsd,
  sharePriceUsd8,
  logoUrl,
  imageUrl,
  displayName,
  symbol,
  onCreated,
}: {
  pair: Address;
  share: Address;
  userShares: bigint;
  sharePriceUsd?: number;
  sharePriceUsd8?: bigint;
  logoUrl?: string;
  imageUrl?: string;
  displayName: string;
  symbol: string;
  onCreated: () => void;
}) {
  const [devPct, setDevPct] = useState("0");
  const [created, setCreated] = useState<Address | null>(null);
  const creator = useCreateCurveToken();
  const startMcap8 = useCurveStartMarketCap();
  const busy = creator.stage === "approve" || creator.stage === "submit";

  const pctNumber = Number(devPct);
  const pctValid = devPct === "" || (Number.isFinite(pctNumber) && pctNumber >= 0);
  const targetBps = pctValid ? BigInt(Math.round(Math.max(0, pctNumber) * 100)) : -1n;

  const sharePrice8 = sharePriceUsd8 ?? (sharePriceUsd ? BigInt(Math.round(sharePriceUsd * 1e8)) : undefined);
  const q0 = startMcap8 && sharePrice8 && sharePrice8 > 0n ? (startMcap8 * 10n ** 18n) / sharePrice8 : undefined;
  const math = useMemo(
    () => (q0 !== undefined && targetBps > 0n ? devBuyMath(q0, targetBps) : { sharesIn: 0n, tokensOut: 0n }),
    [q0, targetBps],
  );
  const sharesUsd = sharePriceUsd ? Number(formatUnits(math.sharesIn, 18)) * sharePriceUsd : undefined;
  const startMcapUsd = startMcap8 ? Number(startMcap8) / 1e8 : undefined;

  const blocker =
    targetBps < 0n
      ? "Dev buy must be a number"
      : targetBps > MAX_DEV_BUY_BPS
        ? "Dev buy is capped at 5% of supply"
        : targetBps > 0n && q0 === undefined
          ? "Waiting for the curve's starting price…"
          : math.sharesIn > userShares
            ? `Not enough pair shares — you hold ${Number(formatUnits(userShares, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })}`
            : null;

  async function create() {
    try {
      const result = await creator.create({
        pair,
        share,
        devBuyShares: math.sharesIn,
        minDevTokens: (math.tokensOut * 99n) / 100n,
      });
      setCreated(result.token);
      onCreated();
    } catch {
      /* shown below */
    }
  }

  return (
    <section className="overflow-hidden rounded-[1.75rem] border border-accent/60 bg-accent-subtle/40 shadow-float">
      {imageUrl && (
        <div className="h-20 w-full overflow-hidden border-b border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        </div>
      )}
      <div className="p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-accent-strong">
          <RocketLaunch size={16} weight="fill" />
          Launch this pair&apos;s token
        </div>

        {/* Identity preview — nothing to type, the token is the pair */}
        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-border bg-surface p-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-11 w-11 shrink-0 rounded-xl border border-border object-cover" />
          ) : (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-subtle font-mono text-sm font-bold text-accent-strong">
              {symbol.slice(0, 2)}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{displayName}</p>
            <p className="font-mono text-xs text-muted-foreground">${symbol}</p>
          </div>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Your token launches as <span className="font-mono font-semibold text-foreground">${symbol}</span> ·{" "}
          <span className="font-semibold text-foreground">{displayName}</span> with this logo and banner. One token per
          pair, only you can launch it.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          1B fixed supply, all of it on the curve — you receive nothing at launch except what your dev buy purchases.
          {startMcapUsd !== undefined && ` Starts at a ${formatUsd(startMcapUsd)} market cap and graduates around 16.8× higher.`}{" "}
          You earn 60% of the 1% trading fee, plus 10% as the pair creator.
        </p>

        {created && (
          <Link
            href={`/token/${created}`}
            className="mt-3 flex items-center gap-1.5 rounded-xl bg-surface px-3 py-2 text-xs text-success hover:underline"
          >
            <CheckCircle size={14} weight="fill" />
            Token launched. Open its page
            <ArrowRight size={12} />
          </Link>
        )}

        <div className="mt-4">
          <p className="text-xs text-muted-foreground">Dev buy · % of the 1B supply (optional, max 5%)</p>
          <div className="mt-2 flex gap-1.5">
            {DEV_BUY_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDevPct(String(p))}
                className={cn(
                  "flex-1 rounded-full border px-2 py-1.5 font-mono text-xs transition-all",
                  Number(devPct) === p
                    ? "border-accent bg-accent-subtle text-accent-strong"
                    : "border-border text-muted-foreground hover:border-accent/40",
                )}
              >
                {p}%
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-surface px-3 focus-within:border-accent">
            <input
              value={devPct}
              inputMode="decimal"
              onChange={(e) => setDevPct(e.target.value.replace(/[^0-9.]/g, "").slice(0, 5))}
              placeholder="0"
              className="h-10 w-full min-w-0 bg-transparent font-mono text-sm outline-none"
            />
            <span className="font-mono text-xs text-muted-foreground">% of supply</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            {targetBps > 0n && math.sharesIn > 0n ? (
              <>
                ≈ <span className="font-mono text-foreground">{compactTokens(math.tokensOut)}</span> tokens (
                {(Number(targetBps) / 100).toFixed(2)}% of supply) for{" "}
                <span className="font-mono text-foreground">
                  {Number(formatUnits(math.sharesIn, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </span>{" "}
                pair shares{sharesUsd !== undefined && ` ≈ ${formatUsd(sharesUsd)}`} · you hold{" "}
                {Number(formatUnits(userShares, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </>
            ) : (
              <>
                No dev buy — the whole supply starts on the curve. You hold{" "}
                {Number(formatUnits(userShares, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} pair shares.
              </>
            )}
          </p>
        </div>

        {blocker && !busy && <p className="mt-3 text-xs text-muted-foreground">{blocker}</p>}
        {creator.error && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-destructive">
            <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
            {creator.error}
          </p>
        )}

        <Button className="mt-4 w-full" size="lg" disabled={blocker !== null || busy || !!created} onClick={create}>
          {busy ? (
            <>
              <CircleNotch size={16} className="animate-spin" />
              {creator.stage === "approve" ? "Approve pair shares…" : "Launching…"}
            </>
          ) : (
            <>
              <RocketLaunch size={16} weight="bold" />
              Launch ${symbol}
            </>
          )}
        </Button>
      </div>
    </section>
  );
}

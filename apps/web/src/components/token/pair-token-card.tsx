"use client";

import { useState } from "react";
import Link from "next/link";
import { formatUnits, parseUnits, type Address } from "viem";
import { ArrowRight, CircleNotch, RocketLaunch, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn, formatUsd } from "@/lib/utils";
import { novexCurveReady } from "@/lib/contracts";
import { useCreateCurveToken, useCurveOnchain, usePairCurveToken } from "@/hooks/use-curve-token";

const MAX_NAME = 32;
const MAX_SYMBOL = 12;

export interface PairTokenCardProps {
  pair: Address;
  share: Address;
  isCreator: boolean;
  userShares: bigint;
  sharePriceUsd?: number;
  className?: string;
}

/**
 * On a pair page: links to the pair's creator token when it exists; otherwise
 * lets the pair creator launch one on the bonding curve.
 */
export function PairTokenCard({ pair, share, isCreator, userShares, sharePriceUsd, className }: PairTokenCardProps) {
  const { token, refetch } = usePairCurveToken(pair);
  if (!novexCurveReady) return null;
  if (token) return <TokenLinkCard token={token} className={className} />;
  if (!isCreator) return null;
  return (
    <CreateTokenCard
      pair={pair}
      share={share}
      userShares={userShares}
      sharePriceUsd={sharePriceUsd}
      onCreated={() => void refetch()}
      className={className}
    />
  );
}

function TokenLinkCard({ token, className }: { token: Address; className?: string }) {
  const { data } = useCurveOnchain(token);
  const mcap = data ? Number(data.marketCapUsd8) / 1e8 : undefined;
  return (
    <Link
      href={`/token/${token}`}
      className={cn(
        "group flex items-center justify-between gap-3 rounded-[1.5rem] border border-accent/50 bg-accent-subtle/50 p-4 transition-colors hover:border-accent",
        className,
      )}
    >
      <div>
        <p className="flex items-center gap-1.5 text-xs font-semibold text-accent-strong">
          <RocketLaunch size={14} weight="fill" />
          Creator token live
        </p>
        <p className="mt-1 font-mono text-sm">
          {mcap !== undefined ? `${formatUsd(mcap)} market cap` : "Loading…"}
          {data && ` · ${(data.progressBps / 100).toFixed(1)}% to graduation`}
        </p>
      </div>
      <ArrowRight size={16} className="text-accent-strong transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function CreateTokenCard({
  pair,
  share,
  userShares,
  sharePriceUsd,
  onCreated,
  className,
}: {
  pair: Address;
  share: Address;
  userShares: bigint;
  sharePriceUsd?: number;
  onCreated: () => void;
  className?: string;
}) {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [devBuy, setDevBuy] = useState("");
  const [created, setCreated] = useState<Address | null>(null);
  const creator = useCreateCurveToken();
  const busy = creator.stage === "approve" || creator.stage === "submit";

  let devBuyShares = 0n;
  try {
    devBuyShares = devBuy ? parseUnits(devBuy, 18) : 0n;
  } catch {
    devBuyShares = -1n;
  }
  const devBuyUsd = devBuyShares > 0n && sharePriceUsd ? Number(formatUnits(devBuyShares, 18)) * sharePriceUsd : 0;

  const blocker =
    name.trim().length === 0
      ? "Give your token a name"
      : name.trim().length > MAX_NAME
        ? `Name must be at most ${MAX_NAME} characters`
        : symbol.length === 0
          ? "Pick a ticker"
          : devBuyShares < 0n
            ? "Dev buy must be a number"
            : devBuyShares > userShares
              ? "Dev buy is more than your pair shares"
              : null;

  async function create() {
    try {
      const result = await creator.create({ pair, share, name: name.trim(), symbol, devBuyShares });
      setCreated(result.token);
      onCreated();
    } catch {
      /* shown below */
    }
  }

  if (created) return <TokenLinkCard token={created} className={className} />;

  return (
    <section className={cn("rounded-[1.75rem] border border-accent/60 bg-accent-subtle/40 p-5 shadow-float", className)}>
      <div className="flex items-center gap-2 text-sm font-semibold text-accent-strong">
        <RocketLaunch size={16} weight="fill" />
        Launch a creator token
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        1B supply on a bonding curve backed by this pair&apos;s stocks. Starts at a low market cap and graduates
        around 16.8× higher. You earn 70% of the 1% trading fee.
      </p>

      <div className="mt-4 space-y-3">
        <label className="block text-xs">
          <span className="text-muted-foreground">Name</span>
          <input
            value={name}
            maxLength={MAX_NAME}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tesla AMD Army"
            className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="block text-xs">
          <span className="text-muted-foreground">Ticker</span>
          <input
            value={symbol}
            maxLength={MAX_SYMBOL}
            onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            placeholder="TAMD"
            className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 font-mono text-sm uppercase outline-none focus:border-accent"
          />
        </label>
        <label className="block text-xs">
          <span className="text-muted-foreground">Dev buy in pair shares (optional, max 5% of supply)</span>
          <input
            value={devBuy}
            inputMode="decimal"
            onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0"
            className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 font-mono text-sm outline-none focus:border-accent"
          />
          <span className="mt-1 block text-[11px] text-muted-foreground">
            You hold {Number(formatUnits(userShares, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} shares
            {devBuyUsd > 0 && ` · dev buy ≈ ${formatUsd(devBuyUsd)}`}
          </span>
        </label>
      </div>

      {blocker && !busy && <p className="mt-3 text-xs text-muted-foreground">{blocker}</p>}
      {creator.error && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-destructive">
          <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
          {creator.error}
        </p>
      )}

      <Button className="mt-4 w-full" size="lg" disabled={blocker !== null || busy} onClick={create}>
        {busy ? (
          <>
            <CircleNotch size={16} className="animate-spin" />
            {creator.stage === "approve" ? "Approve shares…" : "Launching…"}
          </>
        ) : (
          <>
            <RocketLaunch size={16} weight="bold" />
            Launch ${symbol || "TOKEN"}
          </>
        )}
      </Button>
    </section>
  );
}

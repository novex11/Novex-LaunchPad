"use client";

import { useState } from "react";
import Link from "next/link";
import { formatUnits, parseUnits, type Address } from "viem";
import { useReadContract } from "wagmi";
import { ArrowRight, CheckCircle, CircleNotch, Coins, Plus, RocketLaunch, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn, explorerUrl, formatUsd } from "@/lib/utils";
import { composeCurveReady, receiptTokenAbi } from "@/lib/contracts";
import { useWallet } from "@/hooks/use-wallet";
import {
  useClaimCurveCreatorFees,
  useCreateCurveToken,
  useCurveOnchain,
  usePairCreatorCurveFees,
  usePairCurveTokens,
} from "@/hooks/use-curve-token";

const MAX_NAME = 32;
const MAX_SYMBOL = 12;
const PREVIEW_COUNT = 4;

export interface PairTokenCardProps {
  pair: Address;
  share: Address;
  isCreator: boolean;
  userShares: bigint;
  sharePriceUsd?: number;
  className?: string;
}

/**
 * On a pair page: every token launched on this pair, a launch form open to any
 * connected wallet, and the pair creator's cut of those tokens' trading fees.
 */
export function PairTokenCard({ pair, share, isCreator, userShares, sharePriceUsd, className }: PairTokenCardProps) {
  const { tokens, isLoading, refetch } = usePairCurveTokens(pair);
  const wallet = useWallet();
  const [showAll, setShowAll] = useState(false);
  const [launching, setLaunching] = useState(false);
  if (!composeCurveReady) return null;

  const visible = showAll ? tokens : tokens.slice(0, PREVIEW_COUNT);
  const formOpen = launching || (!isLoading && tokens.length === 0);

  return (
    <div className={cn("space-y-4", className)}>
      {isCreator && <PairCreatorCurveFees pair={pair} sharePriceUsd={sharePriceUsd} />}

      {tokens.length > 0 && (
        <section className="rounded-[1.75rem] border border-accent/50 bg-accent-subtle/40 p-4">
          <div className="flex items-center justify-between gap-2 px-1">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-accent-strong">
              <RocketLaunch size={14} weight="fill" />
              Tokens on this pair
            </p>
            <span className="font-mono text-[11px] text-muted-foreground">{tokens.length}</span>
          </div>
          <ul className="mt-3 space-y-2">
            {visible.map((token) => (
              <li key={token}>
                <TokenLinkRow token={token} />
              </li>
            ))}
          </ul>
          {tokens.length > PREVIEW_COUNT && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-2 w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              {showAll ? "Show fewer" : `Show all ${tokens.length}`}
            </button>
          )}
        </section>
      )}

      {formOpen ? (
        wallet.address ? (
          <CreateTokenCard
            pair={pair}
            share={share}
            userShares={userShares}
            sharePriceUsd={sharePriceUsd}
            isPairCreator={isCreator}
            onCreated={() => void refetch()}
          />
        ) : (
          <p className="rounded-[1.5rem] border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            Connect a wallet to launch your own token on this pair.
          </p>
        )
      ) : (
        <Button variant="outline" className="w-full" onClick={() => setLaunching(true)}>
          <Plus size={16} weight="bold" />
          Launch your own token on this pair
        </Button>
      )}
    </div>
  );
}

function TokenLinkRow({ token }: { token: Address }) {
  const { data } = useCurveOnchain(token);
  const symbol = useReadContract({ address: token, abi: receiptTokenAbi, functionName: "symbol" });
  const mcap = data ? Number(data.marketCapUsd8) / 1e8 : undefined;
  return (
    <Link
      href={`/token/${token}`}
      className="group flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5 transition-colors hover:border-accent"
    >
      <div className="min-w-0">
        <p className="truncate font-mono text-sm font-semibold">${(symbol.data as string | undefined) ?? "…"}</p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {mcap !== undefined ? `${formatUsd(mcap)} mcap` : "Loading…"}
          {data && ` · ${(data.progressBps / 100).toFixed(1)}% to graduation`}
        </p>
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
        As pair creator you earn 10% of the 1% trade fee on every token launched on this pair.
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

function CreateTokenCard({
  pair,
  share,
  userShares,
  sharePriceUsd,
  isPairCreator,
  onCreated,
}: {
  pair: Address;
  share: Address;
  userShares: bigint;
  sharePriceUsd?: number;
  isPairCreator: boolean;
  onCreated: () => void;
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
      setName("");
      setSymbol("");
      setDevBuy("");
      onCreated();
    } catch {
      /* shown below */
    }
  }

  return (
    <section className="rounded-[1.75rem] border border-accent/60 bg-accent-subtle/40 p-5 shadow-float">
      <div className="flex items-center gap-2 text-sm font-semibold text-accent-strong">
        <RocketLaunch size={16} weight="fill" />
        Launch a token on this pair
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        1B supply on a bonding curve backed by this pair&apos;s stocks. Starts at a low market cap and graduates
        around 16.8× higher. You earn 60% of the 1% trading fee
        {isPairCreator ? ", plus 10% as the pair creator." : "; the pair creator earns 10%."}
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

import Link from "next/link";
import { MARKETS_LOCKED } from "@/lib/markets-lock";
import { Button } from "@/components/ui/button";

/** While Markets is being upgraded, no /markets page (list or stock detail) renders. */
export default function MarketsLayout({ children }: { children: React.ReactNode }) {
  if (!MARKETS_LOCKED) return children;

  return (
    <div className="container-page flex min-h-[70dvh] items-center py-16">
      <div className="mx-auto w-full max-w-xl rounded-3xl border border-border bg-surface p-8 text-center shadow-card">
        <span className="inline-flex items-center gap-2 rounded-full bg-accent-subtle px-3 py-1 font-mono text-xs uppercase tracking-wider text-accent-strong">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          Under upgrade
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">Markets is being upgraded</h1>
        <p className="mt-3 text-muted-foreground">
          We&apos;re rebuilding Markets with live on-chain trading. Buying and selling individual stocks is paused
          until it&apos;s ready. Baskets, Stockback and the Launchpad are fully live in the meantime.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href="/create">Create a basket</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/launchpad">Launchpad</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/portfolio">Portfolio</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

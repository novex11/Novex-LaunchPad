import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GridPattern } from "@/components/motion/grid-pattern";

const SUGGESTED = ["NVDA", "AAPL", "TSLA", "SPY"];

export default function NotFound() {
  return (
    <div className="container-page relative flex min-h-[70dvh] items-center py-16">
      <GridPattern className="opacity-60" />
      <div className="relative grid w-full gap-10 md:grid-cols-12 md:items-center">
        <div className="md:col-span-7">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Error 404 · Symbol not found
          </p>
          <h1 className="mt-4 font-mono text-[5rem] font-semibold leading-none tracking-tighter text-foreground md:text-[8rem]">
            N/A
          </h1>
          <p className="mt-4 max-w-md text-muted-foreground">
            This route is not listed on any exchange we track. It may have been delisted,
            or the ticker was mistyped.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/markets">Browse markets</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Home</Link>
            </Button>
          </div>
        </div>
        <div className="md:col-span-5">
          <div className="rounded-3xl border border-border bg-surface p-5 shadow-card">
            <p className="label-caps">Try one of these</p>
            <ul className="mt-3 divide-y divide-border-subtle">
              {SUGGESTED.map((t) => (
                <li key={t}>
                  <Link
                    href={`/markets/${t}`}
                    className="flex items-center justify-between py-2.5 text-sm font-medium transition-colors hover:text-accent-strong"
                  >
                    <span className="font-mono">{t}</span>
                    <span className="text-xs text-muted-foreground">Open chart</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

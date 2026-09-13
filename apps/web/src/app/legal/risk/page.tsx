export default function RiskPage() {
  return (
    <div className="container-page min-h-[70dvh] py-10 md:py-14">
      <p className="label-caps">Legal</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">Risk disclosures</h1>
      <div className="mt-10 grid max-w-3xl gap-8 divide-y divide-border-subtle text-sm text-muted-foreground [&>section]:pt-8 [&>section:first-child]:pt-0">
        <section>
          <h2 className="text-lg font-medium text-foreground">Market Risk</h2>
          <p>
            Stock-token prices may rise or fall. Defensive, Balanced, and
            Aggressive are relative risk categories, not guarantees.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-medium text-foreground">
            Relative Performance Risk
          </h2>
          <p>
            The basket may underperform the originally deposited stock. A user
            who deposits NVDA may later receive fewer NVDA tokens when
            redeeming into NVDA.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-medium text-foreground">
            Liquidity Risk
          </h2>
          <p>
            Some stock tokens may have insufficient liquidity, causing higher
            slippage or delayed execution.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-medium text-foreground">
            Smart-Contract Risk
          </h2>
          <p>
            Vault, router, oracle, and receipt-token contracts may contain
            defects. Use only after independent audit.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-medium text-foreground">Oracle Risk</h2>
          <p>
            Incorrect or delayed prices may affect valuation and execution
            safeguards.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-medium text-foreground">
            Cashback Availability
          </h2>
          <p>
            Cashback is limited by Novex funded reward inventory. It is not
            unlimited and stops when inventory is exhausted.
          </p>
        </section>
      </div>
    </div>
  );
}

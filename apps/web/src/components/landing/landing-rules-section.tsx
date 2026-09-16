import { SectionFrame } from "./section-frame";

const RULES = [
  "No email account — the address that signs is the desk. There is no password reset.",
  "Redemption returns current basket NAV — not a guaranteed quantity of the original deposit asset.",
  "Below the published floor, a deposit can still settle on-chain. It does not write Stockback.",
  "Lifetime Stockback cap is enforced per wallet. Excess stays visible, unpaid.",
  "Deposit Stockback vests for 7 days before you can claim it. Redeem first and it is forfeited.",
  "Forex pairs earn no Stockback allocation rewards.",
  "Smart contracts may contain defects. Use only after independent audit when deployed.",
];

export function LandingRulesSection() {
  return (
    <SectionFrame
      id="rules"
      index="08"
      eyebrow="Rules"
      title="What Compose will not do."
      description="These are product constraints, not marketing. If a fill fails a rule, the swap can still exist. The credit does not."
    >
      <ul className="divide-y divide-border border-t border-border">
        {RULES.map((rule) => (
          <li key={rule} className="px-4 py-4 text-sm leading-relaxed text-muted-foreground md:px-8 md:py-5">
            {rule}
          </li>
        ))}
      </ul>
    </SectionFrame>
  );
}

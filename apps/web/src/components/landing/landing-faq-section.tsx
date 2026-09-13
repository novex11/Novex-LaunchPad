import { SectionFrame } from "./section-frame";
import { LandingAccordion } from "./landing-accordion";

const FAQ = [
  {
    q: "Who can use Novex?",
    a: "Any wallet that can connect via Privy or the demo wallet. Deposits and trades are recorded against your address on the indexer.",
  },
  {
    q: "When does a deposit pay Stockback?",
    a: "When the deposit meets the published floor and you are under the lifetime cap. The allocator computes the exact figure before you confirm.",
  },
  {
    q: "Can I buy a single stock without a basket?",
    a: "Yes. Use Markets to buy or sell tokenized stocks directly. Holdings appear in Portfolio under direct holdings.",
  },
  {
    q: "What do I get after redeem?",
    a: "Your proportional basket value at current NAV, minus estimated external costs, in the original asset or underlying tokens.",
  },
  {
    q: "Why did a trade not appear?",
    a: "The indexer must be online. Start services with pnpm dev and ensure your wallet is connected.",
  },
  {
    q: "How does the allocator work offline?",
    a: "The UI falls back to a local SDK estimate instantly, then replaces it when the allocator responds.",
  },
];

export function LandingFaqSection() {
  return (
    <SectionFrame
      id="faq"
      index="08"
      eyebrow="Questions"
      title="Before you connect."
      description="Short answers. The ledger does not invent a second story after you sign."
    >
      <LandingAccordion items={FAQ} />
    </SectionFrame>
  );
}

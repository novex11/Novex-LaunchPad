import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, type LegalSection } from "@/components/legal/legal-document";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service — Compose",
  description:
    "The terms that govern your use of the Compose interface, strategy vaults, pair launchpad and Stockback rewards.",
};

const sections: LegalSection[] = [
  {
    id: "acceptance",
    title: "Acceptance of terms",
    body: (
      <>
        <p>
          These Terms of Service (the &ldquo;Terms&rdquo;) are an agreement between you
          and {LEGAL.entityName} (&ldquo;{LEGAL.brand}&rdquo;, &ldquo;we&rdquo;,
          &ldquo;us&rdquo;). They govern your use of the {LEGAL.brand} website, interface,
          APIs and related services (the &ldquo;Services&rdquo;).
        </p>
        <p>
          By connecting a wallet or otherwise using the Services, you accept these Terms,
          our <Link href="/legal/privacy">Privacy Policy</Link> and our{" "}
          <Link href="/legal/risk">Risk disclosures</Link>. If you do not agree, do not
          use the Services.
        </p>
      </>
    ),
  },
  {
    id: "eligibility",
    title: "Eligibility",
    body: (
      <>
        <p>To use the Services, you represent and warrant that:</p>
        <ul>
          <li>You are at least {LEGAL.minimumAge} years old and have full legal capacity to enter into these Terms.</li>
          <li>
            You are not a resident of, located in, or organized under the laws of any
            jurisdiction where use of the Services or of tokenized securities is
            prohibited or requires a licence you do not hold.
          </li>
          <li>
            You are not the subject of sanctions administered by any applicable
            authority, and you are not acting on behalf of a sanctioned person.
          </li>
          <li>You will comply with all laws that apply to your use of the Services.</li>
        </ul>
        <p>We may restrict access from certain jurisdictions or wallet addresses at any time.</p>
      </>
    ),
  },
  {
    id: "services",
    title: "The Services",
    body: (
      <>
        <p>{LEGAL.brand} provides an interface to smart contracts on Robinhood Chain, including:</p>
        <ul>
          <li>
            <strong>Strategy vaults</strong> that convert a deposited stock token into a
            managed basket and issue receipt tokens that represent your share.
          </li>
          <li>
            <strong>The pair launchpad</strong>, where anyone can permissionlessly launch
            a two-token pair vault, and anyone can seed or deposit into it.
          </li>
          <li>
            <strong>Stockback</strong>, a limited promotional reward funded by{" "}
            {LEGAL.brand} for eligible deposits.
          </li>
          <li>Market data, quotes, portfolio views and analytics.</li>
        </ul>
        <p>
          Features on testnet use test assets with no monetary value and may be reset at
          any time.
        </p>
      </>
    ),
  },
  {
    id: "non-custodial",
    title: "Non-custodial use and your wallet",
    body: (
      <>
        <p>
          {LEGAL.brand} is non-custodial. We never hold your private keys, seed phrase or
          assets, and we cannot initiate, reverse or cancel transactions on your behalf.
        </p>
        <p>
          You alone are responsible for your wallet&apos;s security, for reviewing every
          transaction before you sign it, and for any loss caused by compromised
          credentials, mistaken transfers or interactions with incorrect addresses.
        </p>
      </>
    ),
  },
  {
    id: "stock-tokens",
    title: "Stock tokens and receipt tokens",
    body: (
      <>
        <p>
          Stock tokens are issued by third parties, not by {LEGAL.brand}. Holding a stock
          token or a vault receipt token may not give you the rights of a shareholder in
          the underlying company, such as voting rights, and corporate actions like splits
          or dividends may be reflected differently onchain.
        </p>
        <p>
          Vault receipt tokens are non-transferable. They can only be minted by depositing
          into, and burned by redeeming from, their vault. Redemption values depend on
          oracle prices, available liquidity and swap execution at the time you redeem.
        </p>
      </>
    ),
  },
  {
    id: "launchpad",
    title: "Pair launchpad and creators",
    body: (
      <>
        <ul>
          <li>
            Launching a pair is permissionless. {LEGAL.brand} does not endorse, vet or
            guarantee any launched pair, its creator or its content.
          </li>
          <li>
            Creators choose a creator fee between 1% and 5% that is deducted from
            non-creator deposits and can be claimed by the creator. The fee is fixed at
            launch and cannot be changed afterwards.
          </li>
          <li>
            A token combination can only be launched once, and each wallet can launch a
            limited number of pairs.
          </li>
          <li>
            Creators are responsible for the name, description, website, banner and logo
            they submit. You must own or have permission to use that content, and it must
            not be misleading, infringing, unlawful or impersonate any person, company or
            brand.
          </li>
          <li>
            You grant {LEGAL.brand} a worldwide, royalty-free licence to host, display and
            distribute submitted content in connection with the Services. We may hide or
            remove off-chain content at our discretion. Onchain contracts cannot be removed.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "fees",
    title: "Fees",
    body: (
      <>
        <p>
          {LEGAL.brand} currently charges a platform fee of $0.00. Your transactions may
          still incur:
        </p>
        <ul>
          <li>Network gas fees paid to Robinhood Chain.</li>
          <li>Swap fees and price impact from the liquidity venues used to execute trades.</li>
          <li>Creator fees on deposits into launchpad pairs you did not create.</li>
        </ul>
        <p>
          We may introduce or change platform fees in the future with notice. Fees
          already encoded in deployed smart contracts apply as written in those contracts.
        </p>
      </>
    ),
  },
  {
    id: "stockback",
    title: "Stockback rewards",
    body: (
      <p>
        Stockback is a discretionary promotion. Eligibility depends on minimum deposit
        size, per-wallet caps, time between rewards and a limited global budget. Rewards
        stop when the budget is exhausted. We may pause, change or end Stockback at any
        time, and we may withhold rewards obtained through abuse, including splitting
        activity across multiple wallets.
      </p>
    ),
  },
  {
    id: "prohibited",
    title: "Prohibited conduct",
    body: (
      <>
        <p>You agree not to:</p>
        <ul>
          <li>Use the Services to break any law, including securities, sanctions or anti-money-laundering laws.</li>
          <li>Manipulate prices, oracles or liquidity, or exploit bugs or vulnerabilities, other than through responsible disclosure to us.</li>
          <li>Engage in wash trading, front-running, spoofing or other market manipulation.</li>
          <li>Abuse rewards or limits by using multiple wallets or automated scripts.</li>
          <li>Upload malware, or content that is unlawful, infringing, hateful or deceptive.</li>
          <li>Interfere with, overload or reverse-engineer the Services or the infrastructure behind them.</li>
          <li>Access the Services through a VPN or other means to get around geographic restrictions.</li>
        </ul>
      </>
    ),
  },
  {
    id: "risks",
    title: "Assumption of risk",
    body: (
      <>
        <p>
          Using digital assets and smart contracts carries significant risk, including the
          loss of all funds you deposit. Risks include market volatility, liquidity
          shortfalls, oracle failures or stale prices, smart-contract defects, network
          congestion or outages, regulatory changes and the paused or restricted operation
          of contracts.
        </p>
        <p>
          The {LEGAL.brand} smart contracts may not have been independently audited.
          Read the <Link href="/legal/risk">Risk disclosures</Link> before depositing.
        </p>
      </>
    ),
  },
  {
    id: "no-advice",
    title: "No investment advice",
    body: (
      <p>
        Nothing in the Services is investment, financial, legal or tax advice. Strategy
        labels such as Defensive, Balanced and Aggressive describe relative allocation
        limits, not guaranteed outcomes. Past performance and displayed yields do not
        predict future results. You are solely responsible for your decisions and for any
        taxes that apply to your activity.
      </p>
    ),
  },
  {
    id: "third-parties",
    title: "Third-party services",
    body: (
      <p>
        The Services rely on third parties, including wallet providers, RPC providers,
        oracle networks, liquidity venues, stock-token issuers and market-data providers.
        We do not control these parties and are not responsible for their availability,
        accuracy or conduct. Your use of them may be subject to their own terms.
      </p>
    ),
  },
  {
    id: "ip",
    title: "Intellectual property",
    body: (
      <p>
        The {LEGAL.brand} name, logos, interface design and content are owned by{" "}
        {LEGAL.brand} or its licensors. We grant you a limited, revocable, non-exclusive
        licence to use the interface for its intended purpose. Open-source components are
        licensed under their own terms.
      </p>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    body: (
      <p className="uppercase tracking-wide text-[13px]">
        The Services are provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;,
        without warranties of any kind, express or implied, including merchantability,
        fitness for a particular purpose, non-infringement, accuracy of data or
        uninterrupted operation.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: (
      <>
        <p className="uppercase tracking-wide text-[13px]">
          To the maximum extent permitted by law, {LEGAL.brand} and its affiliates,
          officers, employees and contributors will not be liable for any indirect,
          incidental, special, consequential or punitive damages, or for any loss of
          profits, digital assets, data or goodwill, arising from your use of the Services.
        </p>
        <p>
          Our total liability for any claim relating to the Services will not exceed the
          greater of the platform fees you paid us in the twelve months before the claim
          or USD $100.
        </p>
      </>
    ),
  },
  {
    id: "indemnity",
    title: "Indemnification",
    body: (
      <p>
        You agree to indemnify and hold harmless {LEGAL.brand} and its affiliates from
        claims, losses and expenses, including reasonable legal fees, that arise from your
        use of the Services, the content you submit or your breach of these Terms.
      </p>
    ),
  },
  {
    id: "termination",
    title: "Suspension and termination",
    body: (
      <p>
        We may suspend or end your access to the interface at any time, including for
        breach of these Terms or to comply with law. Because the smart contracts are
        onchain, you may still be able to interact with them directly. Sections that by
        their nature should survive termination will survive.
      </p>
    ),
  },
  {
    id: "law",
    title: "Governing law and disputes",
    body: (
      <p>
        These Terms are governed by the laws of {LEGAL.governingLaw}, without regard to
        conflict-of-law rules. Any dispute will be resolved exclusively in the{" "}
        {LEGAL.venue}, unless applicable law requires otherwise.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: (
      <p>
        We may update these Terms from time to time. We will revise the &ldquo;Last
        updated&rdquo; date and, for material changes, give notice through the interface.
        Continuing to use the Services after changes take effect means you accept them.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        Questions about these Terms can be sent to <a href={`mailto:${LEGAL.contactEmail}`} className="font-semibold underline">{LEGAL.contactEmail}</a>.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      effectiveDate={LEGAL.effectiveDate}
      currentHref="/legal/terms"
      intro={
        <p>
          Please read these Terms carefully. They explain your responsibilities when you
          use {LEGAL.brand}, how launchpad pairs and Stockback work, and the limits of our
          liability.
        </p>
      }
      sections={sections}
    />
  );
}

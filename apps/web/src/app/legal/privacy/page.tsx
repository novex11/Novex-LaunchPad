import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, type LegalSection } from "@/components/legal/legal-document";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy — Novex",
  description:
    "How Novex collects, uses, and protects information when you use the Novex interface on Robinhood Chain.",
};

const sections: LegalSection[] = [
  {
    id: "scope",
    title: "Scope",
    body: (
      <>
        <p>
          This Privacy Policy explains how {LEGAL.entityName} (&ldquo;{LEGAL.brand}&rdquo;,
          &ldquo;we&rdquo;, &ldquo;us&rdquo;) handles information when you use the {LEGAL.brand}{" "}
          web interface, its APIs and related services (the &ldquo;Services&rdquo;).
        </p>
        <p>
          {LEGAL.brand} is a non-custodial interface to smart contracts deployed on
          Robinhood Chain. We never hold your private keys or your assets. Transactions
          you sign are broadcast to a public blockchain, which is outside our control
          and is not covered by this policy.
        </p>
      </>
    ),
  },
  {
    id: "information-we-collect",
    title: "Information we collect",
    body: (
      <>
        <h3>Information you provide</h3>
        <ul>
          <li>
            <strong>Wallet address.</strong> When you connect a wallet we receive its
            public address. We do not require your name, email address or phone number
            to use the core Services.
          </li>
          <li>
            <strong>Launchpad content.</strong> If you launch a pair, the display name,
            description, website link, banner and logo images you submit are stored and
            shown publicly alongside the pair.
          </li>
          <li>
            <strong>Communications.</strong> If you contact us, we keep the content of
            your message and your contact details so we can respond.
          </li>
        </ul>
        <h3>Information collected automatically</h3>
        <ul>
          <li>
            <strong>Onchain activity.</strong> We index public blockchain data linked to
            your wallet, such as deposits, redemptions, swaps, receipt-token balances,
            pair launches, creator earnings and Stockback rewards, to show your portfolio,
            activity history and protocol analytics.
          </li>
          <li>
            <strong>Technical data.</strong> Our servers and infrastructure providers
            receive standard request data such as IP address, browser type, device
            information, pages requested and timestamps. We use it to operate, secure
            and debug the Services.
          </li>
        </ul>
        <h3>Information we do not collect</h3>
        <p>
          We do not collect private keys or seed phrases, and we will never ask for them.
          We do not currently use advertising trackers or third-party analytics cookies.
        </p>
      </>
    ),
  },
  {
    id: "how-we-use",
    title: "How we use information",
    body: (
      <ul>
        <li>Provide the Services, including portfolios, quotes, allocations and launchpad pages.</li>
        <li>Calculate and display positions, share prices, creator fees and Stockback eligibility.</li>
        <li>Detect and prevent fraud, abuse, sybil activity and security incidents.</li>
        <li>Enforce our <Link href="/legal/terms">Terms of Service</Link> and moderate launchpad content.</li>
        <li>Comply with legal obligations, including sanctions screening where required.</li>
        <li>Maintain, measure and improve performance and reliability.</li>
      </ul>
    ),
  },
  {
    id: "public-blockchain",
    title: "Public blockchain data",
    body: (
      <p>
        Blockchain transactions are public, permanent and can be linked to your wallet
        address by anyone. We cannot modify or delete onchain records. Any deletion
        request we honor applies only to data held in our own off-chain systems.
      </p>
    ),
  },
  {
    id: "sharing",
    title: "How information is shared",
    body: (
      <>
        <p>We do not sell your personal information. We share it only as follows:</p>
        <ul>
          <li>
            <strong>Service providers</strong> that run the Services on our behalf,
            including wallet connection (Privy), blockchain RPC access (Alchemy), hosting
            and database infrastructure, and embedded market charts (TradingView). These
            providers process data under their own terms and privacy policies.
          </li>
          <li>
            <strong>Publicly</strong>, for launchpad content and indexed onchain activity
            that is shown on pair, vault and activity pages.
          </li>
          <li>
            <strong>Legal and safety</strong> reasons, when we believe disclosure is
            required by law or needed to protect the rights, property or safety of users,
            {LEGAL.brand} or others.
          </li>
          <li>
            <strong>Business transfers</strong>, such as a merger, acquisition or sale of
            assets, subject to this policy.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "storage",
    title: "Cookies and local storage",
    body: (
      <p>
        The interface and its wallet-connection libraries use your browser&apos;s local
        storage to remember your connected wallet, network and interface preferences.
        This data stays on your device and can be cleared in your browser settings, which
        will disconnect your wallet from the interface.
      </p>
    ),
  },
  {
    id: "retention",
    title: "Data retention",
    body: (
      <p>
        We keep indexed activity and launchpad content for as long as needed to provide
        the Services and maintain accurate historical records. We keep server logs for a
        limited period for security and debugging. We delete or anonymize data when it is
        no longer needed, unless we must keep it longer by law.
      </p>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <p>
        We use reasonable technical and organizational measures to protect the data we
        hold. No system is perfectly secure, however, and you are responsible for
        securing your wallet, devices and recovery phrases.
      </p>
    ),
  },
  {
    id: "your-rights",
    title: "Your rights",
    body: (
      <>
        <p>
          Depending on where you live, you may have the right to access, correct, delete
          or port your personal information, to object to or restrict certain processing,
          and to lodge a complaint with your local data protection authority.
        </p>
        <p>
          To exercise these rights, email{" "}
          <strong>{LEGAL.privacyEmail}</strong>. Because wallets are pseudonymous, we may
          ask you to sign a message with the relevant wallet to verify the request.
        </p>
      </>
    ),
  },
  {
    id: "international",
    title: "International transfers",
    body: (
      <p>
        Our providers may process information in countries other than yours. Where
        required, we rely on appropriate safeguards for these transfers.
      </p>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: (
      <p>
        The Services are not directed to anyone under {LEGAL.minimumAge}, and we do not
        knowingly collect information from them.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        We may update this policy from time to time. When we do, we will revise the
        &ldquo;Last updated&rdquo; date above and, for material changes, give notice
        through the interface.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        Questions about this policy can be sent to <strong>{LEGAL.privacyEmail}</strong>.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      effectiveDate={LEGAL.effectiveDate}
      currentHref="/legal/privacy"
      intro={
        <p>
          {LEGAL.brand} is built to work with a wallet, not an account. We collect as
          little as possible, never take custody of your keys, and do not sell your data.
        </p>
      }
      sections={sections}
    />
  );
}

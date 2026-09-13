"use client";

import { LandingHeroSection } from "@/components/landing/landing-hero-section";
import { LandingExchangeStrip } from "@/components/landing/landing-exchange-strip";
import { LandingHowItPays } from "@/components/landing/landing-how-it-pays";
import { LandingStrategiesSection } from "@/components/landing/landing-strategies-section";
import { LandingLiveMarkets } from "@/components/landing/landing-live-markets";
import { LandingPublishedNumbers } from "@/components/landing/landing-published-numbers";
import { LandingDeskSection } from "@/components/landing/landing-desk-section";
import { LandingLaunchpadSection } from "@/components/landing/landing-launchpad-section";
import { LandingRulesSection } from "@/components/landing/landing-rules-section";
import { LandingFaqSection } from "@/components/landing/landing-faq-section";
import { LandingCloseSection } from "@/components/landing/landing-close-section";

export default function HomePage() {
  return (
    <div>
      <LandingHeroSection />
      <LandingExchangeStrip />
      <LandingHowItPays />
      <LandingStrategiesSection />
      <LandingLiveMarkets />
      <LandingPublishedNumbers />
      <LandingDeskSection />
      <LandingLaunchpadSection />
      <LandingRulesSection />
      <LandingFaqSection />
      <LandingCloseSection />
    </div>
  );
}

/**
 * Shared facts referenced by the Terms of Service and Privacy Policy.
 * TODO(legal): replace the bracketed placeholders and have counsel review
 * both documents before a production launch.
 */
export const LEGAL = {
  brand: "Novex",
  entityName: "[Novex legal entity name]",
  contactEmail: "[legal@your-domain]",
  privacyEmail: "[privacy@your-domain]",
  governingLaw: "[governing jurisdiction]",
  venue: "[courts of the governing jurisdiction]",
  effectiveDate: "September 14, 2026",
  minimumAge: 18,
} as const;

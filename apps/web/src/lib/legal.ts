/**
 * Shared facts referenced by the Terms of Service and Privacy Policy.
 * TODO(legal): replace the bracketed placeholders and have counsel review
 * both documents before a production launch.
 */
export const LEGAL = {
  brand: "Compose",
  entityName: "[Compose legal entity name]",
  contactEmail: "contact@usecompose.xyz",
  privacyEmail: "contact@usecompose.xyz",
  governingLaw: "[governing jurisdiction]",
  venue: "[courts of the governing jurisdiction]",
  effectiveDate: "September 14, 2026",
  minimumAge: 18,
} as const;

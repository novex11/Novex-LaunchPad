"use client";

import { EXCLUDED_JURISDICTIONS } from "@compose/config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function GeoGate({ countryCode }: { countryCode?: string }) {
  if (!countryCode) return null;
  if (!EXCLUDED_JURISDICTIONS.includes(countryCode as never)) return null;

  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardHeader>
        <CardTitle className="text-destructive text-lg">
          Not available in your region
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Robinhood Stock Tokens are not available in {countryCode}. Compose
        requires eligible Stock Token access to deposit and redeem.
      </CardContent>
    </Card>
  );
}

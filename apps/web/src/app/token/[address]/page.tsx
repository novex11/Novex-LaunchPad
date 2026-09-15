import { Suspense } from "react";
import TokenDetailContent from "./token-content";

export default async function TokenDetailPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  return (
    <Suspense
      fallback={
        <div className="container-page py-12 text-sm text-muted-foreground">
          Loading token…
        </div>
      }
    >
      <TokenDetailContent address={address} />
    </Suspense>
  );
}

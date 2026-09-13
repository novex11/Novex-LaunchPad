import { Suspense } from "react";
import PairDetailContent from "./pair-content";

export default async function PairDetailPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  return (
    <Suspense
      fallback={
        <div className="container-page py-12 text-sm text-muted-foreground">
          Loading pair…
        </div>
      }
    >
      <PairDetailContent address={address} />
    </Suspense>
  );
}

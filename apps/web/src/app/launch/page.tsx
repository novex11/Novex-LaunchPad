import { Suspense } from "react";
import LaunchContent from "./launch-content";

export default function LaunchPage() {
  return (
    <Suspense
      fallback={
        <div className="container-page py-12 text-sm text-muted-foreground">
          Loading launchpad…
        </div>
      }
    >
      <LaunchContent />
    </Suspense>
  );
}

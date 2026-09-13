import { Suspense } from "react";
import CreateBasketContent from "./create-content";

export default function CreateBasketPage() {
  return (
    <Suspense
      fallback={
        <div className="container-page py-12 text-sm text-muted-foreground">
          Loading builder…
        </div>
      }
    >
      <CreateBasketContent />
    </Suspense>
  );
}

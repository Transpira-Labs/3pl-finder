import { Suspense } from "react";
import { DiscoveryPage } from "@/components/discovery/discovery-page";

export default function Page() {
  return (
    <Suspense>
      <DiscoveryPage />
    </Suspense>
  );
}

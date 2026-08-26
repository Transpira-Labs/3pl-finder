import { Suspense } from "react";
import { ListDetailPage } from "@/components/lists/list-detail-page";

export default function Page() {
  return (
    <Suspense>
      <ListDetailPage />
    </Suspense>
  );
}

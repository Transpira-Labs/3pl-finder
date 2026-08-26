import { Suspense } from "react";
import { ListsIndex } from "@/components/lists/lists-index";

export default function Page() {
  return (
    <Suspense>
      <ListsIndex />
    </Suspense>
  );
}

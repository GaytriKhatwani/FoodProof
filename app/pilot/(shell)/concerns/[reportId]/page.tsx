import type { Metadata } from "next";
import { Suspense } from "react";
import { ConcernDetail } from "@/components/community/ConcernDetail";
import { LoadingBlock } from "@/components/shell/states";

/**
 * Community concern detail — `/pilot/concerns/:reportId`
 * (docs/FOODPROOF_SCREENS.md §4). The pilot shell supplies the header,
 * navigation and `<main>` landmark. `ConcernDetail` reads the `source` search
 * parameter for its view event, so it is wrapped in a Suspense boundary.
 */
export const metadata: Metadata = {
  title: "Community concern — FoodProof pilot",
};

export default function ConcernPage({ params }: { params: { reportId: string } }) {
  return (
    <Suspense fallback={<LoadingBlock label="Loading this concern…" lines={5} />}>
      <ConcernDetail reportId={params.reportId} />
    </Suspense>
  );
}

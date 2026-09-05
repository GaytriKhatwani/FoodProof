import type { Metadata } from "next";
import { ReviewDetail } from "@/components/review/ReviewDetail";

/**
 * Reviewer detail — `/pilot/review/:requestId`
 * (docs/FOODPROOF_SCREENS.md §10). The route parameter is the publication
 * revision id from the queue, which is deliberately not the report id.
 */
export const metadata: Metadata = {
  title: "Review request — FoodProof pilot",
};

export default function ReviewDetailPage({ params }: { params: { requestId: string } }) {
  return <ReviewDetail revisionId={params.requestId} />;
}

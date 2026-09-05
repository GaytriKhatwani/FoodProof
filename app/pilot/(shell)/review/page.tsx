import type { Metadata } from "next";
import { ReviewQueue } from "@/components/review/ReviewQueue";

/**
 * Reviewer queue — `/pilot/review` (docs/FOODPROOF_SCREENS.md §10).
 * Reviewer-only: the API answers 403 for any other session and the component
 * renders that as an explicit forbidden state. The pilot shell supplies the
 * header, navigation and `<main>` landmark.
 */
export const metadata: Metadata = {
  title: "Review queue — FoodProof pilot",
};

export default function ReviewQueuePage() {
  return <ReviewQueue />;
}

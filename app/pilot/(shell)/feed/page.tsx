import type { Metadata } from "next";
import { FeedView } from "@/components/community/FeedView";

/**
 * Community feed — `/pilot/feed` (docs/FOODPROOF_SCREENS.md §3).
 * The pilot shell supplies the header, navigation and `<main>` landmark; this
 * route only renders the feed itself.
 */
export const metadata: Metadata = {
  title: "Community concerns — FoodProof pilot",
};

export default function FeedPage() {
  return <FeedView />;
}

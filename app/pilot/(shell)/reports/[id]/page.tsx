import { TimelineScreen } from "@/components/reporter/TimelineScreen";

/**
 * Private report timeline — `/pilot/reports/:id` (docs/FOODPROOF_SCREENS.md §8).
 * Owner-only: the API resolves ownership from the demo session and returns
 * NOT_FOUND for anything else, which this screen renders as "not available"
 * without exposing another scope's data.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Report record — FoodProof pilot",
};

export default function ReportTimelinePage({ params }: { params: { id: string } }) {
  return <TimelineScreen reportId={params.id} />;
}

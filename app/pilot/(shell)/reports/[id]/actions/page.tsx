import { ActionsScreen } from "@/components/reporter/ActionsScreen";

/**
 * Action preparation and external handoff — `/pilot/reports/:id/actions`
 * (docs/FOODPROOF_SCREENS.md §7). Preparing, copying and opening a destination
 * are all distinct from sending, and none of them creates a submission record.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Prepare a complaint — FoodProof pilot",
};

export default function ReportActionsPage({ params }: { params: { id: string } }) {
  return <ActionsScreen reportId={params.id} />;
}

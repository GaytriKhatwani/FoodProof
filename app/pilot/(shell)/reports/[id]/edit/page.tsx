import { ReportEditorScreen } from "@/components/reporter/ReportEditorScreen";

/**
 * Edit a saved report — `/pilot/reports/:id/edit` (docs/FOODPROOF_SCREENS.md §5).
 * Ownership is resolved server-side on every call; an unknown or another
 * session's id renders the not-found state, never another scope's data.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Edit report — FoodProof pilot",
};

export default function EditReportPage({ params }: { params: { id: string } }) {
  return <ReportEditorScreen reportId={params.id} fromConcernId={null} source="my_reports" />;
}

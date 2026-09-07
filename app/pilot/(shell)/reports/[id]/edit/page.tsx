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

/** `?step=concern` opens the Concern step directly (the actions screen links here to confirm facts). */
const STEP_BY_NAME: Record<string, number> = { product: 0, evidence: 1, concern: 2, review: 3 };

export default function EditReportPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { step?: string };
}) {
  const initialStep = STEP_BY_NAME[searchParams.step ?? ""] ?? 0;
  return (
    <ReportEditorScreen
      reportId={params.id}
      fromConcernId={null}
      source="my_reports"
      initialStep={initialStep}
    />
  );
}

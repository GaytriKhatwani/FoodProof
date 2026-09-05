import { ReportEditorScreen } from "@/components/reporter/ReportEditorScreen";

/**
 * New report — `/pilot/reports/new` (docs/FOODPROOF_SCREENS.md §5).
 *
 * `?from_concern=<reportId>` is the fixed cross-link from a community concern
 * (T3). It prefills PRODUCT IDENTITY ONLY; the new report is independent and
 * copies no evidence, text or history from the concern. `?source=` is an
 * optional analytics hint for the entry point and is never persisted.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Raise a concern — FoodProof pilot",
};

export default function NewReportPage({
  searchParams,
}: {
  searchParams: { from_concern?: string; source?: string };
}) {
  const fromConcernId = searchParams.from_concern ?? null;
  const source = fromConcernId ? "detail" : searchParams.source === "feed" ? "feed" : "my_reports";
  return (
    <ReportEditorScreen reportId={null} fromConcernId={fromConcernId} source={source} />
  );
}

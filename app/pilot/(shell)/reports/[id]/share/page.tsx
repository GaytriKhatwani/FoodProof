import { ShareScreen } from "@/components/reporter/ShareScreen";

/**
 * Community preview and consent — `/pilot/reports/:id/share`
 * (docs/FOODPROOF_SCREENS.md §6). Consent is explicit and unchecked by default;
 * the server also refuses a request without it.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Preview community version — FoodProof pilot",
};

export default function ShareReportPage({ params }: { params: { id: string } }) {
  return <ShareScreen reportId={params.id} />;
}

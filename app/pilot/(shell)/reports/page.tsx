import { MyReportsScreen } from "@/components/reporter/MyReportsScreen";

/**
 * My reports — `/pilot/reports` (docs/FOODPROOF_SCREENS.md §8).
 * Thin server entry: the shell layout supplies `<main>` and the session
 * provider, so this renders one section with a single `<h1>` and nothing else.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "My reports — FoodProof pilot",
};

export default function MyReportsPage() {
  return <MyReportsScreen />;
}

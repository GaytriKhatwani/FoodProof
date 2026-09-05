import Link from "next/link";

/**
 * Placeholder for the invited pilot entry — `/pilot`.
 * The real invitation entry, session guard and pilot shell are owned by later
 * tickets (persistence in T1, UI in T3). T0 ships only this honest stub so the
 * homepage CTA resolves; it renders no invitation form and claims no auth.
 */
export default function PilotPlaceholder() {
  return (
    <main className="container" style={{ paddingTop: 48, paddingBottom: 48 }}>
      <p className="notice">
        Invited pilot entry is not implemented in this scaffold. It arrives in a
        later slice (session guard in T1, entry UI in T3). This demo will use
        sample or redacted information and simulated roles.
      </p>
      <p>
        <Link href="/">← Back to the introduction</Link>
      </p>
    </main>
  );
}

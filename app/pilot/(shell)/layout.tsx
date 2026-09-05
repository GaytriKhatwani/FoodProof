import type { ReactNode } from "react";
import { SessionProvider } from "@/lib/client/session";

/**
 * Session-gated pilot shell — route group `(shell)` wraps every `/pilot/*`
 * page except the `/pilot` entry. This is the integration owner's MINIMAL
 * skeleton so reporter pages (T2) can rely on `useSession()` and a single
 * `<main id="main">` landmark while the real shell is built. T3 owns and
 * replaces this file with the full Clear Signal shell: skip link, header,
 * navigation (Feed, My reports, Review for reviewers only), analytics
 * preference control, Exit, and the loading / session-lost / unavailable states.
 * Pages rendered inside must NOT add their own header, nav or <main>.
 */
export default function PilotShellLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <main id="main" className="container">
        {children}
      </main>
    </SessionProvider>
  );
}

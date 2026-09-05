import type { ReactNode } from "react";
import { SessionProvider } from "@/lib/client/session";
import { PilotShell } from "@/components/shell/PilotShell";

/**
 * Session-gated pilot shell — route group `(shell)` wraps every `/pilot/*` page
 * except the `/pilot` entry.
 *
 * The shell owns the ONLY header, navigation and `<main id="main">` landmark in
 * the pilot; pages rendered inside (community, review and the reporter journey)
 * must not add their own. `PilotShell` is the client half: it reads the session
 * from `GET /api/me` through `useSession()` and decides what to render for each
 * status. Children are passed through as a prop, so a page inside the shell can
 * still be a server component.
 */
export default function PilotShellLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <PilotShell>{children}</PilotShell>
    </SessionProvider>
  );
}

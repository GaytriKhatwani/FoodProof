"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Me } from "@/lib/contracts";
import { api, ClientApiError } from "@/lib/client/api";
import { setClientAnalyticsConsent } from "@/lib/analytics";

/**
 * Client-side session state (FOODPROOF_TECHNICAL_SPEC.md §2). Fetches
 * `GET /api/me` on mount and exposes it via `useSession()`. This hook makes NO
 * redirect decisions — the pilot shell (T3) decides what to render for each
 * status; the middleware (`middleware.ts`) is the actual entry gate.
 */

export type SessionStatus = "loading" | "ready" | "anonymous" | "unavailable";

export interface SessionContextValue {
  status: SessionStatus;
  me?: Me;
  /**
   * Whether this deployment has an AI provider configured (`Me.ai_available`).
   * Screens render an assisted control ONLY when it is true, and it is false
   * until `/api/me` has answered — an unknown capability is never treated as
   * available (FOODPROOF_SCREENS.md §5).
   */
  aiAvailable: boolean;
  /**
   * The configured official (government) destination, or null when none is set.
   * The "Open official portal" action is enabled ONLY when this is non-null; it
   * stays null until `/api/me` has answered, so an unknown capability is never
   * treated as available (FOODPROOF_SCREENS.md §7).
   */
  officialPortal: Me["official_portal"];
  /** Re-fetch `/api/me` and update status/me accordingly. */
  refresh(): Promise<void>;
  /** PUT the analytics-consent choice, then refresh `me`. */
  setAnalyticsConsent(consent: boolean): Promise<void>;
  /** DELETE the session, then set status to "anonymous". */
  exit(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [me, setMe] = useState<Me | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const result = await api.me.get();
      setMe(result);
      // The server's answer is the only source of the consent state the client
      // analytics adapter gates on, and it is set here — before any child of
      // this provider renders — so a withdrawal stops the next optional event
      // instead of leaving the browser to send one the server would refuse.
      setClientAnalyticsConsent(result.analytics_consent);
      setStatus("ready");
    } catch (err) {
      setMe(undefined);
      setClientAnalyticsConsent(null);
      if (err instanceof ClientApiError && err.code === "UNAUTHENTICATED") {
        setStatus("anonymous");
        return;
      }
      // DEPENDENCY_UNAVAILABLE, a network failure, or anything unexpected —
      // never silently claim a loaded session.
      setStatus("unavailable");
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Runs once on mount; `refresh` is stable (no external deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAnalyticsConsent = useCallback(
    async (consent: boolean) => {
      await api.me.setAnalyticsConsent(consent);
      await refresh();
    },
    [refresh],
  );

  const exit = useCallback(async () => {
    await api.session.destroy();
    setMe(undefined);
    // The session that carried the consent is gone with it.
    setClientAnalyticsConsent(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      me,
      aiAvailable: me?.ai_available === true,
      officialPortal: me?.official_portal ?? null,
      refresh,
      setAnalyticsConsent,
      exit,
    }),
    [status, me, refresh, setAnalyticsConsent, exit],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession() must be called within a <SessionProvider>.");
  }
  return ctx;
}

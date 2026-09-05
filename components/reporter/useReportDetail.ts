"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReportDetail } from "@/lib/contracts";
import { api } from "@/lib/client/api";
import { toFailure, trackFlowError, type Failure } from "./failure";

/**
 * Load one owned report through the shared client (the only API path allowed to
 * UI code). Exposes the loading / ready / failed states every reporter screen
 * has to render, plus `apply` so a mutation's fresh `ReportDetail` (with its new
 * `version`) replaces the cached copy without a second round trip.
 */
export interface ReportDetailState {
  detail: ReportDetail | null;
  status: "loading" | "ready" | "failed";
  /** True while a re-read is in flight, including a reload of an already-loaded report. */
  refreshing: boolean;
  failure: Failure | null;
  reload: () => Promise<void>;
  apply: (detail: ReportDetail) => void;
}

export function useReportDetail(reportId: string): ReportDetailState {
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const reported = useRef(false);

  const reload = useCallback(async () => {
    setStatus((previous) => (previous === "ready" ? previous : "loading"));
    setRefreshing(true);
    try {
      const result = await api.reports.get(reportId);
      setDetail(result);
      setFailure(null);
      setStatus("ready");
      reported.current = false;
    } catch (error) {
      const next = toFailure(error);
      setFailure(next);
      setStatus("failed");
      if (!reported.current) {
        trackFlowError("load", next);
        reported.current = true;
      }
    } finally {
      setRefreshing(false);
    }
  }, [reportId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const apply = useCallback((next: ReportDetail) => {
    setDetail(next);
    setFailure(null);
    setStatus("ready");
  }, []);

  return { detail, status, refreshing, failure, reload, apply };
}

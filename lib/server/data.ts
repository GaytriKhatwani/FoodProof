import "server-only";
import type {
  PublicFeedItem,
  PublicReport,
  ReportDetail,
  ReportSummary,
  ReviewQueueItem,
} from "@/lib/contracts";
import { notImplementedInT0 } from "./errors";

/**
 * Guarded data-access surface (FOODPROOF_TECHNICAL_SPEC.md §6/§7,
 * FOODPROOF_API_DETAILS.md). Every method enforces session, role, ownership and
 * input checks server-side. The reviewer never gets a generic "list all private
 * reports" call — only review-specific reads. T1 implements; T0 freezes shapes.
 */

export interface ReportDataService {
  listOwnReports(
    accessId: string,
    cursor: string | null,
  ): Promise<{ items: ReportSummary[]; nextCursor: string | null }>;

  getOwnReport(accessId: string, reportId: string): Promise<ReportDetail>;

  getFeed(
    query: { q?: string; cursor?: string },
  ): Promise<{ items: PublicFeedItem[]; nextCursor: string | null }>;

  getPublicReport(reportId: string): Promise<PublicReport>;

  getReviewQueue(): Promise<ReviewQueueItem[]>;
}

export const t0ReportDataService: ReportDataService = {
  listOwnReports: () => notImplementedInT0("ReportDataService.listOwnReports"),
  getOwnReport: () => notImplementedInT0("ReportDataService.getOwnReport"),
  getFeed: () => notImplementedInT0("ReportDataService.getFeed"),
  getPublicReport: () => notImplementedInT0("ReportDataService.getPublicReport"),
  getReviewQueue: () => notImplementedInT0("ReportDataService.getReviewQueue"),
};

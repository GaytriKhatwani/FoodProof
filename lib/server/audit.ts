import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "./supabase";

/**
 * Internal audit trail (`report_events`, FOODPROOF_API_DETAILS.md).
 * The server alone writes these rows — saves, review requests/decisions,
 * withdrawal and relinking. Private reasons live here for the owner timeline but
 * are never projected into public content. Analytics is never the audit log.
 */

export type ReportEventType =
  | "report_created"
  | "report_saved"
  | "facts_confirmed"
  | "evidence_added"
  | "evidence_removed"
  | "evidence_roles_changed"
  | "draft_saved"
  | "submission_recorded"
  | "update_recorded"
  | "report_closed"
  | "report_reopened"
  | "publication_requested"
  | "publication_withdrawn"
  | "review_approved"
  | "review_changes_requested"
  | "review_rejected"
  | "content_removed"
  | "product_relinked"
  | "flag_raised"
  | "flag_resolved";

export async function recordEvent(
  event: {
    reportId: string;
    actorAccessId: string | null;
    type: ReportEventType;
    relatedEntityId?: string | null;
    metadata?: Record<string, unknown> | null;
  },
  client?: SupabaseClient,
): Promise<void> {
  const supabase = client ?? getServiceClient();
  const { error } = await supabase.from("report_events").insert({
    report_id: event.reportId,
    actor_access_id: event.actorAccessId,
    type: event.type,
    related_entity_id: event.relatedEntityId ?? null,
    metadata: event.metadata ?? null,
  });
  if (error) throw error;
}

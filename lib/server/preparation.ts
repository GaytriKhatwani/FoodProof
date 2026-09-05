import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceRole, Preparation } from "@/lib/contracts";
import { getServiceClient } from "./supabase";

/**
 * Server-derived preparation readiness (FOODPROOF_TECHNICAL_SPEC.md §4).
 * `ready` requires product/brand, a concern, confirmed facts, and ready label
 * photos covering identity, claim and ingredients. It is never client-settable
 * and has no transition endpoint; the server recomputes and persists it with the
 * mutation that changes facts or required evidence. This is an internal
 * preparation threshold — NOT evidence of filing, delivery or safety.
 */

export interface PreparationInputs {
  brand: string | null;
  productName: string | null;
  concernText: string | null;
  factsConfirmedAt: string | null;
  labelRoles: Set<EvidenceRole>;
}

export function computePreparation(i: PreparationInputs): Preparation {
  const hasIdentity = Boolean(i.brand?.trim() && i.productName?.trim());
  const hasConcern = Boolean(i.concernText?.trim());
  const hasFacts = Boolean(i.factsConfirmedAt);
  const hasPhotos =
    i.labelRoles.has("identity") &&
    i.labelRoles.has("claim") &&
    i.labelRoles.has("ingredients");
  return hasIdentity && hasConcern && hasFacts && hasPhotos ? "ready" : "draft";
}

/** Union of roles across a report's READY label evidence (only ready counts). */
export async function loadLabelRoles(
  reportId: string,
  client?: SupabaseClient,
): Promise<Set<EvidenceRole>> {
  const supabase = client ?? getServiceClient();
  const { data, error } = await supabase
    .from("evidence")
    .select("roles")
    .eq("report_id", reportId)
    .eq("kind", "label")
    .eq("upload_state", "ready");
  if (error) throw error;
  const roles = new Set<EvidenceRole>();
  for (const row of data ?? []) {
    for (const r of (row.roles ?? []) as EvidenceRole[]) roles.add(r);
  }
  return roles;
}

/**
 * Recompute preparation from current stored state and persist it if changed.
 * Used after evidence changes (which do not touch report scalar fields). Does
 * not bump the report version — preparation is server state, not a user edit.
 */
export async function recomputePreparation(
  reportId: string,
  client?: SupabaseClient,
): Promise<Preparation> {
  const supabase = client ?? getServiceClient();
  const { data: report, error } = await supabase
    .from("reports")
    .select("brand, product_name, concern_text, facts_confirmed_at, preparation")
    .eq("id", reportId)
    .single();
  if (error) throw error;

  const labelRoles = await loadLabelRoles(reportId, supabase);
  const prep = computePreparation({
    brand: report.brand,
    productName: report.product_name,
    concernText: report.concern_text,
    factsConfirmedAt: report.facts_confirmed_at,
    labelRoles,
  });
  if (prep !== report.preparation) {
    const { error: uErr } = await supabase
      .from("reports")
      .update({ preparation: prep })
      .eq("id", reportId);
    if (uErr) throw uErr;
  }
  return prep;
}

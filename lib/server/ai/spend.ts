import "server-only";
import type { Channel } from "@/lib/contracts";
import { getServiceClient } from "../supabase";
import { MIGRATION_0004, mapRpcError } from "../errors";
import type { AiLimits } from "./limits";

/**
 * Durable AI spend ledger (supabase/migrations/0004_publication_atomicity_and_ai_spend.sql).
 * Every provider call reserves its worst-case cost first, then settles the real
 * cost or releases the reservation. Caps and the frequency limit are passed in
 * from `AI_LIMITS` so the server owns them in exactly one place and tests can
 * prove exhaustion with tiny values.
 *
 * The ledger records money, token counts and a model id — never a prompt, an
 * image, an extracted field or a draft.
 */

export type AiOperation = "extract" | "draft";

export interface ReserveInput {
  accessId: string;
  reportId: string | null;
  operation: AiOperation;
  channel: Channel | null;
  model: string;
  reserveMicros: number;
}

export interface Reservation {
  ledgerId: string;
  actorSpentMicros: number;
  totalSpentMicros: number;
}

export interface AiSpendLedger {
  reserve(input: ReserveInput, limits: AiLimits): Promise<Reservation>;
  settle(
    ledgerId: string,
    usage: { settledMicros: number; inputTokens: number; outputTokens: number },
  ): Promise<void>;
  release(ledgerId: string): Promise<void>;
  /** True when this actor already paid for a completed call of this kind. */
  hasSettledCall(
    accessId: string,
    reportId: string,
    operation: AiOperation,
    channel?: Channel,
  ): Promise<boolean>;
}

export const aiSpend: AiSpendLedger = {
  async reserve(input, limits) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc("fp_reserve_ai_spend", {
      p_access_id: input.accessId,
      p_report_id: input.reportId,
      p_operation: input.operation,
      p_channel: input.channel,
      p_model: input.model,
      p_reserve_micros: input.reserveMicros,
      p_per_call_cap_micros: limits.perCallCapMicros,
      p_actor_cap_micros: limits.perInvitationCapMicros,
      p_total_cap_micros: limits.totalCapMicros,
      p_rate_limit_calls: limits.rateLimitCalls,
      p_rate_limit_window_seconds: limits.rateLimitWindowSeconds,
    });
    if (error) throw mapRpcError("fp_reserve_ai_spend", error, MIGRATION_0004);
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      ledgerId: String(row.ledger_id),
      actorSpentMicros: Number(row.actor_spent_micros ?? 0),
      totalSpentMicros: Number(row.total_spent_micros ?? 0),
    };
  },

  async settle(ledgerId, usage) {
    const supabase = getServiceClient();
    const { error } = await supabase.rpc("fp_settle_ai_spend", {
      p_ledger_id: ledgerId,
      p_settled_micros: usage.settledMicros,
      p_input_tokens: usage.inputTokens,
      p_output_tokens: usage.outputTokens,
    });
    if (error) throw mapRpcError("fp_settle_ai_spend", error, MIGRATION_0004);
  },

  async release(ledgerId) {
    const supabase = getServiceClient();
    const { error } = await supabase.rpc("fp_release_ai_spend", {
      p_ledger_id: ledgerId,
    });
    if (error) throw mapRpcError("fp_release_ai_spend", error, MIGRATION_0004);
  },

  async hasSettledCall(accessId, reportId, operation, channel) {
    const supabase = getServiceClient();
    let query = supabase
      .from("ai_spend_ledger")
      .select("id")
      .eq("access_id", accessId)
      .eq("report_id", reportId)
      .eq("operation", operation)
      .eq("state", "settled")
      .limit(1);
    if (channel) query = query.eq("channel", channel);
    const { data, error } = await query;
    if (error) throw mapRpcError("ai_spend_ledger", error, MIGRATION_0004);
    return (data ?? []).length > 0;
  },
};

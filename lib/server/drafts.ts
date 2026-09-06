import "server-only";
import type {
  Channel,
  ComplaintDraft,
  ComplaintDraftWriteRequest,
} from "@/lib/contracts";
import { ApiError } from "./errors";
import { getServiceClient } from "./supabase";
import { loadOwnedReport } from "./data";
import { recordEvent } from "./audit";
import { withReceipt } from "./idempotency";
import { aiSpend } from "./ai/spend";

/**
 * Complaint drafts (FOODPROOF_TECHNICAL_SPEC.md §8, FOODPROOF_API_DETAILS.md).
 * `prepare` returns a deterministic, editable template — it never claims a save
 * or an external send. Saving is a separate explicit action with optimistic
 * concurrency on the draft. Demo drafts are prominently labelled sample content;
 * testers must not send fictional complaints to real recipients.
 */

interface TemplateReport {
  brand: string;
  product_name: string;
  variant: string | null;
  batch_number: string | null;
  observation_date: string | null;
  concern_text: string | null;
  claim_text: string | null;
  ingredients_text: string | null;
  facts_confirmed_at: string | null;
}

/**
 * Exported so the assisted path (lib/server/ai/) instructs the provider to keep
 * the identical notice and then re-asserts it on the returned body: template and
 * assisted drafts must be labelled sample content in exactly the same words.
 */
export const SAMPLE_NOTICE =
  "SAMPLE / DEMONSTRATION CONTENT — this is a fictional practice complaint. Do not send it to any real brand or authority.";

export function buildTemplate(
  report: TemplateReport,
  channel: Channel,
): { subject: string; body: string } {
  const identity = [report.brand, report.product_name, report.variant]
    .filter(Boolean)
    .join(" ");
  const recipient =
    channel === "government"
      ? "Food Safety Connect (consumer grievance)"
      : `${report.brand} consumer care`;
  const subject =
    channel === "government"
      ? `Consumer grievance: ${identity} — food labelling concern`
      : `Labelling concern about ${identity}`;

  const lines: string[] = [];
  lines.push(SAMPLE_NOTICE, "");
  lines.push(`To: ${recipient}`, "");
  lines.push(
    channel === "government"
      ? "I am submitting a consumer grievance about a possible food-labelling problem."
      : "I am writing about a possible labelling problem with your product.",
    "",
  );
  lines.push("Product");
  lines.push(`- Brand: ${report.brand}`);
  lines.push(`- Product: ${report.product_name}`);
  if (report.variant) lines.push(`- Variant: ${report.variant}`);
  if (report.batch_number) lines.push(`- Batch: ${report.batch_number}`);
  if (report.observation_date) lines.push(`- Observed on: ${report.observation_date}`);
  lines.push("");
  lines.push("Concern");
  lines.push(report.concern_text?.trim() || "(describe the concern)");
  lines.push("");
  lines.push("What the label states");
  lines.push(`- Claim: ${report.claim_text?.trim() || "(not provided)"}`);
  lines.push(`- Ingredients: ${report.ingredients_text?.trim() || "(not provided)"}`);
  lines.push("");
  lines.push("Evidence I can provide");
  lines.push("- Photographs of the product identity, claim and ingredient panels.");
  lines.push("- Purchase receipt, if requested.");
  lines.push("");
  lines.push(
    channel === "government"
      ? "Requested action: please review whether the labelling meets the applicable requirement and advise on next steps."
      : "Requested action: please clarify the labelling and correct it if it is inaccurate.",
  );
  lines.push("");
  lines.push("[Add your name and contact details here before sending.]");
  lines.push("");
  lines.push(SAMPLE_NOTICE);

  return { subject, body: lines.join("\n") };
}

export async function prepareDraft(
  accessId: string,
  reportId: string,
  channel: Channel,
): Promise<{ channel: Channel; subject: string; body: string; method: "template" }> {
  const supabase = getServiceClient();
  const report = await loadOwnedReport(accessId, reportId, supabase);
  if (!report.facts_confirmed_at) {
    throw new ApiError("VALIDATION_FAILED", "Confirm the label facts before preparing a complaint.");
  }
  const { subject, body } = buildTemplate(report, channel);
  return { channel, subject, body, method: "template" };
}

export async function saveComplaintDraft(
  accessId: string,
  reportId: string,
  channel: Channel,
  body: ComplaintDraftWriteRequest,
  idempotencyKey: string,
): Promise<ComplaintDraft> {
  return withReceipt(
    accessId,
    "draft.save",
    idempotencyKey,
    { reportId, channel, body },
    async () => {
      const supabase = getServiceClient();
      await loadOwnedReport(accessId, reportId, supabase);

      // `assisted` must be earned: only a real, settled assisted draft for THIS
      // channel can have produced this text. `template` and `manual` saves are
      // unaffected and keep working with AI switched off.
      if (body.method === "assisted") {
        const assisted = await aiSpend.hasSettledCall(
          accessId,
          reportId,
          "draft",
          channel,
        );
        if (!assisted) {
          throw new ApiError(
            "VALIDATION_FAILED",
            "No assisted draft exists for this channel.",
          );
        }
      }

      const { data: existing, error: exErr } = await supabase
        .from("complaint_drafts")
        .select("id, version")
        .eq("report_id", reportId)
        .eq("channel", channel)
        .maybeSingle();
      if (exErr) throw exErr;

      let saved: Record<string, unknown>;
      if (existing) {
        if (body.expected_version !== existing.version) {
          throw new ApiError("CONFLICT", "This draft changed since you loaded it.");
        }
        const { data, error } = await supabase
          .from("complaint_drafts")
          .update({
            subject: body.subject,
            body: body.body,
            method: body.method,
            version: existing.version + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .eq("version", existing.version)
          .select("*")
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new ApiError("CONFLICT", "This draft changed since you loaded it.");
        saved = data;
      } else {
        if (body.expected_version !== null) {
          throw new ApiError("CONFLICT", "This draft does not exist yet; expected_version must be null.");
        }
        const { data, error } = await supabase
          .from("complaint_drafts")
          .insert({
            report_id: reportId,
            channel,
            subject: body.subject,
            body: body.body,
            method: body.method,
            version: 0,
          })
          .select("*")
          .single();
        if (error) throw error;
        saved = data;
      }

      await recordEvent({
        reportId,
        actorAccessId: accessId,
        type: "draft_saved",
        relatedEntityId: saved.id as string,
        metadata: { channel, method: body.method },
      });

      return {
        id: saved.id as string,
        channel: saved.channel as Channel,
        subject: saved.subject as string,
        body: saved.body as string,
        method: saved.method as ComplaintDraft["method"],
        version: saved.version as number,
        updated_at: saved.updated_at as string,
      };
    },
  );
}

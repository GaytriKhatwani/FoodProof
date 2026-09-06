"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Channel, DraftMethod, ReportDetail } from "@/lib/contracts";
import { api } from "@/lib/client/api";
import { clientAnalytics } from "@/lib/analytics";
import { useSession } from "@/lib/client/session";
import { formatWait } from "@/components/shell/errors";
import { SubmissionDialog } from "./dialogs";
import { useAiDisclosure } from "./AiDisclosure";
import { toFailure, trackFlowError, useIdempotencyKeys, type Failure } from "./failure";
import { useReportDetail } from "./useReportDetail";
import {
  DemoDataNote,
  FailureNotice,
  Loading,
  SaveState,
  TextField,
  cx,
  formatDate,
} from "./ui";
import styles from "./reporter.module.css";

/**
 * Action preparation and external handoff — `/pilot/reports/:id/actions`
 * (docs/FOODPROOF_SCREENS.md §7, docs/FOODPROOF_WORKFLOWS.md §4–§5).
 *
 * The baseline is the server's deterministic template built from confirmed
 * facts; nothing here invents a fact, a legal citation or a safety conclusion.
 * Copying is not sending. Opening an email app is not sending. Recording a
 * submission is the reporter's own note that they sent something elsewhere.
 *
 * Where the backend is configured (`Me.ai_available`), the reporter may ask for
 * an assisted draft of the same confirmed facts. It arrives as editable text
 * like the template, is saved only by the explicit save, and is recorded as
 * `assisted` ONLY when it really came from an assisted call — a template stays
 * `template` (FOODPROOF_MEASUREMENT_AND_PILOT.md §4).
 */

const CHANNEL_LABEL: Record<Channel, string> = {
  brand: "Brand message",
  government: "Official complaint",
};

interface DraftText {
  subject: string;
  body: string;
}

export function ActionsScreen({ reportId }: { reportId: string }) {
  const { detail, status, refreshing, failure, reload } = useReportDetail(reportId);
  const { keyFor, settled } = useIdempotencyKeys();
  const { aiAvailable, officialPortal } = useSession();
  const aiDisclosure = useAiDisclosure();
  const [channel, setChannel] = useState<Channel>("brand");
  const [texts, setTexts] = useState<Partial<Record<Channel, DraftText>>>({});
  /**
   * Where the text on screen came from, per channel. It is what `save()` claims
   * to the server, so it is only ever `assisted` after a real assisted draft for
   * that channel; the deterministic template stays `template`.
   */
  const [methods, setMethods] = useState<Partial<Record<Channel, DraftMethod>>>({});
  /**
   * The unedited text a channel was last seeded with. Only needed while no
   * draft is saved yet — once one exists it is the baseline itself.
   */
  const [baselines, setBaselines] = useState<Partial<Record<Channel, DraftText>>>({});
  const [preparing, setPreparing] = useState(false);
  const [prepareFailure, setPrepareFailure] = useState<Failure | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftFailure, setDraftFailure] = useState<Failure | null>(null);
  const draftingRef = useRef(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [saveFailure, setSaveFailure] = useState<Failure | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "blocked">("idle");
  const [recipient, setRecipient] = useState("");
  const [handoffNote, setHandoffNote] = useState<string | null>(null);
  const [submissionOpen, setSubmissionOpen] = useState(false);
  const copyAreaRef = useRef<HTMLTextAreaElement | null>(null);

  const savedDraft = detail?.complaint_drafts.find((draft) => draft.channel === channel);
  const current = texts[channel];
  const draftMethod = methods[channel] ?? "template";
  /**
   * What replacing the text on screen would discard: the saved draft once one
   * exists, otherwise the text this channel was seeded with.
   */
  const baseline = savedDraft ?? baselines[channel];
  const unsavedChanges = Boolean(
    current &&
      baseline &&
      (current.subject !== baseline.subject || current.body !== baseline.body),
  );

  const prepare = useCallback(
    async (report: ReportDetail, target: Channel) => {
      setPreparing(true);
      setPrepareFailure(null);
      try {
        const template = await api.reports.prepare(report.report_id, { channel: target });
        const text = { subject: template.subject, body: template.body };
        setTexts((entries) => ({ ...entries, [target]: text }));
        setBaselines((entries) => ({ ...entries, [target]: text }));
        setMethods((entries) => ({ ...entries, [target]: "template" }));
      } catch (error) {
        const next = toFailure(error);
        setPrepareFailure(next);
        trackFlowError("prepare_draft", next);
      } finally {
        setPreparing(false);
      }
    },
    [],
  );

  // Seed the editor: a saved draft wins, otherwise the deterministic template.
  // Text already typed is never replaced by this effect.
  useEffect(() => {
    if (!detail || current || preparing || prepareFailure) return;
    if (savedDraft) {
      setTexts((entries) => ({
        ...entries,
        [channel]: { subject: savedDraft.subject, body: savedDraft.body },
      }));
      // A saved draft carries its own recorded method; re-saving it unchanged
      // must not relabel assisted text as a template, or the other way round.
      setMethods((entries) => ({ ...entries, [channel]: savedDraft.method }));
      return;
    }
    if (!detail.facts_confirmed_at) return;
    void prepare(detail, channel);
  }, [channel, current, detail, prepare, prepareFailure, preparing, savedDraft]);

  const save = useCallback(async () => {
    if (!detail || !current) return;
    setSaveState("saving");
    setSaveFailure(null);
    const body = {
      subject: current.subject,
      body: current.body,
      method: methods[channel] ?? ("template" as const),
      expected_version: savedDraft?.version ?? null,
    };
    const key = keyFor(`draft.save:${channel}`, body);
    try {
      await api.complaintDrafts.save(detail.report_id, channel, body, key);
      settled(`draft.save:${channel}`);
      setSaveState("saved");
      await reload();
    } catch (error) {
      const next = toFailure(error);
      setSaveState("failed");
      setSaveFailure(next);
      trackFlowError("save", next);
    }
  }, [channel, current, detail, keyFor, methods, reload, savedDraft?.version, settled]);

  /**
   * Ask the provider to draft this channel's message from the facts the
   * reporter already confirmed. It replaces only the editable text on screen:
   * nothing is saved, nothing is sent, and a failure leaves the current
   * template or draft exactly as it is.
   */
  const draftWithAssistance = useCallback(async () => {
    if (!detail || draftingRef.current) return;
    if (
      unsavedChanges &&
      !window.confirm(
        "Replace what is on screen with a draft written with AI assistance from your confirmed facts? Your saved draft is not changed until you save again.",
      )
    ) {
      return;
    }
    draftingRef.current = true;
    setDrafting(true);
    setDraftFailure(null);
    try {
      const result = await api.ai.draft(detail.report_id, { channel });
      const text = { subject: result.subject, body: result.body };
      setTexts((entries) => ({ ...entries, [channel]: text }));
      setBaselines((entries) => ({ ...entries, [channel]: text }));
      setMethods((entries) => ({ ...entries, [channel]: "assisted" }));
      setSaveState("idle");
      setCopyState("idle");
    } catch (error) {
      // Not reported as `flow_error_shown`: its `operation` enum has no
      // assisted value, and the template path is untouched by this failure.
      setDraftFailure(toFailure(error));
    } finally {
      draftingRef.current = false;
      setDrafting(false);
    }
  }, [channel, detail, unsavedChanges]);

  const copy = useCallback(async () => {
    if (!detail || !current) return;
    const text = `${current.subject}\n\n${current.body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
      // Client-owned event: the clipboard write actually succeeded.
      clientAnalytics.track("complaint_text_copied", {
        report_id: detail.report_id,
        channel,
      });
    } catch {
      setCopyState("blocked");
      copyAreaRef.current?.select();
    }
  }, [channel, current, detail]);

  const openEmail = useCallback(() => {
    if (!detail || !current) return;
    const href = `mailto:${encodeURIComponent(recipient.trim())}?subject=${encodeURIComponent(
      current.subject,
    )}&body=${encodeURIComponent(current.body)}`;
    setHandoffNote(
      "Your email app was asked to open a new message. Nothing has been sent, no file was attached, and FoodProof cannot tell whether the app opened.",
    );
    clientAnalytics.track("brand_email_opened", { report_id: detail.report_id });
    window.location.href = href;
  }, [current, detail, recipient]);

  const openOfficial = useCallback(() => {
    if (!detail || !officialPortal) return;
    setHandoffNote(
      "The official portal was opened in a new tab. FoodProof sent nothing, filed no complaint, and attached no evidence — you complete and submit the form yourself on the government site.",
    );
    // Client-owned event: fired only when a configured, allowlisted destination
    // was actually opened. The key identifies the destination without content.
    clientAnalytics.track("official_channel_opened", {
      report_id: detail.report_id,
      destination_key: officialPortal.key,
    });
    window.open(officialPortal.url, "_blank", "noopener,noreferrer");
  }, [detail, officialPortal]);

  if (status === "loading") {
    return (
      <section className={styles.screen}>
        <h1 className={styles.title}>Prepare a complaint</h1>
        <Loading what="this report" />
      </section>
    );
  }

  if (status === "failed" || !detail) {
    return (
      <section className={styles.screen}>
        <h1 className={styles.title}>Prepare a complaint</h1>
        {failure ? <FailureNotice failure={failure} onRetry={() => void reload()} /> : null}
        <div className={styles.actions}>
          <Link className={styles.btnSecondary} href="/pilot/reports">
            Back to my reports
          </Link>
        </div>
      </section>
    );
  }

  const factsConfirmed = Boolean(detail.facts_confirmed_at);

  return (
    <section className={styles.screen} aria-labelledby="actions-title">
      {aiDisclosure.dialog}
      <div className={styles.head}>
        <div className={styles.headMain}>
          <h1 className={styles.title} id="actions-title">
            Prepare a complaint
          </h1>
          <p className={styles.lede}>
            Prepare the words here, then send them yourself through your own
            channel. FoodProof never sends anything for you.
          </p>
        </div>
        <Link className={styles.btnSecondary} href={`/pilot/reports/${detail.report_id}`}>
          Back to the record
        </Link>
      </div>

      <DemoDataNote />

      <p className={styles.alert}>
        This is a fictional pilot exercise. Do not send these practice messages to
        a real brand or a real authority.
      </p>

      <div className={styles.tabs} role="group" aria-label="Message channel">
        {(["brand", "government"] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={styles.tab}
            aria-pressed={channel === option}
            onClick={() => {
              setChannel(option);
              setSaveState("idle");
              setSaveFailure(null);
              setCopyState("idle");
              setHandoffNote(null);
              setPrepareFailure(null);
              setDraftFailure(null);
            }}
          >
            {CHANNEL_LABEL[option]}
          </button>
        ))}
      </div>

      {!factsConfirmed ? (
        <div className={styles.panel}>
          <h2 className={styles.subTitle}>Confirm your label facts first</h2>
          <p>
            The draft is built only from facts you have checked against your own
            photo, so nothing in it is invented. Confirm the label wording in the
            editor and this screen will prepare the message.
          </p>
          <div className={styles.actions}>
            <Link className="btn-primary" href={`/pilot/reports/${detail.report_id}/edit`}>
              Confirm the label facts
            </Link>
          </div>
        </div>
      ) : null}

      <section className={styles.section} aria-labelledby="facts-title">
        <h2 className={styles.sectionTitle} id="facts-title">
          What the draft is built from
        </h2>
        <ul className={styles.checklist}>
          {[
            { label: "Product and brand", value: `${detail.brand} · ${detail.product_name}`, done: true },
            { label: "Label claim you confirmed", value: detail.claim_text, done: Boolean(detail.claim_text) },
            {
              label: "Ingredient wording you confirmed",
              value: detail.ingredients_text,
              done: Boolean(detail.ingredients_text),
            },
            { label: "Your concern", value: detail.concern_text, done: Boolean(detail.concern_text) },
            {
              label: "Observation date",
              value: detail.observation_date ? formatDate(detail.observation_date) : null,
              done: Boolean(detail.observation_date),
            },
            { label: "Batch number", value: detail.batch_number, done: Boolean(detail.batch_number) },
          ].map((item) => (
            <li
              key={item.label}
              className={cx(styles.checkItem, item.done ? styles.checkDone : styles.checkTodo)}
            >
              <span className={styles.checkMark}>{item.done ? "Supplied" : "Missing"}</span>{" "}
              <span>
                {item.label}
                {item.done && item.value ? `: ${item.value}` : ""}
              </span>
            </li>
          ))}
        </ul>
        <p className={styles.small}>
          Missing information is named in the draft rather than guessed. Add it in
          the editor if you want it included.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="draft-title">
        <h2 className={styles.sectionTitle} id="draft-title">
          {CHANNEL_LABEL[channel]}
        </h2>

        {preparing ? <Loading what="the template" /> : null}
        {prepareFailure ? (
          <FailureNotice
            failure={prepareFailure}
            onRetry={() => void prepare(detail, channel)}
            retryLabel="Try preparing again"
          />
        ) : null}

        {current ? (
          <>
            <TextField
              id={`draft-subject-${channel}`}
              label="Subject"
              value={current.subject}
              onChange={(value) => {
                setTexts((entries) => ({
                  ...entries,
                  [channel]: { subject: value, body: current.body },
                }));
                setSaveState("idle");
                setCopyState("idle");
              }}
            />
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`draft-body-${channel}`}>
                Message
              </label>
              <textarea
                id={`draft-body-${channel}`}
                ref={copyAreaRef}
                className={styles.textarea}
                rows={18}
                value={current.body}
                aria-describedby={`draft-body-${channel}-hint`}
                onChange={(event) => {
                  setTexts((entries) => ({
                    ...entries,
                    [channel]: { subject: current.subject, body: event.target.value },
                  }));
                  setSaveState("idle");
                  setCopyState("idle");
                }}
              />
              <span className={styles.hint} id={`draft-body-${channel}-hint`}>
                Editable. Add your own name and contact details in your email or
                the portal, not here.
              </span>
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void save()}
                disabled={saveState === "saving" || refreshing}
              >
                Save draft
              </button>
              <button type="button" className={styles.btnSecondary} onClick={() => void copy()}>
                Copy message
              </button>
              {savedDraft ? (
                <button
                  type="button"
                  className={styles.btnQuiet}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Replace what is on screen with a fresh template built from your confirmed facts? Your saved draft is not changed until you save again.",
                      )
                    ) {
                      setTexts((entries) => ({ ...entries, [channel]: undefined }));
                      void prepare(detail, channel);
                    }
                  }}
                >
                  Start again from the template
                </button>
              ) : null}
              {aiAvailable && factsConfirmed ? (
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => aiDisclosure.run(draftWithAssistance)}
                  disabled={drafting}
                >
                  Draft with AI assistance
                </button>
              ) : null}
            </div>
            {drafting ? (
              <p className={styles.saveState} role="status" aria-live="polite">
                Drafting…
              </p>
            ) : null}
            {draftFailure ? (
              <div className={styles.alert} role="status">
                <p>AI assistance unavailable—continue manually.</p>
                {draftFailure.retryAfterSeconds != null ? (
                  <p>{formatWait(draftFailure.retryAfterSeconds)}</p>
                ) : null}
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => void draftWithAssistance()}
                    disabled={drafting}
                  >
                    Try again
                  </button>
                </div>
              </div>
            ) : null}
            {draftMethod === "assisted" ? (
              <p className={styles.inset} role="status">
                This draft was written with AI assistance from the facts you
                confirmed. It is a suggestion — check every line, edit it, and
                save it yourself. Nothing has been sent.
              </p>
            ) : null}
            <SaveState state={saveState} />
            {refreshing ? (
              <p className={styles.saveState} role="status" aria-live="polite">
                Reloading the saved draft…
              </p>
            ) : null}
            {savedDraft ? (
              <p className={styles.small}>
                A draft for this channel is saved ({savedDraft.method}, version{" "}
                {savedDraft.version}). Saving a draft does not send it.
              </p>
            ) : null}
            {saveFailure ? (
              <FailureNotice
                failure={saveFailure}
                onRetry={saveFailure.kind === "stale" ? undefined : () => void save()}
                onReload={saveFailure.kind === "stale" ? () => void reload() : undefined}
              />
            ) : null}
            {copyState === "copied" ? (
              <p className={styles.okNote} role="status">
                Copied to your clipboard. Copying is not sending — nothing has left
                FoodProof.
              </p>
            ) : null}
            {copyState === "blocked" ? (
              <p className={styles.alert} role="alert">
                Your browser blocked the copy. The message above is selected —
                copy it by hand. Nothing was sent.
              </p>
            ) : null}
          </>
        ) : null}

        <p className={styles.small}>
          The template is deterministic and built only from the facts you
          confirmed.
          {aiAvailable
            ? " An assisted draft rewrites those same facts: it cannot add a fact you did not confirm, you edit it, and you save it yourself."
            : ""}
        </p>
      </section>

      <section className={styles.section} aria-labelledby="handoff-title">
        <h2 className={styles.sectionTitle} id="handoff-title">
          Send it yourself
        </h2>
        <p className={styles.small}>
          You send outside FoodProof. Opening a destination is not submission, and
          any evidence must be attached by you where it is required.
        </p>

        {channel === "brand" ? (
          <>
            <TextField
              id="brand-recipient"
              label="Brand email address"
              type="email"
              value={recipient}
              hint="You confirm this address. FoodProof never guesses a brand's contact details, and this address is not saved."
              onChange={(value) => {
                setRecipient(value);
                setHandoffNote(null);
              }}
            />
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={openEmail}
                disabled={!current || !recipient.trim()}
              >
                Open my email app
              </button>
            </div>
            <p className={styles.small}>
              This only asks your device to open a new message with the text
              filled in. It attaches no files, sends nothing, and proves nothing
              about delivery. If your email app opens empty, use Copy message and
              paste it.
            </p>
          </>
        ) : (
          <>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={openOfficial}
                disabled={!current || !officialPortal}
              >
                Open official portal
              </button>
            </div>
            {officialPortal ? (
              <p className={styles.small}>
                This opens the official government portal in a new tab. FoodProof
                files nothing and attaches nothing — you complete and submit the
                complaint yourself there, attaching any evidence where the form
                asks for it. Use Copy message first to paste your prepared text.
              </p>
            ) : (
              <p className={styles.inset}>
                Official destination not configured. The owner has to choose and
                verify the real government destination before this button can
                work, so it deliberately does nothing here and no government form
                is opened. Use Copy message and go to the official portal
                yourself.
              </p>
            )}
          </>
        )}

        {handoffNote ? (
          <p className={styles.okNote} role="status">
            {handoffNote}
          </p>
        ) : null}
      </section>

      <section className={styles.section} aria-labelledby="record-title">
        <h2 className={styles.sectionTitle} id="record-title">
          After you have sent it
        </h2>
        <p className={styles.small}>
          Recording a submission is your own note that you sent something. It
          creates no message and confirms no delivery.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => setSubmissionOpen(true)}
          >
            Record that you sent it
          </button>
          <Link className={styles.btnQuiet} href={`/pilot/reports/${detail.report_id}`}>
            See the recorded history
          </Link>
        </div>
        <p className={styles.small}>
          {detail.submissions.filter((item) => item.channel === channel).length} submission
          {detail.submissions.filter((item) => item.channel === channel).length === 1 ? "" : "s"}{" "}
          recorded by you on this channel.
        </p>
      </section>

      {submissionOpen ? (
        <SubmissionDialog
          report={detail}
          channel={channel}
          onClose={() => setSubmissionOpen(false)}
          onSaved={reload}
        />
      ) : null}
    </section>
  );
}

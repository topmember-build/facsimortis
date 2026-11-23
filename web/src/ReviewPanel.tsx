import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import type { Field, FieldName } from '../../src/extract/schema.js';
import { FORMAT_HINTS, editLabel } from './edit-hints';
import { FIELD_LABELS, NOT_FOUND_TEXT } from './field-labels';
import { formatReceived } from './format';
import { ACCEPTED_DESPITE_TEXT, summaryLines, verifiedLine, type Summary, type VerifiedRecord } from './record';
import {
  LAID_TO_REST,
  VERIFY_NOTE,
  fieldReview,
  isOriginallyFlagged,
  sortForReview,
  standingFlags,
  type ReviewState,
} from './review-state';

export const NOT_READ_TEXT = 'Not read';
/** Shown beside a field after a Save that matched the value it would replace. */
export const NO_CHANGE_TEXT = 'No change made';

/** Field column section headings and their plain lines. */
export const NEEDS_EYES_HEADING = 'Needs your eyes';
export const NO_FLAGGED_TEXT = 'No fields are flagged.';
export const READ_CLEANLY_HEADING = 'Read cleanly';
export const READ_CLEANLY_NOTE = 'Read by the reader. Not checked by a person until you review it.';
export const NO_CLEAN_TEXT = 'None.';
export const ACCEPT_LABEL = 'Accept anyway';

/** The one provenance line on a field card. Plain statements about where the value came from. */
export function provenanceLine(pageValue: string | null, entered: string | null, accepted: boolean): string {
  if (entered !== null) return `Entered by you. Read from the page: ${pageValue ?? NOT_READ_TEXT}`;
  if (pageValue === null) return accepted ? 'Not on the page, confirmed by you' : 'Nothing was read from the page';
  return accepted ? 'Read from the page, accepted by you' : 'Read from the page';
}
function ConfidenceBar({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);
  return (
    <span className="confidence">
      <span>Confidence: {percent}%</span>
      <span className="confidence-bar" aria-hidden="true">
        <span className="confidence-fill" style={{ width: `${percent}%` }} />
      </span>
    </span>
  );
}

function EditForm({
  field,
  initial,
  onSave,
  onCancel,
}: {
  field: Field;
  /** What the box starts with: the reviewer's earlier value, else the value as read. */
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const emptyId = `${inputId}-empty`;
  const hint = FORMAT_HINTS[field.name];
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initial);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const canSave = text.trim() !== '';
  const describedBy = [hint ? hintId : null, canSave ? null : emptyId].filter(Boolean).join(' ') || undefined;

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <form
      className="edit-form"
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) onSave(text.trim());
      }}
    >
      <label htmlFor={inputId} className="edit-label">
        {editLabel(FIELD_LABELS[field.name])}
      </label>
      <input
        id={inputId}
        ref={input}
        type="text"
        value={text}
        autoComplete="off"
        aria-describedby={describedBy}
        onChange={(event) => setText(event.target.value)}
      />
      {hint && (
        <p id={hintId} className="format-hint">
          {hint.text}
        </p>
      )}
      {!canSave && (
        <p id={emptyId} className="edit-hint">
          Type a value to save it. To keep the field empty, use Accept.
        </p>
      )}
      <div className="edit-buttons">
        <button type="submit" className="button button-strong" disabled={!canSave}>
          Save
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

interface FieldRowProps {
  field: Field;
  state: ReviewState;
  referenceDate: string;
  /** The reader flagged this field (it sits under "Needs your eyes"). */
  flagged: boolean;
  selected: boolean;
  editing: boolean;
  /** The last Save on this field changed nothing. */
  noChange: boolean;
  onSelect: () => void;
  onAccept: () => void;
  onEditOpen: () => void;
  onSave: (text: string) => void;
  onCancel: () => void;
  /** Verified: values are shown, Accept and Edit are hidden. */
  readOnly: boolean;
}

function FieldRow({ field, state, referenceDate, flagged, selected, editing, noChange, onSelect, onAccept, onEditOpen, onSave, onCancel, readOnly }: FieldRowProps) {
  const label = FIELD_LABELS[field.name];
  const review = fieldReview(state, field.name);
  const edited = review.enteredValue !== null;
  // Flags that still stand: the reader's flags until acted on, or the validator's message for a bad edit.
  const standing = standingFlags(field, state, referenceDate);
  const pending = standing.length > 0;

  // Flagged cards are compact until selected; the selected flagged card is expanded.
  const classes = ['field-row', 'field-card', flagged ? 'field-flagged' : 'field-clean'];
  if (selected) classes.push('field-selected');
  if (selected && flagged) classes.push('field-expanded');
  const expanded = selected && flagged;

  return (
    <li className={classes.join(' ')}>
      {selected && (
        // Text cue for the selected card (not colour alone). The button itself says it with aria-pressed.
        <span className="selected-tag" aria-hidden="true">
          Selected
        </span>
      )}
      <button
        type="button"
        className="field-item"
        aria-pressed={selected}
        data-field={field.name}
        onClick={onSelect}
      >
        <span className="field-head">
          <span className="field-name">{label}</span>
          {noChange && !editing && !readOnly && (
            <span className="field-note no-change" data-no-change="true">{NO_CHANGE_TEXT}</span>
          )}
        </span>
        <span className={!edited && field.value === null ? 'field-value field-empty' : 'field-value'}>
          {edited ? review.enteredValue : (field.value ?? NOT_FOUND_TEXT)}
        </span>
        <span className="field-meta">
          <span className="field-note" data-provenance="true">
            {provenanceLine(field.value, review.enteredValue, review.accepted)}
          </span>
          {field.value === null ? (
            !edited && <span className="confidence">{NOT_READ_TEXT}</span>
          ) : (
            <ConfidenceBar confidence={field.confidence} />
          )}
        </span>
        {standing.map((message) => (
          <span key={message} className="field-flag">
            <span aria-hidden="true">⚑</span> <span>{message}</span>
          </span>
        ))}
        {review.acceptedDespiteFlag && (
          <span className="field-flag" data-accepted-despite="true">
            <span aria-hidden="true">⚠</span> <span>{ACCEPTED_DESPITE_TEXT}</span>
            {review.failedChecks.map((message) => (
              <span key={message} className="field-check">
                {message}
              </span>
            ))}
          </span>
        )}
      </button>
      {!readOnly && (
        <div className="field-actions">
          {pending && (
            <button type="button" className="button button-compact button-accept" data-accept={field.name} onClick={onAccept}>
              {ACCEPT_LABEL}{' '}<span className="sr-only">{label}</span>
            </button>
          )}
          <button
            type="button"
            className={expanded ? 'button button-compact button-fill' : 'button button-compact'}
            data-edit={field.name}
            aria-expanded={editing}
            onClick={onEditOpen}
          >
            Edit{' '}<span className="sr-only">{label}</span>
          </button>
        </div>
      )}
      {editing && !readOnly && (
        <EditForm
          field={field}
          initial={review.enteredValue ?? field.value ?? ''}
          onSave={onSave}
          onCancel={onCancel}
        />
      )}
    </li>
  );
}

export interface ReviewPanelProps {
  /** The reader's fields exactly as read, in schema order. */
  fields: readonly Field[];
  state: ReviewState;
  /** "Today" for date checks (YYYY-MM-DD), from the sample index. */
  referenceDate: string;
  selected: FieldName | null;
  editing: FieldName | null;
  /** The field whose last Save changed nothing, or null. */
  noChange: FieldName | null;
  panelRef: Ref<HTMLDivElement>;
  onSelect: (name: FieldName) => void;
  onAccept: (field: Field) => void;
  onEditOpen: (name: FieldName) => void;
  onSave: (field: Field, text: string) => void;
  onCancel: (name: FieldName) => void;
  /** The verified record, when there is one. The panel is then read-only. */
  verified: VerifiedRecord | null;
  onDownload: () => void;
}

/** The review panel: sorted fields with their actions (Verify record lives in the summary bar). */
export function ReviewPanel(props: ReviewPanelProps) {
  const { fields, state, referenceDate } = props;
  const headingBase = useId();
  const flaggedId = `${headingBase}-flagged`;
  const cleanId = `${headingBase}-clean`;
  // Same order as before: flagged fields first, then the rest. Flagged means flagged as read, so a
  // card does not change section while it is reviewed.
  const sorted = sortForReview(fields);
  const flagged = sorted.filter(isOriginallyFlagged);
  const clean = sorted.filter((field) => !isOriginallyFlagged(field));
  const rows = (list: readonly Field[], isFlagged: boolean) =>
    list.map((field) => (
      <FieldRow
        key={field.name}
        field={field}
        state={state}
        referenceDate={referenceDate}
        flagged={isFlagged}
        selected={props.selected === field.name}
        editing={props.editing === field.name}
        noChange={props.noChange === field.name}
        onSelect={() => props.onSelect(field.name)}
        onAccept={() => props.onAccept(field)}
        onEditOpen={() => props.onEditOpen(field.name)}
        onSave={(text) => props.onSave(field, text)}
        onCancel={() => props.onCancel(field.name)}
        readOnly={props.verified !== null}
      />
    ));
  return (
    <div ref={props.panelRef} className="review-panel">
      <div className="field-section" data-section="needs-your-eyes">
        <h3 id={flaggedId} className="field-section-title field-section-title-flagged">
          {NEEDS_EYES_HEADING}
        </h3>
        {flagged.length > 0 ? (
          <ul className="field-list" aria-labelledby={flaggedId}>
            {rows(flagged, true)}
          </ul>
        ) : (
          <p className="field-section-empty">{NO_FLAGGED_TEXT}</p>
        )}
      </div>
      <div className="field-section" data-section="read-cleanly">
        <h3 id={cleanId} className="field-section-title field-section-title-clean">
          {READ_CLEANLY_HEADING}
        </h3>
        <p className="field-section-note">{READ_CLEANLY_NOTE}</p>
        {clean.length > 0 ? (
          <ul className="field-list" aria-labelledby={cleanId}>
            {rows(clean, false)}
          </ul>
        ) : (
          <p className="field-section-empty">{NO_CLEAN_TEXT}</p>
        )}
      </div>
      {props.verified && <LaidToRest record={props.verified} onDownload={props.onDownload} />}
    </div>
  );
}

/** The calm verified state: a plain statement, the Download JSON action, nothing else. */
export function LaidToRest({ record, onDownload }: { record: VerifiedRecord; onDownload: () => void }) {
  const despite = record.fields.filter((field) => field.acceptedDespiteFlag);
  return (
    <div className="laid-to-rest" data-laid-to-rest="true">
      <h3 className="rest-title">{LAID_TO_REST}</h3>
      <p>{verifiedLine(record.verifiedAtUtc)}</p>
      <p className="rest-note">Verifier: {record.verifier}. This is a fixed demo label; there are no accounts.</p>
      <ul className="rest-summary" aria-label="Summary of this review" data-summary="true">
        {summaryLines(record.summary).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {despite.length > 0 && (
        <ul className="rest-despite" aria-label="Fields accepted although a check failed">
          {despite.map((field) => (
            <li key={field.name} className="field-flag" data-accepted-despite="true">
              <span aria-hidden="true">⚠</span> <span>{field.label}: {ACCEPTED_DESPITE_TEXT}</span>
              {field.failedChecks.map((message) => (
                <span key={message} className="field-check">
                  {message}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="button button-strong" data-download="true" onClick={onDownload}>
        Download JSON
      </button>
      <p className="rest-note">The record and its edit history are kept only in this browser.</p>
    </div>
  );
}

/** The inbox's received time followed by " (demo clock)". The sample data has no zone, so it is not called UTC. */
export const receivedLine = (receivedAt: string): string => `${formatReceived(receivedAt)} (demo clock)`;

export interface SummaryBarProps {
  faxId: string;
  /** The inbox entry's receivedAt. Omitted: no received time is shown. */
  receivedAt?: string;
  /** The urgency now shown: the reviewer's value, else the page value; null when empty. Undefined: reader has no answer. */
  urgency?: string | null | undefined;
  /** Counts from summarise() (see record.ts). Omitted when the reader has no answer. */
  counts?: Pick<Summary, 'flagged' | 'reviewed' | 'edited'> | undefined;
  status: string;
  /** Verified: the bar shows the status only. No reason, note or Verify button. */
  verified: boolean;
  enabled: boolean;
  reason: string;
  onVerify: () => void;
  barRef?: Ref<HTMLDivElement>;
}

/**
 * The slim summary bar: fax id, review status, the short reason and the one Verify record
 * button. FaxView puts it LAST in the DOM and CSS shows it first (flex order), so the tab
 * order is: fields, then Verify.
 */
export function SummaryBar({ faxId, receivedAt, urgency, counts, status, verified, enabled, reason, onVerify, barRef }: SummaryBarProps) {
  return (
    <div className="summary-bar" role="region" aria-label="Review summary" ref={barRef}>
      <div className="summary-row">
        <span className="summary-id">Fax {faxId}</span>
        {receivedAt !== undefined && (
          <span className="summary-meta" data-summary-received="true">
            Received{' '}
            <time className="summary-value" dateTime={receivedAt}>
              {receivedLine(receivedAt)}
            </time>
          </span>
        )}
        {urgency !== undefined && (
          <span className="summary-meta" data-summary-urgency="true">
            Urgency: <span className="summary-value">{urgency ?? NOT_READ_TEXT}</span>
          </span>
        )}
        <span className="review-status">
          <span aria-hidden="true">○</span> {status}
        </span>
        {counts && (
          <span className="summary-counts" data-summary-counts="true">
            <span className={counts.flagged > 0 ? 'summary-count count-flag' : 'summary-count'} data-count="flagged">
              {counts.flagged > 0 && <span aria-hidden="true">⚑ </span>}
              {counts.flagged} flagged
            </span>
            <span className="summary-count" data-count="reviewed">
              {counts.reviewed} reviewed
            </span>
            <span className="summary-count" data-count="edited">
              {counts.edited} edited
            </span>
          </span>
        )}
      </div>
      {!verified && (
        <div className="summary-verify">
          <p id="verify-reason" className="verify-reason" aria-live="polite">
            {reason}
          </p>
          <button
            type="button"
            className="button button-primary"
            data-verify="true"
            aria-disabled={!enabled}
            aria-describedby="verify-reason verify-note"
            onClick={() => {
              if (enabled) onVerify();
            }}
          >
            Verify record
          </button>
        </div>
      )}
      {!verified && (
        <p id="verify-note" className="verify-note">
          {VERIFY_NOTE}
        </p>
      )}
    </div>
  );
}
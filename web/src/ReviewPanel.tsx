import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import type { Field, FieldName } from '../../src/extract/schema.js';
import { FIELD_LABELS, NOT_FOUND_TEXT } from './field-labels';
import {
  canVerify,
  fieldReview,
  isOriginallyFlagged,
  sortForReview,
  verifyReason,
  type ReviewState,
} from './review-state';

export const NOT_READ_TEXT = 'Not read';

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
  onSave,
  onCancel,
}: {
  field: Field;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(field.value ?? '');
  useEffect(() => {
    input.current?.focus();
  }, []);
  const canSave = text.trim() !== '';

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
      <label htmlFor={inputId}>{FIELD_LABELS[field.name]}</label>
      <input
        id={inputId}
        ref={input}
        type="text"
        value={text}
        autoComplete="off"
        onChange={(event) => setText(event.target.value)}
      />
      <div className="edit-buttons">
        <button type="submit" className="button" disabled={!canSave}>
          Save
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {!canSave && <p className="edit-hint">Type a value to save it. To keep the field empty, use Accept.</p>}
    </form>
  );
}

interface FieldRowProps {
  field: Field;
  state: ReviewState;
  selected: boolean;
  editing: boolean;
  onSelect: () => void;
  onAccept: () => void;
  onEditOpen: () => void;
  onSave: (text: string) => void;
  onCancel: () => void;
}

function FieldRow({ field, state, selected, editing, onSelect, onAccept, onEditOpen, onSave, onCancel }: FieldRowProps) {
  const label = FIELD_LABELS[field.name];
  const flagged = isOriginallyFlagged(field);
  const review = fieldReview(state, field.name);
  const edited = review.enteredValue !== null;
  const pending = flagged && !review.reviewed;

  return (
    <li className="field-row">
      <button
        type="button"
        className={selected ? 'field-item field-selected' : 'field-item'}
        aria-pressed={selected}
        data-field={field.name}
        onClick={onSelect}
      >
        <span className="field-name">{label}</span>
        {edited ? (
          <>
            <span className="field-value">{review.enteredValue}</span>
            <span className="field-note">Entered by the reviewer</span>
            <span className="field-note">Read from the page: {field.value ?? NOT_READ_TEXT}</span>
            <span className="field-note">The highlight shows where the page value was read.</span>
          </>
        ) : (
          <>
            <span className={field.value === null ? 'field-value field-empty' : 'field-value'}>
              {field.value ?? NOT_FOUND_TEXT}
            </span>
            {review.accepted && (
              <span className="field-note">
                {field.value === null
                  ? 'Accepted as empty: the reviewer confirmed it is not on the page.'
                  : 'Accepted by the reviewer'}
              </span>
            )}
          </>
        )}
        {field.value === null ? (
          !edited && <span className="confidence">{NOT_READ_TEXT}</span>
        ) : (
          <ConfidenceBar confidence={field.confidence} />
        )}
        {field.flags.map((message) =>
          pending ? (
            <span key={message} className="field-flag">
              <span aria-hidden="true">⚑</span> <span>{message}</span>
            </span>
          ) : (
            <span key={message} className="field-history">
              <span aria-hidden="true">✓</span> <span>Was flagged: {message}</span>
            </span>
          ),
        )}
      </button>
      {flagged && (
        <div className="field-actions">
          {pending && (
            <button type="button" className="button" data-accept={field.name} onClick={onAccept}>
              Accept<span className="sr-only"> {label}</span>
            </button>
          )}
          <button
            type="button"
            className="button"
            data-edit={field.name}
            aria-expanded={editing}
            onClick={onEditOpen}
          >
            Edit<span className="sr-only"> {label}</span>
          </button>
        </div>
      )}
      {editing && <EditForm field={field} onSave={onSave} onCancel={onCancel} />}
    </li>
  );
}

export interface ReviewPanelProps {
  /** The reader's fields exactly as read, in schema order. */
  fields: readonly Field[];
  state: ReviewState;
  selected: FieldName | null;
  editing: FieldName | null;
  panelRef: Ref<HTMLDivElement>;
  onSelect: (name: FieldName) => void;
  onAccept: (field: Field) => void;
  onEditOpen: (name: FieldName) => void;
  onSave: (field: Field, text: string) => void;
  onCancel: (name: FieldName) => void;
  onVerify: () => void;
}

/** The review panel: sorted fields with their actions, then the Verify record action. */
export function ReviewPanel(props: ReviewPanelProps) {
  const { fields, state } = props;
  const sorted = sortForReview(fields);
  const enabled = canVerify(fields, state);
  return (
    <div ref={props.panelRef} className="review-panel">
      <ul className="field-list" aria-label="Fields read from this fax, flagged fields first">
        {sorted.map((field) => (
          <FieldRow
            key={field.name}
            field={field}
            state={state}
            selected={props.selected === field.name}
            editing={props.editing === field.name}
            onSelect={() => props.onSelect(field.name)}
            onAccept={() => props.onAccept(field)}
            onEditOpen={() => props.onEditOpen(field.name)}
            onSave={(text) => props.onSave(field, text)}
            onCancel={() => props.onCancel(field.name)}
          />
        ))}
      </ul>
      <VerifyBar enabled={enabled} reason={verifyReason(fields, state)} onVerify={props.onVerify} />
    </div>
  );
}

export function VerifyBar({ enabled, reason, onVerify }: { enabled: boolean; reason: string; onVerify: () => void }) {
  return (
    <div className="verify">
      <button
        type="button"
        className="button button-primary"
        data-verify="true"
        aria-disabled={!enabled}
        aria-describedby="verify-reason"
        onClick={() => {
          if (enabled) onVerify();
        }}
      >
        Verify record
      </button>
      <p id="verify-reason" className="verify-reason" aria-live="polite">
        {reason}
      </p>
    </div>
  );
}
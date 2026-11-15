import { useEffect, useRef, useState } from 'react';
import type { Field, FieldName } from '../../src/extract/schema.js';
import type { SampleFax } from '../../src/samples/schema.js';
import { cropBox, viewBoxAttr, viewerBox } from './crop';
import type { InboxItem } from './data';
import { editFlag } from './edit-check';
import type { OpenedBy } from './input-modality';
import { FIELD_LABELS, NOT_FOUND_TEXT } from './field-labels';
import { READER_LABEL, type ReaderName } from './flags';
import { ghostRects } from './ghost';
import { ReviewPanel, VerifyBar } from './ReviewPanel';
import type { VerifiedRecord } from './record';
import {
  LAID_TO_REST,
  NO_ANSWER_VERIFY_REASON,
  fieldReview,
  reviewStatus,
  sortForReview,
  unreviewedFlagged,
  type ReviewEvent,
  type ReviewState,
} from './review-state';

interface FaxViewProps {
  item: InboxItem;
  fax: SampleFax;
  reader: ReaderName;
  /** How the fax was opened. The heading shows a focus ring only after keyboard use. */
  openedBy: OpenedBy;
  /** "Today" for date checks (YYYY-MM-DD), from the sample index. Not the browser clock. */
  referenceDate: string;
  /** This reader's review state for this fax. */
  review: ReviewState;
  onReaderChange: (reader: ReaderName) => void;
  onReview: (event: ReviewEvent) => void;
  /** Called when "Verify record" is pressed while it is enabled. */
  onVerify: () => void;
  /** The verified record for this fax and reader, or null. */
  verified: VerifiedRecord | null;
  /** Called when "Download JSON" is pressed. */
  onDownload: () => void;
  /** Clock for review timestamps. Tests pass a fixed one. */
  now: () => Date;
  onBack: () => void;
}

const READER_CHOICES: { name: ReaderName; label: string }[] = [
  { name: 'model', label: 'Model answers' },
  { name: 'rules', label: 'Rules reader' },
];

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function usePrefersReducedMotion(): boolean {
  const query = () => (typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION) : null);
  const [reduced, setReduced] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const list = query();
    if (!list) return;
    const update = () => setReduced(list.matches);
    update();
    list.addEventListener?.('change', update);
    return () => list.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

interface Selection {
  name: FieldName;
  /** Counts selections, so choosing a field again pulses its ghost again. */
  count: number;
}

type FocusTarget = { kind: 'accept' | 'edit'; field: FieldName } | { kind: 'verify' } | { kind: 'download' };

function selectionLine(fields: readonly Field[], selection: Selection | null, review: ReviewState): string {
  const field = selection ? fields.find((f) => f.name === selection.name) : undefined;
  if (!field) return '';
  const label = FIELD_LABELS[field.name];
  const entered = fieldReview(review, field.name).enteredValue;
  if (entered !== null) {
    const read = field.value === null ? 'nothing was read' : `the page value was ${field.value}`;
    return `Showing source for ${label}: the highlight is where the page value was read (${read}). The value now shown, ${entered}, was entered by the reviewer.`;
  }
  if (field.value === null) {
    return `Showing source for ${label}: ${NOT_FOUND_TEXT.toLowerCase()}, so there is nothing to highlight.`;
  }
  return `Showing source for ${label}: ${field.value}`;
}

/**
 * The fax screen. The image and the source ghosts share one SVG coordinate system
 * (viewBox = the fax size in pixels), so they scale together. Ghost rectangles are
 * drawn straight from OCR word boxes, found by word ID.
 */
export function FaxView({ item, fax, reader, openedBy, referenceDate, review, onReaderChange, onReview, onVerify, verified, onDownload, now, onBack }: FaxViewProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [showFullPage, setShowFullPage] = useState(false);
  const [editing, setEditing] = useState<FieldName | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [pendingFocus, setPendingFocus] = useState<FocusTarget | null>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    if (!pendingFocus) return;
    const root = panel.current ?? document;
    const selector =
      pendingFocus.kind === 'verify'
        ? '[data-verify]'
        : pendingFocus.kind === 'download'
          ? '[data-download]'
          : pendingFocus.kind === 'accept'
          ? `[data-accept="${pendingFocus.field}"]`
          : `[data-edit="${pendingFocus.field}"]`;
    root.querySelector<HTMLElement>(selector)?.focus();
    setPendingFocus(null);
  }, [pendingFocus]);

  const result = fax.readers[reader];
  const fields = result.status === 'ok' ? result.fields : [];
  const status = verified
    ? LAID_TO_REST
    : result.status === 'ok'
      ? reviewStatus(fields, review, referenceDate)
      : 'Not yet reviewed';
  const imageName = `Faxed referral form, fax ${item.entry.id}, with source highlights`;

  function ghostClass(selected: boolean): string {
    if (!selected) return 'ghost';
    return reducedMotion ? 'ghost ghost-selected ghost-static' : 'ghost ghost-selected ghost-pulse';
  }

  // Choosing a field again pulses its ghost again; acting on the selected field does not.
  const select = (name: FieldName) => setSelection((cur) => ({ name, count: (cur?.count ?? 0) + 1 }));
  const keepSelected = (name: FieldName) =>
    setSelection((cur) => (cur?.name === name ? cur : { name, count: (cur?.count ?? 0) + 1 }));

  function accept(field: Field) {
    keepSelected(field.name);
    setEditing(null);
    onReview({ type: 'accept', field: field.name, originalValue: field.value, at: now().toISOString() });
    setAnnouncement(`${FIELD_LABELS[field.name]} accepted.`);
    // Next unreviewed flagged field after this one in the order shown, else Verify record.
    const order = sortForReview(fields);
    const waiting = new Set(unreviewedFlagged(fields, review, referenceDate).map((f) => f.name));
    waiting.delete(field.name);
    const at = order.findIndex((f) => f.name === field.name);
    const next = [...order.slice(at + 1), ...order.slice(0, at)].find((f) => waiting.has(f.name));
    setPendingFocus(next ? { kind: 'accept', field: next.name } : { kind: 'verify' });
  }

  function save(field: Field, text: string) {
    keepSelected(field.name);
    setEditing(null);
    onReview({
      type: 'edit',
      field: field.name,
      originalValue: field.value,
      newValue: text,
      at: now().toISOString(),
    });
    const problem = editFlag(field.name, text, referenceDate);
    setAnnouncement(
      `${FIELD_LABELS[field.name]} saved. The value you entered is shown.${problem ? ` ${problem}` : ''}`,
    );
    setPendingFocus({ kind: 'edit', field: field.name });
  }

  function verify() {
    setEditing(null);
    onVerify();
    setAnnouncement('Record laid to rest. It is now read-only. Download JSON is available.');
    setPendingFocus({ kind: 'download' });
  }

  function cancel(name: FieldName) {
    setEditing(null);
    onReview({ type: 'cancel' });
    setPendingFocus({ kind: 'edit', field: name });
  }

  function changeReader(next: ReaderName) {
    setEditing(null);
    onReaderChange(next);
  }

  // The selected field is drawn last so it sits on top of the others.
  const ordered = [...fields.filter((f) => f.name !== selection?.name), ...fields.filter((f) => f.name === selection?.name)];

  // Cropped to the text by default. Only the viewBox changes, so the image and the
  // highlights keep one coordinate system. A highlight outside the crop shows the full page.
  const crop = cropBox(fax.ocr.words, fax);
  const selectedField = fields.find((f) => f.name === selection?.name);
  const box = viewerBox(crop, fax, ghostRects(selectedField, fax.ocr.words), showFullPage);

  return (
    <section aria-labelledby="fax-title" className="fax-view">
      <button type="button" className="button back-button" onClick={onBack}>
        Back to inbox
      </button>
      <div className="fax-title-row">
        <h2
          id="fax-title"
          className="fax-heading"
          data-opened-by={openedBy}
          tabIndex={-1}
          ref={heading}
        >
          Fax {item.entry.id}
        </h2>
        <span className="review-status">
          <span aria-hidden="true">○</span> {status}
        </span>
      </div>
      <p className="reader-name">{READER_LABEL[reader]}</p>
      <div role="group" aria-label="Which reader to show" className="reader-toggle">
        {READER_CHOICES.map((choice) => (
          <button
            key={choice.name}
            type="button"
            className="button toggle-button"
            aria-pressed={reader === choice.name}
            onClick={() => changeReader(choice.name)}
          >
            {choice.label}
          </button>
        ))}
      </div>

      <div className="viewer">
        <div className="viewer-image">
          <button type="button" className="button page-toggle" onClick={() => setShowFullPage((v) => !v)}>
            {showFullPage ? 'Show cropped view' : 'Show full page'}
          </button>
          <svg
            className="fax-image"
            viewBox={viewBoxAttr(box)}
            preserveAspectRatio="xMidYMid meet"
            style={{ aspectRatio: `${box.width} / ${box.height}` }}
            role="img"
            aria-label={imageName}
          >
            <image href={item.imageUrl} x={0} y={0} width={fax.width} height={fax.height} />
            {ordered.map((field) => {
              const selected = selection?.name === field.name;
              const rects = ghostRects(field, fax.ocr.words);
              if (rects.length === 0) return null;
              return (
                <g
                  key={selected ? `${field.name}-${selection?.count}` : field.name}
                  className={ghostClass(selected)}
                  data-field={field.name}
                  data-selected={selected}
                >
                  {rects.map((rect) => (
                    <rect
                      key={rect.id}
                      data-word-id={rect.id}
                      x={rect.x}
                      y={rect.y}
                      width={rect.width}
                      height={rect.height}
                    />
                  ))}
                </g>
              );
            })}
          </svg>
          <p role="status" className="selection-line">
            {selectionLine(fields, selection, review)}
          </p>
        </div>

        <div className="viewer-side">
          {result.status === 'ok' ? (
            <ReviewPanel
              fields={result.fields}
              state={review}
              referenceDate={referenceDate}
              selected={selection?.name ?? null}
              editing={editing}
              panelRef={panel}
              onSelect={select}
              onAccept={accept}
              onEditOpen={(name) => {
                keepSelected(name);
                setEditing(name);
              }}
              onSave={save}
              onCancel={cancel}
              onVerify={verify}
              verified={verified}
              onDownload={onDownload}
            />
          ) : (
            <>
              <div className="problem-box no-answer">
                <p>
                  <span aria-hidden="true">–</span> {result.message}
                </p>
                {reader === 'model' && (
                  <button type="button" className="button" onClick={() => changeReader('rules')}>
                    Show the rules reader
                  </button>
                )}
              </div>
              <VerifyBar enabled={false} reason={NO_ANSWER_VERIFY_REASON} onVerify={onVerify} />
            </>
          )}
          <p className="sr-only" aria-live="polite">
            {announcement}
          </p>
        </div>
      </div>
    </section>
  );
}
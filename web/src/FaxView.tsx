import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Field, FieldName } from '../../src/extract/schema.js';
import type { SampleFax } from '../../src/samples/schema.js';
import { cropBox, viewBoxAttr, viewerBox } from './crop';
import type { InboxItem } from './data';
import { editFlag } from './edit-check';
import type { OpenedBy } from './input-modality';
import { FIELD_LABELS, NOT_FOUND_TEXT } from './field-labels';
import { READER_LABEL, type ReaderName } from './flags';
import { ghostRects } from './ghost';
import { faxScreenArea, isWideLayout, scrollGhostIntoView } from './ghost-scroll';
import { NO_CHANGE_TEXT, ReviewPanel, SummaryBar } from './ReviewPanel';
import { SourceStringOverlay } from './SourceStringOverlay';
import { liveSummary, type VerifiedRecord } from './record';
import {
  LAID_TO_REST,
  NO_ANSWER_VERIFY_REASON,
  canVerify,
  fieldReview,
  isOriginallyFlagged,
  isUnchangedEdit,
  reviewStatus,
  sortForReview,
  unreviewedFlagged,
  validatorFailures,
  verifyReason,
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

/** The one visible caption for the highlight. */
export const HIGHLIGHT_CAPTION = 'The highlight shows where the page value was read.';

/** What every sample fax is. The window's title bar reads "<id> — referral". */
export const WINDOW_TITLE_KIND = 'referral';
/** Once the record is verified the title bar reads "<id> — laid to rest" (the status line says "Laid to rest"). */
export const WINDOW_TITLE_KIND_VERIFIED = LAID_TO_REST.toLowerCase();

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

type FocusTarget = { kind: 'accept' | 'edit'; field: FieldName } | { kind: 'verify' } | { kind: 'laid-to-rest' };

function selectionLine(fields: readonly Field[], selection: Selection | null, review: ReviewState): string {
  const field = selection ? fields.find((f) => f.name === selection.name) : undefined;
  if (!field) return '';
  const label = FIELD_LABELS[field.name];
  const entered = fieldReview(review, field.name).enteredValue;
  if (entered !== null) {
    const read = field.value === null ? 'nothing was read' : `the page value was ${field.value}`;
    return `Showing source for ${label}: ${read}. The value now shown, ${entered}, was entered by you.`;
  }
  if (field.value === null) {
    return `Showing source for ${label}: ${NOT_FOUND_TEXT.toLowerCase()}, so there is nothing to highlight.`;
  }
  return `Showing source for ${label}: ${field.value}`;
}

/** The urgency now shown for the chosen reader: the reviewer's value, else the page value; null when empty. */
function shownUrgency(fields: readonly Field[], review: ReviewState): string | null {
  const entered = fieldReview(review, 'urgency').enteredValue;
  if (entered !== null) return entered.trim() === '' ? null : entered;
  const page = fields.find((f) => f.name === 'urgency')?.value ?? null;
  return page === null || page.trim() === '' ? null : page;
}

/**
 * The fax screen. The image and the source ghosts share one SVG coordinate system
 * (viewBox = the fax size in pixels), so they scale together. Ghost rectangles are
 * drawn straight from OCR word boxes, found by word ID.
 */
export function FaxView({ item, fax, reader, openedBy, referenceDate, review, onReaderChange, onReview, onVerify, verified, onDownload, now, onBack }: FaxViewProps) {
  const captionId = useId();
  const glowId = `ghost-glow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const heading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const faxSvg = useRef<SVGSVGElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [showFullPage, setShowFullPage] = useState(false);
  const [editing, setEditing] = useState<FieldName | null>(null);
  const [announcement, setAnnouncement] = useState('');
  // The field whose last Save changed nothing. Cleared by the next action on it.
  const [noChange, setNoChange] = useState<FieldName | null>(null);
  const [pendingFocus, setPendingFocus] = useState<FocusTarget | null>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  // The sticky field list sits just below the bar. The bar can wrap, so its real height is
  // handed to the stylesheet as --summary-bar-h (the CSS has a fallback for first paint).
  useLayoutEffect(() => {
    const barEl = bar.current;
    const rootEl = root.current;
    if (!barEl || !rootEl) return;
    const apply = () => rootEl.style.setProperty('--summary-bar-h', `${barEl.offsetHeight}px`);
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(barEl);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pendingFocus) return;
    const scope = pendingFocus.kind === 'verify' ? bar.current : panel.current;
    const selector =
      pendingFocus.kind === 'verify'
        ? '[data-verify]'
        : pendingFocus.kind === 'laid-to-rest'
          ? '.laid-to-rest .rest-title'
          : pendingFocus.kind === 'accept'
          ? `[data-accept="${pendingFocus.field}"]`
          : `[data-edit="${pendingFocus.field}"]`;
    (scope ?? document).querySelector<HTMLElement>(selector)?.focus();
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

  // Words cited by a field the reader flagged are drawn in the flag colour with a dashed outline. This is the
  // same rule as the "Needs your eyes" section (isOriginallyFlagged), so a card keeps its look once reviewed.
  function ghostClass(selected: boolean, flagged: boolean): string {
    const base = flagged ? 'ghost ghost-flag' : 'ghost';
    if (!selected) return base;
    return reducedMotion ? `${base} ghost-selected ghost-static` : `${base} ghost-selected ghost-pulse`;
  }

  // Choosing a field again pulses its ghost again; acting on the selected field does not.
  const select = (name: FieldName) => setSelection((cur) => ({ name, count: (cur?.count ?? 0) + 1 }));
  const keepSelected = (name: FieldName) =>
    setSelection((cur) => (cur?.name === name ? cur : { name, count: (cur?.count ?? 0) + 1 }));

  function accept(field: Field) {
    keepSelected(field.name);
    setEditing(null);
    setNoChange(null);
    const failedChecks = validatorFailures(field, review, referenceDate);
    onReview({ type: 'accept', field: field.name, originalValue: field.value, failedChecks, at: now().toISOString() });
    setAnnouncement(
      failedChecks.length > 0
        ? `${FIELD_LABELS[field.name]} accepted although the check failed.`
        : `${FIELD_LABELS[field.name]} accepted.`,
    );
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
    const event: ReviewEvent = {
      type: 'edit',
      field: field.name,
      originalValue: field.value,
      newValue: text,
      at: now().toISOString(),
    };
    if (isUnchangedEdit(review, event)) {
      setNoChange(field.name);
      setAnnouncement(`${FIELD_LABELS[field.name]}: ${NO_CHANGE_TEXT.toLowerCase()}.`);
      setPendingFocus({ kind: 'edit', field: field.name });
      return;
    }
    setNoChange(null);
    onReview(event);
    const problem = editFlag(field.name, text, referenceDate);
    setAnnouncement(
      `${FIELD_LABELS[field.name]} saved. The value you entered is shown.${problem ? ` ${problem}` : ''}`,
    );
    setPendingFocus({ kind: 'edit', field: field.name });
  }

  function verify() {
    setEditing(null);
    setNoChange(null);
    onVerify();
    // The announcement goes through the live region; focus moves to the Laid to rest heading (Verify record is
    // gone), and the next Tab stop after it is Download JSON.
    setAnnouncement('Record laid to rest. It is now read-only. Download JSON is available.');
    setPendingFocus({ kind: 'laid-to-rest' });
  }

  function cancel(name: FieldName) {
    setEditing(null);
    setNoChange(null);
    onReview({ type: 'cancel' });
    setPendingFocus({ kind: 'edit', field: name });
  }

  function changeReader(next: ReaderName) {
    setEditing(null);
    setNoChange(null);
    onReaderChange(next);
  }

  // The selected field is drawn last so it sits on top of the others.
  const ordered = [...fields.filter((f) => f.name !== selection?.name), ...fields.filter((f) => f.name === selection?.name)];

  // Cropped to the text by default. Only the viewBox changes, so the image and the
  // highlights keep one coordinate system. A highlight outside the crop shows the full page.
  const crop = cropBox(fax.ocr.words, fax);
  const selectedField = fields.find((f) => f.name === selection?.name);
  const box = viewerBox(crop, fax, ghostRects(selectedField, fax.ocr.words), showFullPage);

  // R6.1: a new selection brings the field's first cited ghost into view when it is not fully visible
  // (ghost-scroll.ts), on the wide layout only; on the stacked layout the page does not move (S1b). It follows the
  // same rule as the pulse: choosing a field scrolls, acting on the selected field does not, because keepSelected
  // keeps the same selection object.
  useEffect(() => {
    if (!selection || !isWideLayout()) return;
    const first = ghostRects(selectedField, fax.ocr.words)[0];
    if (!first) return;
    const group = faxSvg.current?.querySelector(`.ghost[data-field="${selection.name}"]`);
    const target = Array.from(group?.querySelectorAll('rect') ?? []).find((rect) => rect.getAttribute('data-word-id') === first.id);
    scrollGhostIntoView(target, faxScreenArea(bar.current), reducedMotion);
  }, [selection]);

  return (
    // data-state: the stylesheet fades the coral emphasis into the quiet state when it becomes "laid-to-rest".
    <section aria-labelledby="fax-title" className="fax-view" data-state={verified ? 'laid-to-rest' : undefined} ref={root}>
      {/* Close window does what Back to inbox does, nothing else. It comes first in the DOM, before Back to
          inbox, so every other control keeps its place in the tab order: from the heading, Tab still goes to
          the reader toggle and Shift+Tab to Back to inbox, and the summary bar stays last so that Verify
          follows the fields. CSS puts both buttons at the right end of the title bar, Back to inbox then
          Close window, as in docs/design/amber-review.png. */}
      {/* The glyphs ("x" here, "<" on Back to inbox) are drawn by CSS in the pixel font, so the title bar
          adds no SVG: the fax image stays the first SVG on the screen. */}
      <button type="button" className="window-button window-close" aria-label="Close window" onClick={onBack}>
        <span className="window-button-face" aria-hidden="true" />
        <span className="sr-only">Close window</span>
      </button>

      {/* The window (R4a). Its title bar is the first line of this header: the title, with Back to inbox
          placed by CSS at the right end next to Close window. The second line holds the reader line and the
          toggle, directly under the title bar, at the top of the summary panel. */}
      <div className="fax-header">
        <button type="button" className="window-button back-button" aria-label="Back to inbox" onClick={onBack}>
          <span className="window-button-face" aria-hidden="true" />
          {/* The words stay in the button: they show if the stylesheet fails to load. */}
          <span className="sr-only">Back to inbox</span>
        </button>
        <div className="fax-title-row">
          {/* The heading still reads "Fax <id>" to screen readers; on screen the title reads "<id> — referral". */}
          <h2
            id="fax-title"
            className="fax-heading"
            data-opened-by={openedBy}
            tabIndex={-1}
            ref={heading}
          >
            {/* The space stays outside the hidden word, so the name is "Fax <id>" and nothing is drawn before the id. */}
            <span className="sr-only">Fax</span> {item.entry.id}
          </h2>
          <span className="fax-title-kind" aria-hidden="true">
            — {verified ? WINDOW_TITLE_KIND_VERIFIED : WINDOW_TITLE_KIND}
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
      </div>

      <div className="viewer">
        <div className="viewer-image">
          <button type="button" className="button page-toggle" onClick={() => setShowFullPage((v) => !v)}>
            {showFullPage ? 'Show cropped view' : 'Show full page'}
          </button>
          <div className="fax-stage">
          <div className="fax-sheet" ref={sheet}>
          <svg
            ref={faxSvg}
            className="fax-image"
            viewBox={viewBoxAttr(box)}
            preserveAspectRatio="xMidYMid meet"
            style={{ aspectRatio: `${box.width} / ${box.height}` }}
            role="img"
            aria-label={imageName}
            aria-describedby={captionId}
          >
            <defs>
              {/* One soft glow in the ghost colour, used only by the selected ghost. It paints outside the
                  rects and changes no geometry. The region covers the whole page so it is never clipped. */}
              <filter id={glowId} filterUnits="userSpaceOnUse" x={0} y={0} width={fax.width} height={fax.height}>
                <feDropShadow className="ghost-glow-flood" dx={0} dy={0} stdDeviation={5} />
              </filter>
            </defs>
            <image href={item.imageUrl} x={0} y={0} width={fax.width} height={fax.height} />
            {ordered.map((field) => {
              const selected = selection?.name === field.name;
              const rects = ghostRects(field, fax.ocr.words);
              if (rects.length === 0) return null;
              return (
                <g
                  key={selected ? `${field.name}-${selection?.count}` : field.name}
                  className={ghostClass(selected, isOriginallyFlagged(field))}
                  data-field={field.name}
                  data-selected={selected}
                  filter={selected ? `url(#${glowId})` : undefined}
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
          </div>
          </div>
          <p id={captionId} className="viewer-caption">{HIGHLIGHT_CAPTION}</p>
          <p role="status" className="selection-line">
            {selectionLine(fields, selection, review)}
          </p>
          {/* Decoration only (aria-hidden, fixed, no pointer events). Placed here so the DOM order of the fax, the field column and the summary bar is unchanged. */}
          <SourceStringOverlay
            field={selectedField?.name ?? null}
            selectionKey={`${selection?.name ?? ''}-${selection?.count ?? 0}`}
            flagged={selectedField ? isOriginallyFlagged(selectedField) : false}
            word={ghostRects(selectedField, fax.ocr.words)[0] ?? null}
            viewBox={box}
            reducedMotion={reducedMotion}
            svgRef={faxSvg}
            sheetRef={sheet}
            barRef={bar}
            panelRef={panel}
          />
        </div>

        <div className="viewer-side">
          {result.status === 'ok' ? (
            <ReviewPanel
              fields={result.fields}
              state={review}
              referenceDate={referenceDate}
              selected={selection?.name ?? null}
              editing={editing}
              noChange={noChange}
              panelRef={panel}
              onSelect={select}
              onAccept={accept}
              onEditOpen={(name) => {
                keepSelected(name);
                setNoChange(null);
                setEditing(name);
              }}
              onSave={save}
              onCancel={cancel}
              verified={verified}
              onDownload={onDownload}
            />
          ) : (
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
          )}
          <p className="sr-only" aria-live="polite">
            {announcement}
          </p>
        </div>
      </div>

      {/* Last in the DOM so Verify follows the fields in tab order; CSS (flex order) shows it first. */}
      <SummaryBar
        faxId={item.entry.id}
        receivedAt={item.entry.receivedAt}
        urgency={result.status === 'ok' ? shownUrgency(fields, review) : undefined}
        counts={result.status === 'ok' ? liveSummary(fields, review) : undefined}
        status={status}
        verified={verified !== null}
        enabled={result.status === 'ok' && canVerify(fields, review, referenceDate)}
        reason={result.status === 'ok' ? verifyReason(fields, review, referenceDate) : NO_ANSWER_VERIFY_REASON}
        onVerify={verify}
        barRef={bar}
      />
    </section>
  );
}
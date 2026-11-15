import { useEffect, useRef } from 'react';
import { cropBox, viewBoxAttr } from './crop';
import type { InboxItem } from './data';
import type { OpenedBy } from './input-modality';
import { formatReceived } from './format';
import { NO_MORE_FAXES_MESSAGE } from './inbox-state';
import { reviewLabel } from './review';
import type { ReviewState } from './review-state';
import { NO_SAVED_ANSWER_LABEL, READER_LABEL, summariseFlags, type ReaderName } from './flags';

function FlagSummaryLine({ item, reader }: { item: InboxItem; reader: ReaderName }) {
  if (!item.fax.ok) return null;
  const summary = summariseFlags(item.fax.value.readers[reader]);
  if (summary.status === 'no-saved-answer') {
    return (
      <span className="flag-line flag-none">
        <span aria-hidden="true">–</span> {NO_SAVED_ANSWER_LABEL}
      </span>
    );
  }
  if (summary.count === 0) {
    return (
      <span className="flag-line flag-none">
        <span aria-hidden="true">✓</span> No flagged fields
      </span>
    );
  }
  return (
    <span className="flag-line flag-on">
      <span aria-hidden="true">⚑</span> {summary.count} flagged {summary.count === 1 ? 'field' : 'fields'}
    </span>
  );
}

/** The thumbnail shows the same cropped area as the fax screen, by way of the SVG viewBox. */
function Thumbnail({ item }: { item: InboxItem }) {
  const alt = `First page of fax ${item.entry.id}`;
  if (!item.fax.ok) {
    return <img className="thumb" src={item.imageUrl} alt={alt} loading="lazy" />;
  }
  const fax = item.fax.value;
  const crop = cropBox(fax.ocr.words, fax);
  return (
    <svg
      className="thumb"
      viewBox={viewBoxAttr(crop)}
      preserveAspectRatio="xMidYMid meet"
      style={{ aspectRatio: `${crop.width} / ${crop.height}` }}
      role="img"
      aria-label={alt}
    >
      <image href={item.imageUrl} x={0} y={0} width={fax.width} height={fax.height} />
    </svg>
  );
}

function RowText({
  item,
  reader,
  reviews,
}: {
  item: InboxItem;
  reader: ReaderName;
  reviews: Readonly<Record<string, ReviewState>>;
}) {
  return (
    <span className="row-text">
      <span className="row-id">{item.entry.id}</span>
      <span className="row-time">
        Received <time dateTime={item.entry.receivedAt}>{formatReceived(item.entry.receivedAt)}</time>
      </span>
      {item.fax.ok ? (
        <>
          <FlagSummaryLine item={item} reader={reader} />
          <span className="review-status">
            <span aria-hidden="true">○</span> {reviewLabel(item.fax.value, reader, reviews)}
          </span>
        </>
      ) : (
        <span className="flag-line flag-on">
          <span aria-hidden="true">⚠</span> Could not be read. {item.fax.error}
        </span>
      )}
    </span>
  );
}

interface InboxProps {
  /** Only the faxes that have arrived. */
  items: InboxItem[];
  total: number;
  reader: ReaderName;
  reviews: Readonly<Record<string, ReviewState>>;
  /** Fax whose row gets focus when the inbox appears (after coming back from a fax). */
  focusId: string | null;
  arrivedId: string | null;
  onOpen: (id: string, openedBy: OpenedBy) => void;
  onIncoming: () => void;
  onRetry: () => void;
}

export function Inbox({ items, total, reader, reviews, focusId, arrivedId, onOpen, onIncoming, onRetry }: InboxProps) {
  // The last input on a row before its click: Enter or Space, or a pointer press.
  // A click with neither (for example from assistive technology) counts as keyboard.
  const lastInput = useRef<OpenedBy | null>(null);
  const markPointer = () => {
    lastInput.current = 'pointer';
  };
  useEffect(() => {
    if (!focusId) return;
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-fax-id]'));
    rows.find((row) => row.dataset['faxId'] === focusId)?.focus();
    // Runs once, when the inbox first appears.
  }, []);

  const exhausted = items.length >= total;
  const failed = items.filter((item) => !item.fax.ok).length;

  return (
    <section aria-labelledby="inbox-title" className="inbox">
      <h2 id="inbox-title">Inbox</h2>
      <p className="reader-name">{READER_LABEL[reader]}</p>

      {total === 0 && <p role="status">There are no sample faxes.</p>}
      {total > 0 && items.length === 0 && (
        <p role="status">Your inbox is empty. Press “Incoming fax” to receive the next sample.</p>
      )}

      {failed > 0 && (
        <div role="alert" className="problem-box">
          <p>
            <span aria-hidden="true">⚠</span>{' '}
            {failed === 1 ? 'One fax could not be loaded.' : `${failed} faxes could not be loaded.`} The others still
            work.
          </p>
          <button type="button" className="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}

      {items.length > 0 && (
        <ul className="fax-list">
          {items.map((item) => (
            <li key={item.entry.id} className="fax-row">
              {item.fax.ok ? (
                <button
                  type="button"
                  className="row-button"
                  data-fax-id={item.entry.id}
                  onPointerDown={markPointer}
                  onMouseDown={markPointer}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') lastInput.current = 'keyboard';
                  }}
                  onClick={() => {
                    const by = lastInput.current ?? 'keyboard';
                    lastInput.current = null;
                    onOpen(item.entry.id, by);
                  }}
                >
                  <Thumbnail item={item} />
                  <RowText item={item} reader={reader} reviews={reviews} />
                </button>
              ) : (
                <div className="row-button row-failed">
                  <Thumbnail item={item} />
                  <RowText item={item} reader={reader} reviews={reviews} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="incoming">
        <button
          type="button"
          className="button"
          aria-disabled={exhausted}
          aria-describedby="incoming-note"
          onClick={() => {
            if (!exhausted) onIncoming();
          }}
        >
          Incoming fax
        </button>
        <div id="incoming-note" role="status" className="incoming-note">
          {arrivedId && <p>Fax {arrivedId} arrived.</p>}
          {exhausted && <p>{NO_MORE_FAXES_MESSAGE}</p>}
        </div>
      </div>
    </section>
  );
}

import { useEffect, useRef } from 'react';
import { cropBox, viewBoxAttr } from './crop';
import type { InboxItem } from './data';
import { DESKTOP_HINT } from './desktop';
import type { OpenedBy } from './input-modality';
import { formatReceived } from './format';
import { NO_MORE_FAXES_MESSAGE } from './inbox-state';
import { DocFrame, FlagBadge } from './PixelIcons';
import type { VerifiedRecord } from './record';
import type { ReviewState } from './review-state';
import type { ReaderName } from './flags';
import { failedRowStatus, flagsWaiting, rowAccessibleName, statusPill, type StatusPill } from './status-pill';

/** The status line: the icon and the flag part on the first line, the review state under them. */
function StatusPillView({ pill }: { pill: StatusPill }) {
  return (
    <span className={`status-pill pill-${pill.kind}`} data-pill={pill.kind}>
      <span className="pill-line">
        <span className="pill-icon" aria-hidden="true">
          {pill.icon}
        </span>{' '}
        <span className="pill-flags">{pill.flagText}</span>
      </span>
      <span className="pill-review">{pill.reviewText}</span>
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

/**
 * A fax as a desktop icon: the pixel-art page frame around the fax's own thumbnail, with the coral
 * "!" badge while flagged fields wait. The frame and the badge are aria-hidden; the thumbnail keeps
 * its name.
 */
function DocIcon({ item, badge }: { item: InboxItem; badge: boolean }) {
  return (
    <span className="doc-icon">
      <Thumbnail item={item} />
      <DocFrame />
      {badge && <FlagBadge />}
    </span>
  );
}

/** The label ("./fax-0003"), the received time and the status line under an icon. */
function RowText({ item, pill, error }: { item: InboxItem; pill: StatusPill | null; error: string | null }) {
  return (
    <span className="row-text">
      <span className="row-id">
        <span className="row-id-path" aria-hidden="true">
          ./
        </span>
        <span>{item.entry.id}</span>
      </span>
      <span className="row-time">
        Received <time dateTime={item.entry.receivedAt}>{formatReceived(item.entry.receivedAt)}</time>
      </span>
      {pill && <StatusPillView pill={pill} />}
      {error !== null && (
        <span className="flag-line row-error">
          <span aria-hidden="true">⚠</span> Could not be read. {error}
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
  /** Verified records, by fax and reader. These rows read "Laid to rest". */
  verified: Readonly<Record<string, VerifiedRecord>>;
  /** "Today" for date checks, from the sample index. */
  referenceDate: string;
  /** Fax whose row gets focus when the inbox appears (after coming back from a fax). */
  focusId: string | null;
  arrivedId: string | null;
  onOpen: (id: string, openedBy: OpenedBy) => void;
  onIncoming: () => void;
  onRetry: () => void;
}

/**
 * The inbox as a desktop: one icon button per fax in a grid. The reader in use is named in the
 * taskbar (Taskbar.tsx). The "Inbox" heading stays for screen readers and is hidden on screen.
 */
export function Inbox({ items, total, reader, reviews, verified, referenceDate, focusId, arrivedId, onOpen, onIncoming, onRetry }: InboxProps) {
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
      <h2 id="inbox-title" className="sr-only">
        Inbox
      </h2>

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
          {items.map((item) => {
            if (!item.fax.ok) {
              const error = item.fax.error;
              return (
                <li key={item.entry.id} className="fax-row">
                  <div
                    className="row-button row-failed"
                    role="group"
                    aria-label={rowAccessibleName(item.entry.id, item.entry.receivedAt, failedRowStatus(error))}
                  >
                    <DocIcon item={item} badge={false} />
                    <RowText item={item} pill={null} error={error} />
                  </div>
                </li>
              );
            }
            const pill = statusPill(item.fax.value, reader, reviews, referenceDate, verified);
            return (
              <li key={item.entry.id} className="fax-row">
                <button
                  type="button"
                  className="row-button"
                  data-fax-id={item.entry.id}
                  aria-label={rowAccessibleName(item.entry.id, item.entry.receivedAt, pill.sentence)}
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
                  <DocIcon item={item} badge={flagsWaiting(pill)} />
                  <RowText item={item} pill={pill} error={null} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {items.length > 0 && <p className="desktop-hint">{DESKTOP_HINT}</p>}

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

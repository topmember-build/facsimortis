import { useLayoutEffect, useRef } from 'react';
import type { InboxItem } from './data';
import { demoClock, trayStatus } from './desktop';
import { READER_LABEL, type ReaderName } from './flags';
import { InboxGlyph } from './PixelIcons';
import type { VerifiedRecord } from './record';
import type { ReviewState } from './review-state';
import { NO_FLAGS_LABEL } from './status-pill';

interface TaskbarProps {
  /** The faxes in the tray (the ones that have arrived). */
  items: readonly InboxItem[];
  reader: ReaderName;
  reviews: Readonly<Record<string, ReviewState>>;
  verified: Readonly<Record<string, VerifiedRecord>>;
  referenceDate: string;
}

/** Inbox: moves focus to the first fax icon, or to Incoming fax when the tray is empty. */
function focusInbox() {
  const target =
    document.querySelector<HTMLElement>('[data-fax-id]') ?? document.querySelector<HTMLElement>('.incoming button');
  target?.focus();
}

/**
 * The desktop taskbar: an Inbox button, the tray status, the reader in use and the demo clock.
 * Not a live region: "Fax ... arrived." is already announced by the inbox.
 */
export function Taskbar({ items, reader, reviews, verified, referenceDate }: TaskbarProps) {
  const status = trayStatus(items, reader, reviews, referenceDate, verified);
  const clock = demoClock(items);
  const barRef = useRef<HTMLElement>(null);

  // The bar is pinned over the bottom of the window. It wraps on narrow screens, so its real height is
  // handed to the stylesheet as --taskbar-h on <html>: the page keeps that much bottom padding, so
  // nothing ends up behind the bar, and the same scroll padding, so a control that takes keyboard focus
  // is scrolled clear of it. Removed again when the inbox closes, so the fax screen is unchanged.
  useLayoutEffect(() => {
    const barEl = barRef.current;
    if (!barEl) return;
    const rootEl = document.documentElement;
    const apply = () => rootEl.style.setProperty('--taskbar-h', `${barEl.offsetHeight}px`);
    apply();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
    observer?.observe(barEl);
    return () => {
      observer?.disconnect();
      rootEl.style.removeProperty('--taskbar-h');
    };
  }, []);

  return (
    <footer className="taskbar" ref={barRef}>
      <div className="taskbar-buttons">
        <button type="button" className="taskbar-button" aria-label="Inbox" onClick={focusInbox}>
          <InboxGlyph />
        </button>
      </div>
      <p className="taskbar-status">
        {status.tray}
        {status.flagged.map((part) => (
          <span key={part.text}>
            {' · '}
            <span className={part.waiting ? 'taskbar-flag' : undefined}>{part.text}</span>
          </span>
        ))}
        {status.noFlags && ` · ${NO_FLAGS_LABEL}`}
      </p>
      <p className="taskbar-reader">{READER_LABEL[reader]}</p>
      {clock && (
        <p className="taskbar-clock">
          <span className="sr-only">{clock.date ? `Demo clock, ${clock.date}, ` : 'Demo clock, '}</span>
          <time dateTime={clock.iso}>{clock.time}</time>
        </p>
      )}
    </footer>
  );
}

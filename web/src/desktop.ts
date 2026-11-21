import type { InboxItem } from './data';
import type { ReaderName } from './flags';
import { formatReceived } from './format';
import type { VerifiedRecord } from './record';
import type { ReviewState } from './review-state';
import { flagsWaiting, statusPill } from './status-pill';

/** The hint under the desktop icons. */
export const DESKTOP_HINT = 'Open an icon to see a fax.';

export interface TrayFlag {
  /** "2 flagged on fax-0003", or "2 flagged on fax-0003, reviewed" once every flagged field is reviewed. */
  text: string;
  /** Flagged fields still wait for review. Only then is the part drawn in the flag colour. */
  waiting: boolean;
}

export interface TrayStatus {
  /** For example "Now: 3 faxes in the tray". */
  tray: string;
  /** One part per fax with flagged fields. Empty when no fax in the tray has any. */
  flagged: TrayFlag[];
  /**
   * True only when the tray is not empty, every fax in it was read by this reader and none has a
   * flagged field. A fax with no saved answer, or one that could not be loaded, was not read, so the
   * taskbar then makes no claim about flags.
   */
  noFlags: boolean;
}

/**
 * The taskbar status for the faxes in the tray (the ones that have arrived), for the chosen reader.
 * A fax keeps its part after review, with the same count as its status line, so nothing about flags
 * is hidden; only the flag colour goes once nothing waits. Pure.
 */
export function trayStatus(
  items: readonly InboxItem[],
  reader: ReaderName,
  reviews: Readonly<Record<string, ReviewState>>,
  referenceDate: string,
  verified: Readonly<Record<string, VerifiedRecord>>,
): TrayStatus {
  const count = items.length;
  const pills = items.map((item) =>
    item.fax.ok ? { id: item.entry.id, pill: statusPill(item.fax.value, reader, reviews, referenceDate, verified) } : null,
  );
  const flagged = pills.flatMap((read): TrayFlag[] => {
    if (!read || !read.pill.flagged) return [];
    const waiting = flagsWaiting(read.pill);
    return [{ text: `${read.pill.flagged} flagged on ${read.id}${waiting ? '' : ', reviewed'}`, waiting }];
  });
  const allRead = pills.every((read) => read !== null && read.pill.flagged !== null);
  return {
    tray: `Now: ${count} ${count === 1 ? 'fax' : 'faxes'} in the tray`,
    flagged,
    noFlags: count > 0 && allRead && flagged.length === 0,
  };
}

export interface DemoClock {
  /** The received time as written in the sample data (it has no time zone). */
  iso: string;
  /** For example "Oct 1". */
  date: string;
  /** For example "09:14". */
  time: string;
}

/**
 * The taskbar clock. The sample data has no real clock, so this is the demo clock: the time the
 * newest fax in the tray arrived, read as written (never through Date, and never called UTC).
 * null when the tray is empty. Pure.
 */
export function demoClock(items: readonly InboxItem[]): DemoClock | null {
  const times = items.map((item) => item.entry.receivedAt).sort();
  const latest = times[times.length - 1];
  if (latest === undefined) return null;
  const text = formatReceived(latest);
  const split = text.lastIndexOf(', ');
  if (split < 0) return { iso: latest, date: '', time: text };
  return { iso: latest, date: text.slice(0, split), time: text.slice(split + 2) };
}

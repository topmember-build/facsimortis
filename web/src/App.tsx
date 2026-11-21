import { useEffect, useState } from 'react';
import { loadInbox, type InboxItem } from './data';
import { downloadText } from './download';
import { FaxView } from './FaxView';
import { DEFAULT_READER, type ReaderName } from './flags';
import { Inbox } from './Inbox';
import type { OpenedBy } from './input-modality';
import { Taskbar } from './Taskbar';
import { initialVisibleCount, revealNext } from './inbox-state';
import { SAMPLE_DATA_VERSION } from '../../src/samples/schema.js';
import { buildVerifiedRecord, exportFileName, serialiseRecord, type VerifiedRecord } from './record';
import {
  EMPTY_REVIEW,
  actionFromEvent,
  canVerify,
  reviewKey,
  reviewReducer,
  type ReviewAction,
  type ReviewEvent,
  type ReviewState,
} from './review-state';
import {
  NOT_KEPT_NOTE,
  ReviewStorage,
  browserStore,
  hydrate,
  saveEntry,
  type KeyValueStore,
} from './storage';

type Load = { state: 'loading' } | { state: 'ready'; items: InboxItem[]; referenceDate: string } | { state: 'error'; message: string };

interface AppProps {
  /** Clock for review timestamps. Tests pass a fixed one. */
  now?: () => Date;
  /** Called after each Accept or Save is recorded. Used by tests. */
  onReviewAction?: (faxId: string, reader: ReaderName, action: ReviewAction) => void;
  /** Called after a record is verified and saved. */
  onVerify?: (faxId: string, reader: ReaderName) => void;
  /** Where progress is kept. Default: this browser's localStorage. null: nowhere (memory only). */
  storage?: KeyValueStore | null;
  /** Saves a file. Default: a browser download. Tests pass their own. */
  download?: (fileName: string, text: string) => void;
}

export const SYNTHETIC_BANNER_TEXT = 'Synthetic data. Demo only, no real patient information.';

const systemClock = () => new Date();

export function App({ now = systemClock, onReviewAction, onVerify, storage: storageProp, download = downloadText }: AppProps = {}) {
  const [storage] = useState(() => new ReviewStorage(storageProp === undefined ? browserStore() : storageProp));
  const [kept, setKept] = useState(storage.ok);
  const [notices, setNotices] = useState<string[]>([]);
  // Keys of stale saved progress. Removed in an effect, after the note has been rendered.
  const [toDiscard, setToDiscard] = useState<string[]>([]);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // App-level, so the inbox flag counts follow the reader chosen on the fax screen.
  const [reader, setReader] = useState<ReaderName>(DEFAULT_READER);
  // In memory only: a reload starts again.
  const [visible, setVisible] = useState<number | null>(null);
  const [arrivedId, setArrivedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openedBy, setOpenedBy] = useState<OpenedBy>('keyboard');
  const [returnFocusId, setReturnFocusId] = useState<string | null>(null);
  // Review state and verified records per fax and per reader. Saved in this browser's
  // localStorage (see storage.ts) and restored when the sample faxes load.
  const [reviews, setReviews] = useState<Record<string, ReviewState>>({});
  const [verified, setVerified] = useState<Record<string, VerifiedRecord>>({});

  function review(item: InboxItem, referenceDate: string, event: ReviewEvent) {
    if (!item.fax.ok) return;
    const key = reviewKey(item.entry.id, reader);
    const current = reviews[key] ?? EMPTY_REVIEW;
    const next = reviewReducer(current, event);
    if (next === current) return;
    setReviews((all) => ({ ...all, [key]: next }));
    saveEntry(storage, item.fax.value, reader, referenceDate, next, verified[key] ?? null);
    setKept(storage.ok);
    const action = actionFromEvent(event);
    if (action) onReviewAction?.(item.entry.id, reader, action);
  }

  function verifyRecord(item: InboxItem, referenceDate: string) {
    if (!item.fax.ok) return;
    const fax = item.fax.value;
    const key = reviewKey(fax.id, reader);
    const result = fax.readers[reader];
    const state = reviews[key] ?? EMPTY_REVIEW;
    if (verified[key] || result.status !== 'ok' || !canVerify(result.fields, state, referenceDate)) return;
    const record = buildVerifiedRecord({
      fax,
      reader,
      referenceDate,
      sampleDataVersion: SAMPLE_DATA_VERSION,
      state,
      verifiedAtUtc: now().toISOString(),
    });
    if (!record) return;
    setVerified((all) => ({ ...all, [key]: record }));
    saveEntry(storage, fax, reader, referenceDate, state, record);
    setKept(storage.ok);
    onVerify?.(fax.id, reader);
  }

  function downloadRecord(faxId: string) {
    const record = verified[reviewKey(faxId, reader)];
    if (record) download(exportFileName(record), serialiseRecord(record));
  }

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const result = await loadInbox(undefined, controller.signal);
        if (controller.signal.aborted) return;
        if (result.ok) {
          const restored = hydrate(storage, result.value.items, result.value.referenceDate);
          setReviews(restored.reviews);
          setVerified(restored.verified);
          setNotices((current) => [...current, ...restored.notices.filter((note) => !current.includes(note))]);
          setToDiscard(restored.discard);
          setKept(storage.ok);
          setLoad({ state: 'ready', items: result.value.items, referenceDate: result.value.referenceDate });
          setVisible((current) => current ?? initialVisibleCount(result.value.items.length));
        } else {
          setLoad({ state: 'error', message: result.error });
        }
      } catch {
        if (!controller.signal.aborted) {
          setLoad({ state: 'error', message: 'The sample faxes could not be loaded.' });
        }
      }
    })();
    return () => controller.abort();
  }, [attempt, storage]);

  // Runs after the commit that shows the note. If removal fails, the page carries on; the note
  // is already in `notices`, so it is not added again in this session.
  useEffect(() => {
    if (toDiscard.length === 0 || load.state !== 'ready') return;
    storage.discardKeys(toDiscard);
    setToDiscard([]);
  }, [toDiscard, load.state, storage]);

  function retry() {
    setLoad({ state: 'loading' });
    setAttempt((n) => n + 1);
  }

  let screen;
  // The fax screen has a compact header: the wordmark and tagline are hidden by CSS (see .page-header-review).
  // Every other screen is the amber desktop: the wordmark at the bottom right, and on the inbox a taskbar.
  let reviewing = false;
  let taskbar = null;
  if (load.state === 'loading') {
    screen = <p role="status">Loading the sample faxes…</p>;
  } else if (load.state === 'error') {
    screen = (
      <div role="alert" className="problem-box">
        <p>
          <span aria-hidden="true">⚠</span> {load.message} Press “Try again” to load it once more.
        </p>
        <button type="button" className="button" onClick={retry}>
          Try again
        </button>
      </div>
    );
  } else {
    const { items, referenceDate } = load;
    const shown = items.slice(0, Math.min(visible ?? 0, items.length));
    const opened = openId === null ? undefined : shown.find((item) => item.entry.id === openId);
    if (opened && opened.fax.ok) {
      reviewing = true;
      screen = (
        <FaxView
          item={opened}
          fax={opened.fax.value}
          reader={reader}
          openedBy={openedBy}
          referenceDate={referenceDate}
          review={reviews[reviewKey(opened.entry.id, reader)] ?? EMPTY_REVIEW}
          now={now}
          onReview={(event) => review(opened, referenceDate, event)}
          onVerify={() => verifyRecord(opened, referenceDate)}
          verified={verified[reviewKey(opened.entry.id, reader)] ?? null}
          onDownload={() => downloadRecord(opened.entry.id)}
          onReaderChange={setReader}
          onBack={() => {
            setReturnFocusId(opened.entry.id);
            setOpenId(null);
          }}
        />
      );
    } else {
      screen = (
        <Inbox
          items={shown}
          total={items.length}
          reader={reader}
          reviews={reviews}
          verified={verified}
          referenceDate={referenceDate}
          focusId={returnFocusId}
          arrivedId={arrivedId}
          onOpen={(id, by) => {
            setOpenedBy(by);
            setOpenId(id);
          }}
          onIncoming={() => {
            const next = revealNext(shown.length, items.length);
            setVisible(next);
            setArrivedId(items[next - 1]?.entry.id ?? null);
          }}
          onRetry={retry}
        />
      );
      taskbar = (
        <Taskbar items={shown} reader={reader} reviews={reviews} verified={verified} referenceDate={referenceDate} />
      );
    }
  }

  const notes = kept ? notices : [...notices, NOT_KEPT_NOTE];

  return (
    <>
      <div className="synthetic-banner" role="region" aria-label="Synthetic data notice">
        {SYNTHETIC_BANNER_TEXT}
      </div>
      <header className={reviewing ? 'page-header page-header-review' : 'page-header page-header-desktop'}>
        <h1>Facsimortis</h1>
        <p>
          A demo that turns faxed referrals into checked records. It is built on synthetic data only.
        </p>
      </header>
      <main className={reviewing ? 'page-main page-main-wide' : 'page-main page-main-desktop'}>
        {notes.length > 0 && (
          <div className="app-notes" role="status">
            {notes.map((note) => (
              <p key={note}>
                <span aria-hidden="true">⚠</span> {note}
              </p>
            ))}
          </div>
        )}
        {screen}
      </main>
      {taskbar}
    </>
  );
}

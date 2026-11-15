import { useEffect, useState } from 'react';
import { loadInbox, type InboxItem } from './data';
import { FaxView } from './FaxView';
import { DEFAULT_READER, type ReaderName } from './flags';
import { Inbox } from './Inbox';
import { initialVisibleCount, revealNext } from './inbox-state';
import {
  EMPTY_REVIEW,
  actionFromEvent,
  reviewKey,
  reviewReducer,
  type ReviewAction,
  type ReviewEvent,
  type ReviewState,
} from './review-state';

type Load = { state: 'loading' } | { state: 'ready'; items: InboxItem[] } | { state: 'error'; message: string };

interface AppProps {
  /** Clock for review timestamps. Tests pass a fixed one. */
  now?: () => Date;
  /** Called after each Accept or Save is recorded. Used by tests. */
  onReviewAction?: (faxId: string, reader: ReaderName, action: ReviewAction) => void;
  /** Called when Verify record is pressed while enabled. */
  onVerify?: (faxId: string, reader: ReaderName) => void;
}

const systemClock = () => new Date();

export function App({ now = systemClock, onReviewAction, onVerify }: AppProps = {}) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // App-level, so the inbox flag counts follow the reader chosen on the fax screen.
  const [reader, setReader] = useState<ReaderName>(DEFAULT_READER);
  // In memory only: a reload starts again.
  const [visible, setVisible] = useState<number | null>(null);
  const [arrivedId, setArrivedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [returnFocusId, setReturnFocusId] = useState<string | null>(null);
  // Review state per fax and per reader, in memory only. A reload starts again (2.6 saves it).
  const [reviews, setReviews] = useState<Record<string, ReviewState>>({});

  function review(faxId: string, event: ReviewEvent) {
    const key = reviewKey(faxId, reader);
    setReviews((current) => ({ ...current, [key]: reviewReducer(current[key] ?? EMPTY_REVIEW, event) }));
    const action = actionFromEvent(event);
    if (action) onReviewAction?.(faxId, reader, action);
  }

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const result = await loadInbox(undefined, controller.signal);
        if (controller.signal.aborted) return;
        if (result.ok) {
          setLoad({ state: 'ready', items: result.value });
          setVisible((current) => current ?? initialVisibleCount(result.value.length));
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
  }, [attempt]);

  function retry() {
    setLoad({ state: 'loading' });
    setAttempt((n) => n + 1);
  }

  let screen;
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
    const { items } = load;
    const shown = items.slice(0, Math.min(visible ?? 0, items.length));
    const opened = openId === null ? undefined : shown.find((item) => item.entry.id === openId);
    if (opened && opened.fax.ok) {
      screen = (
        <FaxView
          item={opened}
          fax={opened.fax.value}
          reader={reader}
          review={reviews[reviewKey(opened.entry.id, reader)] ?? EMPTY_REVIEW}
          now={now}
          onReview={(event) => review(opened.entry.id, event)}
          // Verify does nothing visible yet. Saving the record and the laid-to-rest state come in 2.6.
          onVerify={() => onVerify?.(opened.entry.id, reader)}
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
          focusId={returnFocusId}
          arrivedId={arrivedId}
          onOpen={setOpenId}
          onIncoming={() => {
            const next = revealNext(shown.length, items.length);
            setVisible(next);
            setArrivedId(items[next - 1]?.entry.id ?? null);
          }}
          onRetry={retry}
        />
      );
    }
  }

  return (
    <>
      <header className="page-header">
        <h1>Facsimortis</h1>
        <p>
          A demo that turns faxed referrals into checked records. It is built on synthetic data only.
        </p>
      </header>
      <main className={openId !== null && load.state === 'ready' ? 'page-main page-main-wide' : 'page-main'}>{screen}</main>
      <section className="synthetic-notice" aria-labelledby="synthetic-notice-title">
        <h2 id="synthetic-notice-title">Synthetic data</h2>
        <p>Every fax, person, provider and number in this demo is made up.</p>
      </section>
    </>
  );
}

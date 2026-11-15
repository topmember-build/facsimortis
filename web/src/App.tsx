import { useEffect, useState } from 'react';
import { loadInbox, type InboxItem } from './data';
import { FaxView } from './FaxView';
import { DEFAULT_READER, type ReaderName } from './flags';
import { Inbox } from './Inbox';
import { initialVisibleCount, revealNext } from './inbox-state';

type Load = { state: 'loading' } | { state: 'ready'; items: InboxItem[] } | { state: 'error'; message: string };

export function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // The reader is app-level state so the reader toggle (2.4) can change it without rework.
  const [reader] = useState<ReaderName>(DEFAULT_READER);
  // In memory only: a reload starts again.
  const [visible, setVisible] = useState<number | null>(null);
  const [arrivedId, setArrivedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [returnFocusId, setReturnFocusId] = useState<string | null>(null);

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
      <main className="page-main">{screen}</main>
      <section className="synthetic-notice" aria-labelledby="synthetic-notice-title">
        <h2 id="synthetic-notice-title">Synthetic data</h2>
        <p>Every fax, person, provider and number in this demo is made up.</p>
      </section>
    </>
  );
}

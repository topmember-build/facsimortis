import { useEffect, useState } from 'react';
// Only pure Zod schema modules may be imported from src/ (enforced by ESLint).
import { SampleIndexSchema } from '../../src/samples/schema.js';

type Load =
  | { state: 'loading' }
  | { state: 'ready'; count: number }
  | { state: 'error' };

const INDEX_URL = `${import.meta.env.BASE_URL}samples/index.json`;

export function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(INDEX_URL, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = SampleIndexSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error('Unexpected sample data.');
        setLoad({ state: 'ready', count: parsed.data.faxes.length });
      } catch {
        if (!controller.signal.aborted) setLoad({ state: 'error' });
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <>
      <header className="page-header">
        <h1>Facsimortis</h1>
        <p>
          A demo that turns faxed referrals into checked records. It is built on synthetic data
          only.
        </p>
      </header>
      <main className="page-main">
        <section aria-label="Sample faxes">
          {load.state === 'loading' && <p role="status">Loading the sample faxes…</p>}
          {load.state === 'error' && (
            <p role="alert" className="problem">
              The sample faxes could not be loaded. Reload the page to try again.
            </p>
          )}
          {load.state === 'ready' && (
            <p role="status">
              {load.count === 0
                ? 'There are no sample faxes yet.'
                : load.count === 1
                  ? '1 sample fax is ready.'
                  : `${load.count} sample faxes are ready.`}
            </p>
          )}
        </section>
      </main>
      <section className="synthetic-notice" aria-labelledby="synthetic-notice-title">
        <h2 id="synthetic-notice-title">Synthetic data</h2>
        <p>Every fax, person, provider and number in this demo is made up.</p>
      </section>
    </>
  );
}
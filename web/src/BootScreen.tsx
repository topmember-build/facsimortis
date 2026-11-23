import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BOOT_AUTO_CONTINUE_MS,
  BOOT_BUTTON_LABEL,
  BOOT_LINES,
  BOOT_PROMPT,
  RECEIVING_DELAY_MS,
  RECEIVING_TEXT,
  continuesBoot,
  holdsBootKey,
} from './boot';

interface BootScreenProps {
  /** The sample data is still loading. If it still is after RECEIVING_DELAY_MS, the screen says "Receiving fax…". */
  loading: boolean;
  /** Leaves the boot screen. Called once: on any key, any click, the button, or after BOOT_AUTO_CONTINUE_MS. */
  onContinue: () => void;
}

/**
 * The boot screen: the wordmark, three handshake lines, the prompt and a real Receive faxes button,
 * which has focus when the screen appears. The lines are all in the page from the start; only CSS
 * staggers them, so under reduced motion they simply show at once. The status line is always in the
 * page (an empty live region), and gets its words only when the data is slow.
 */
export function BootScreen({ loading, onContinue }: BootScreenProps) {
  const button = useRef<HTMLButtonElement>(null);
  const done = useRef(false);
  const [slow, setSlow] = useState(false);

  // The latest onContinue, so a re-render with a new function never restarts the countdown.
  const continueRef = useRef(onContinue);
  useLayoutEffect(() => {
    continueRef.current = onContinue;
  });
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    continueRef.current();
  }, []);

  useEffect(() => {
    button.current?.focus();
  }, []);

  // Any key or click anywhere continues, and so does waiting: the countdown starts when the screen
  // appears. Listeners on the document, so a key works wherever focus is; the button's own click
  // continues too (finish runs once).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (done.current || !continuesBoot(event)) return;
      if (holdsBootKey(event.key)) event.preventDefault();
      finish();
    };
    const timer = setTimeout(finish, BOOT_AUTO_CONTINUE_MS);
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', finish);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', finish);
    };
  }, [finish]);

  // "Receiving fax…" only once the data has been loading for RECEIVING_DELAY_MS: a fast load never
  // shows it, so it does not flash.
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setSlow(true), RECEIVING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  return (
    <main className="boot-screen" data-loading={loading ? 'true' : 'false'}>
      <h1 className="boot-wordmark">Facsimortis</h1>
      <div className="boot-log">
        {BOOT_LINES.map((line) => (
          <p key={line} className="boot-line">
            {line}
          </p>
        ))}
      </div>
      <p className="boot-status" role="status">
        {loading && slow ? RECEIVING_TEXT : ''}
      </p>
      <p className="boot-prompt">{BOOT_PROMPT}</p>
      <button type="button" ref={button} className="boot-button" onClick={finish}>
        {BOOT_BUTTON_LABEL}
      </button>
    </main>
  );
}

// Boot screen (R3, docs/design-brief-amber.md "Boot screen"): shown once per browser session before
// the inbox. The words, the timings and the session flag live here; BootScreen.tsx draws the screen.

/** The handshake lines, shown one after another (the stagger is CSS only, see styles.css). */
export const BOOT_LINES = ['Dialling…', 'Handshake…', 'Ready'] as const;

export const BOOT_PROMPT = 'Press any key or select Receive faxes';

export const BOOT_BUTTON_LABEL = 'Receive faxes';

/** The loading line on the boot screen (role="status"). */
export const RECEIVING_TEXT = 'Receiving fax…';

/** The boot screen continues by itself after this long, so nobody is ever stuck on it. */
export const BOOT_AUTO_CONTINUE_MS = 5000;

/** "Receiving fax…" shows only if the data is still loading this long after the screen appears, so it never flashes. */
export const RECEIVING_DELAY_MS = 150;

/** sessionStorage key, set to "1" once the boot screen has been left in this browser session. */
export const BOOTED_KEY = 'facsimortis:booted';

/** The URL parameter that skips the boot screen (for tests and screen recordings). */
export const SKIP_BOOT_PARAM = 'skipboot';

/** The part of sessionStorage the boot screen uses. */
export type SessionStore = Pick<Storage, 'getItem' | 'setItem'>;

/** This browser's sessionStorage, or null when it cannot be used (blocked, or not there). */
export function browserSession(): SessionStore | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Whether to show the boot screen: not with ?skipboot in the URL, and not once this browser session has
 * booted. Without usable storage it always shows, so the screen still works. Never throws. Pure apart
 * from reading the store.
 */
export function bootWanted(search: string, store: SessionStore | null): boolean {
  if (new URLSearchParams(search).has(SKIP_BOOT_PARAM)) return false;
  if (!store) return true;
  try {
    return store.getItem(BOOTED_KEY) !== '1';
  } catch {
    return true;
  }
}

/** Remembers that this session has booted. Without storage the boot screen simply shows again on the next load. */
export function rememberBooted(store: SessionStore | null): void {
  if (!store) return;
  try {
    store.setItem(BOOTED_KEY, '1');
  } catch {
    // Storage full or blocked: nothing to remember it in.
  }
}

const MODIFIER_KEYS = new Set([
  'Alt',
  'AltGraph',
  'CapsLock',
  'Control',
  'Fn',
  'FnLock',
  'Hyper',
  'Meta',
  'NumLock',
  'OS',
  'ScrollLock',
  'Shift',
  'Super',
  'Symbol',
  'SymbolLock',
]);

/**
 * Whether a key press leaves the boot screen: any key, except a modifier pressed on its own and except
 * shortcuts held with Ctrl, Alt or Meta, so browser and system shortcuts (and screen reader keys) keep
 * working. Pure.
 */
export function continuesBoot(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>): boolean {
  if (MODIFIER_KEYS.has(event.key)) return false;
  return !(event.ctrlKey || event.altKey || event.metaKey);
}

/**
 * Whether the key's own action is stopped when it leaves the boot screen. Enter and Space would also
 * press a button, and Tab would also move focus, on the inbox that takes the screen's place (a Space
 * released on the first fax icon would open that fax). Every other key keeps its action, so F5 still
 * reloads. Pure.
 */
export function holdsBootKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar' || key === 'Tab';
}

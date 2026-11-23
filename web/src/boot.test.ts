import { describe, expect, it } from 'vitest';
import {
  BOOTED_KEY,
  BOOT_AUTO_CONTINUE_MS,
  BOOT_BUTTON_LABEL,
  BOOT_LINES,
  BOOT_PROMPT,
  RECEIVING_DELAY_MS,
  RECEIVING_TEXT,
  bootWanted,
  continuesBoot,
  holdsBootKey,
  rememberBooted,
  type SessionStore,
} from './boot';

class MapStore implements SessionStore {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

/** Storage that is there but refuses every call, as when the browser blocks it. */
const blocked: SessionStore = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

const key = (k: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'metaKey', boolean>> = {}) => ({
  key: k,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe('boot screen words and timings', () => {
  it('has the agreed words', () => {
    expect(BOOT_LINES).toEqual(['Dialling…', 'Handshake…', 'Ready']);
    expect(BOOT_PROMPT).toBe('Press any key or select Receive faxes');
    expect(BOOT_BUTTON_LABEL).toBe('Receive faxes');
    expect(RECEIVING_TEXT).toBe('Receiving fax…');
  });

  it('continues by itself after about 5 seconds and waits about 150ms before "Receiving fax…"', () => {
    expect(BOOT_AUTO_CONTINUE_MS).toBe(5000);
    expect(RECEIVING_DELAY_MS).toBe(150);
  });
});

describe('bootWanted and rememberBooted', () => {
  it('shows once per session', () => {
    const store = new MapStore();
    expect(bootWanted('', store)).toBe(true);
    rememberBooted(store);
    expect(store.getItem(BOOTED_KEY)).toBe('1');
    expect(bootWanted('', store)).toBe(false);
  });

  it('is skipped with ?skipboot, with or without a value, and stores nothing', () => {
    const store = new MapStore();
    expect(bootWanted('?skipboot', store)).toBe(false);
    expect(bootWanted('?skipboot=1&x=2', store)).toBe(false);
    expect(bootWanted('?x=2&skipboot', store)).toBe(false);
    expect(store.data.size).toBe(0);
    expect(bootWanted('?skip=1', store)).toBe(true);
  });

  it('works with no storage, and with storage that throws', () => {
    expect(bootWanted('', null)).toBe(true);
    expect(() => rememberBooted(null)).not.toThrow();
    expect(bootWanted('', blocked)).toBe(true);
    expect(() => rememberBooted(blocked)).not.toThrow();
    expect(bootWanted('?skipboot', blocked)).toBe(false);
  });
});

describe('keys on the boot screen', () => {
  it('continue on any key, but not on a modifier alone or a Ctrl, Alt or Meta shortcut', () => {
    for (const k of ['a', 'Z', '7', 'Enter', ' ', 'Escape', 'Tab', 'ArrowDown', 'F5']) expect(continuesBoot(key(k)), k).toBe(true);
    for (const k of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']) expect(continuesBoot(key(k)), k).toBe(false);
    expect(continuesBoot(key('r', { ctrlKey: true }))).toBe(false);
    expect(continuesBoot(key('Tab', { altKey: true }))).toBe(false);
    expect(continuesBoot(key('l', { metaKey: true }))).toBe(false);
  });

  it('stop only Enter, Space and Tab from also acting on the inbox', () => {
    for (const k of ['Enter', ' ', 'Spacebar', 'Tab']) expect(holdsBootKey(k), k).toBe(true);
    for (const k of ['a', 'Escape', 'F5', 'ArrowDown']) expect(holdsBootKey(k), k).toBe(false);
  });
});

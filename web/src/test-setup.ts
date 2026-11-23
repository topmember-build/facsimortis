import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // The app saves progress in localStorage and the boot screen's "booted" flag in sessionStorage. Each
  // test starts with neither.
  window.localStorage.clear();
  window.sessionStorage.clear();
});

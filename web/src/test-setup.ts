import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { ASYNC_UTIL_TIMEOUT_MS } from './test-async-timeout';

// findBy... and waitFor wait this long for something to appear (their default is 1000 ms).
configure({ asyncUtilTimeout: ASYNC_UTIL_TIMEOUT_MS });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // The app saves progress in localStorage and the boot screen's "booted" flag in sessionStorage. Each
  // test starts with neither.
  window.localStorage.clear();
  window.sessionStorage.clear();
});

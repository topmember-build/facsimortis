/**
 * The longest one test may take, in milliseconds, in the web test files that render the whole app or run axe.
 * Those tests are slow when the machine is busy (the slowest took about 15 seconds on a loaded run), so each of
 * those files sets this explicitly with `vi.setConfig({ testTimeout: SLOW_TEST_TIMEOUT })` at the top. Change
 * the limit here and it changes in every one of them. The default for all other tests is `testTimeout` in
 * vitest.config.ts.
 *
 * This is the time limit of a test. It does not change how long Testing Library waits for something to appear
 * (`findBy...` and `waitFor` give up after one second unless told otherwise).
 */
export const SLOW_TEST_TIMEOUT = 30_000;

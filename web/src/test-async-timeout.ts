/**
 * How long, in milliseconds, Testing Library's `findBy...` queries and `waitFor` keep trying before they give
 * up. Its own default is 1000, which is too short for the whole-app tests on a busy machine (a page that was
 * rendered but had not finished loading its data failed with "Unable to find role heading and name Inbox").
 * web/src/test-setup.ts applies it once for every web test file, so this is the one place to change it.
 *
 * This is a wait for something to appear. It is not the time limit of a test, which is `testTimeout` in
 * vitest.config.ts.
 */
export const ASYNC_UTIL_TIMEOUT_MS = 10_000;

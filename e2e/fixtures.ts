/**
 * Shared Playwright test fixtures for the web-components-core e2e suite.
 *
 * Import `test` / `expect` from here instead of `@playwright/test`. The only
 * addition is an always-on guard that **fails any test in which the page threw
 * an uncaught error** (`pageerror`) — a positioning helper that throws during
 * init would otherwise sail through a green suite, surfacing only as an uncaught
 * exception nobody asserts on.
 *
 * The listener attaches during fixture setup — before the test body's first
 * `page.goto` — so it catches load-time and init-script errors too.
 *
 * Opt out (for a test that deliberately provokes an uncaught error): read the
 * injected `pageErrors` array and clear the entries you expect.
 */
import { test as base, expect } from '@playwright/test';

export * from '@playwright/test';

export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message ?? String(e)));

      await use(errors);

      // Only enforce when the test otherwise passed — don't bury a more specific
      // failure (or an expected-to-fail test) under this one.
      if (errors.length > 0 && testInfo.status === testInfo.expectedStatus) {
        expect(errors, 'uncaught page error(s) during test').toEqual([]);
      }
    },
    { auto: true },
  ],
});

export { expect };

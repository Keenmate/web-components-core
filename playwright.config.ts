import { definePlaywrightConfig, devices } from '@keenmate/web-components-devkit/playwright';

/**
 * Playwright config for the core package's end-to-end tests.
 *
 * Unlike a component repo, core is a library — there is no component to mount.
 * Instead the specs drive the `/positioning` helpers directly against real
 * layout + a real `@floating-ui/dom` in a real browser. jsdom has no layout, so
 * the unit suite (vitest, mocked floating-ui) can only assert *which* reference
 * a helper anchors to; proving the tooltip actually lands where it should needs
 * a browser. That is what this suite is for. e2e/examples.spec.ts also smoke-tests
 * the human-facing example pages.
 *
 * Specs live in e2e/ and drive fixture pages under test/*.html plus the root
 * examples-*.html pages, served by the vite dev server. baseURL and the
 * `npm run dev` web server come from package.json#kmwc.ports.dev (the devkit preset).
 *
 * Commands:
 *   npm run test:e2e:install   # one-time: download the chromium browser binary
 *   npm run test:e2e           # headless run
 *   npm run test:e2e:ui        # Playwright Test UI (debugging)
 *   npm run test:e2e:headed    # watch the browser
 */
export default definePlaywrightConfig({
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
});

import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the core package's end-to-end tests.
 *
 * Unlike a component repo, core is a library — there is no component to mount.
 * Instead the specs drive the `/positioning` helpers directly against real
 * layout + a real `@floating-ui/dom` in a real browser. jsdom has no layout, so
 * the unit suite (vitest, mocked floating-ui) can only assert *which* reference
 * a helper anchors to; proving the tooltip actually lands where it should needs
 * a browser. That is what this suite is for.
 *
 * Specs live in e2e/ and drive fixture pages under test/*.html, served by a vite
 * dev server (vite resolves the `.js`-extensioned TS source and the bare
 * `@floating-ui/dom` import with no build step).
 *
 * Commands:
 *   npm run test:e2e:install   # one-time: download the chromium browser binary
 *   npm run test:e2e           # headless run
 *   npm run test:e2e:ui        # Playwright Test UI (debugging)
 *   npm run test:e2e:headed    # watch the browser
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:12400',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
      },
    },
  ],

  webServer: {
    command: 'npm run dev',
    // Probe a real fixture page: core is a library with no root index.html, so
    // `/` 404s and Playwright would never see the server as "ready".
    url: 'http://localhost:12400/test/tooltip.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

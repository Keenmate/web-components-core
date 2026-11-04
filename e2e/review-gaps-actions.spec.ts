import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// Review 2026-11-03 A-27 (e2e gap of /actions, SPEC §12.12): one item object shared by two
// component instances. The busy guard is per instance (A-07): running "Slow" in toolbar A
// doesn't block it in toolbar B; a second click in A while A runs is still ignored; each
// trigger carries its own aria-busy.
//
// Fixture: test/actions-shared.html (two <fx-toolbar> from test/interaction-fixtures.ts with
// the same items array).

const log = (page: Page) => page.evaluate(() => (window as any).fx.log.map((e: any) => `${e.step}|${e.detail}`) as string[]);
const slow = (page: Page, bar: string) => page.locator(`#${bar}`).locator('.bar button[data-id="slow"]');

test.beforeEach(async ({ page }) => {
  await page.goto('/test/actions-shared.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
});

test('a shared item runs in both instances at once; each instance guards only its own run', async ({ page }) => {
  await slow(page, 'a').click();
  await expect(slow(page, 'a')).toHaveAttribute('aria-busy', 'true');
  await slow(page, 'b').click(); // A is still running
  await expect(slow(page, 'b')).toHaveAttribute('aria-busy', 'true');
  await slow(page, 'a').click(); // a second activation in A while A runs → ignored

  await expect.poll(async () => (await log(page)).filter((s) => s.startsWith('action event'))).toEqual([
    'action event|a:slow',
    'action event|b:slow',
  ]);
  const entries = await log(page);
  expect(entries.filter((s) => s.startsWith('onClick start'))).toEqual(['onClick start|a', 'onClick start|b']);
  expect(entries.filter((s) => s.startsWith('resolved'))).toEqual(['resolved|false', 'resolved|true', 'resolved|true']);
  // B started before A finished: the runs overlapped
  expect(entries.indexOf('onClick start|b')).toBeLessThan(entries.indexOf('onClick end|a'));
});

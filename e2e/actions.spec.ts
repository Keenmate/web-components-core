import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// /actions (SPEC §12.12) through a minimal toolbar:
//   - runAction order: beforeActionCallback → item onClick → built-in → on<Action> twin → action
//     event; the event sees the state the built-in produced; the trigger is aria-busy meanwhile;
//   - beforeActionCallback false cancels everything;
//   - a throwing onClick / built-in is logged and the event still fires;
//   - busy guard: a second activation during an async before-callback is ignored;
//   - item state: component-default disabled (reset at count 0), hidden items not rendered,
//     toggles reflect aria-pressed;
//   - an HTML-authored data-action button joins in with its extra data-* as detail.dataset.
//
// Fixture: test/actions.html (<fx-toolbar> from test/interaction-fixtures.ts).

const steps = (page: Page) => page.evaluate(() => (window as any).fx.steps() as string[]);
const reset = (page: Page) => page.evaluate(() => (window as any).fx.reset());
const entry = (page: Page, step: string) =>
  page.evaluate((s) => (window as any).fx.log.filter((e: any) => e.step === s).at(-1)?.detail as string | undefined, step);
const setBefore = (page: Page, mode: string) => page.evaluate((m) => (window as any).setBeforeMode(m), mode);

const bar = (page: Page) => page.locator('#bar');
const btn = (page: Page, item: string) =>
  bar(page).locator(`.bar button[data-id="${item}"], .bar button[data-action="${item}"]`).first();
const count = (page: Page) => bar(page).locator('.count');

test.beforeEach(async ({ page }) => {
  await page.goto('/test/actions.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
});

test('order: beforeActionCallback → onClick → built-in → twin → event; event sees the new state', async ({ page }) => {
  await setBefore(page, 'undefined');
  await btn(page, 'add').click();
  await expect.poll(() => steps(page)).toEqual([
    'beforeActionCallback',
    'item onClick',
    'built-in',
    'onAction twin',
    'action event',
    'resolved',
  ]);
  expect(JSON.parse((await entry(page, 'action event'))!)).toMatchObject({ countAtClick: 0, countNow: 1, source: 'toolbar' });
  expect(await entry(page, 'beforeActionCallback')).toBe('busy=true');
});

test('component default disables reset; hidden items are not rendered; toggles reflect aria-pressed', async ({ page }) => {
  await expect(btn(page, 'reset')).toBeDisabled();
  await expect(bar(page).locator('button[data-id="secret"]')).toHaveCount(0);
  await btn(page, 'add').click();
  await expect(btn(page, 'reset')).toBeEnabled();
  await expect(btn(page, 'bold')).toHaveAttribute('aria-pressed', 'false');
  await btn(page, 'bold').click();
  await expect(btn(page, 'bold')).toHaveAttribute('aria-pressed', 'true');
});

test('false cancels everything', async ({ page }) => {
  await setBefore(page, 'false');
  await btn(page, 'add').click();
  await expect.poll(() => entry(page, 'resolved')).toBe('false');
  expect(await steps(page)).toEqual(['beforeActionCallback', 'resolved']);
  await expect(count(page)).toHaveText('0');
});

test('a throwing onClick or built-in is logged and the event still fires', async ({ page }) => {
  await page.evaluate(() => ((window as any).shouldClickThrow = true));
  await btn(page, 'hello').click();
  await expect.poll(() => steps(page)).toEqual(['item onClick', 'console.error', 'onAction twin', 'action event', 'resolved']);

  await reset(page);
  await btn(page, 'fail').click();
  await expect.poll(() => steps(page)).toEqual(['built-in', 'console.error', 'onAction twin', 'action event', 'resolved']);
  expect(await entry(page, 'console.error')).toContain('fixture: built-in "fail" threw');
});

test('busy: a second click while the async before-callback runs is ignored', async ({ page }) => {
  await setBefore(page, 'async');
  await btn(page, 'add').click();
  await expect(btn(page, 'add')).toHaveAttribute('aria-busy', 'true');
  await btn(page, 'add').click();
  await expect.poll(() => steps(page)).toContain('busy-ignored');
  await expect(count(page)).toHaveText('1');
  await expect.poll(() => page.evaluate(() => (window as any).fx.log.filter((e: any) => e.step === 'resolved').length)).toBe(2);
  // Only one built-in ran.
  expect((await steps(page)).filter((s) => s === 'built-in')).toHaveLength(1);
  await expect(count(page)).toHaveText('1');
});

test('HTML-authored data-action button joins in with its dataset', async ({ page }) => {
  await bar(page).locator('button[data-id="from-markup"]').click();
  await expect.poll(() => steps(page)).toEqual(['onAction twin', 'action event', 'resolved']);
  expect(JSON.parse((await entry(page, 'action event'))!)).toMatchObject({
    id: 'from-markup',
    source: 'message',
    dataset: { row: '42' },
  });
});

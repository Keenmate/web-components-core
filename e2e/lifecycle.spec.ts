import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// examples-lifecycle.html — the BlissElement lifecycle page (SPEC §6.3 / §6.5).
// Each section's timeline lists <li data-kind data-hook>; these specs assert the
// hook ORDER the page shows, so the page can't drift from the real lifecycle.

const PAGE = '/examples-lifecycle.html';

/** The hook/event names logged in a section's timeline since the last action (or all). */
async function hooks(page: Page, section: string, sinceLastAction = true): Promise<string[]> {
  return page.locator(`#${section}-log`).evaluate((ol, since) => {
    const items = Array.from(ol.children) as HTMLElement[];
    let start = 0;
    if (since) items.forEach((li, i) => { if (li.dataset.kind === 'action') start = i; });
    return items.slice(start).filter((li) => li.dataset.hook).map((li) => li.dataset.hook!);
  }, sinceLastAction);
}

async function card(page: Page, stage: string) {
  return page.locator(`#${stage} core-demo-lifecycle`);
}

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
});

test('LC01: reinit → connect → ready (event, twin, whenReady) on the microtask; reinit vs update', async ({ page }) => {
  await page.locator('#lc01-create').click();
  await expect.poll(() => hooks(page, 'lc01')).toEqual(['reinit', 'connect', 'onReady twin', 'ready event', 'whenReady()']);
  await expect(page.locator('#lc01-log')).toContainText('after append (sync): isReady = false');
  await expect(page.locator('#lc01-log')).toContainText('one microtask later: isReady = true');
  await expect(page.locator('#lc01-log')).toContainText('detail.element === el: true');

  const el = await card(page, 'lc01-stage');
  await expect(el).toHaveAttribute('ready', '');
  expect(await el.evaluate((n) => n.matches(':state(ready)'))).toBe(true);

  await page.locator('#lc01-label').click();
  await expect.poll(() => hooks(page, 'lc01')).toEqual(['reinit']);
  await page.locator('#lc01-accent').click();
  await expect.poll(() => hooks(page, 'lc01')).toEqual(['update']);
  await page.locator('#lc01-both').click();
  await expect.poll(() => hooks(page, 'lc01')).toEqual(['reinit']); // the rebuild absorbs the update
});

test('LC02: defer holds the first build; release() builds once with everything; latched', async ({ page }) => {
  await page.locator('#lc02-create').click();
  await page.locator('#lc02-label').click();
  await page.locator('#lc02-accent').click();
  const all = await hooks(page, 'lc02', false);
  expect(all).toEqual([]); // nothing built while held
  await expect(page.locator('#lc02-state')).toContainText('isReady false');

  await page.locator('#lc02-release').click();
  await expect.poll(() => hooks(page, 'lc02')).toEqual(['reinit', 'connect', 'onReady twin', 'ready event', 'whenReady()']);
  await expect(page.locator('#lc02-log li[data-hook="reinit"]')).toContainText('label="Configured');

  await page.locator('#lc02-redefer').click();
  await expect.poll(() => hooks(page, 'lc02')).toEqual(['reinit']); // defer no longer holds
});

test('LC02: removing the defer attribute releases too', async ({ page }) => {
  await page.locator('#lc02-create').click();
  await page.locator('#lc02-remove-defer').click();
  await expect.poll(() => hooks(page, 'lc02')).toEqual(['reinit', 'connect', 'onReady twin', 'ready event', 'whenReady()']);
});

test('LC03: moves re-activate without rebuilding; detached config applies before connect', async ({ page }) => {
  const el = page.locator('#lc03-box-a core-demo-lifecycle');
  await el.locator('.lc-text').fill('hello');
  await el.locator('.lc-click').click();

  await page.locator('#lc03-move').click();
  await expect.poll(() => hooks(page, 'lc03')).toEqual(['disconnect', 'connect']);
  await expect(page.locator('#lc03-box-b core-demo-lifecycle')).toHaveCount(1);
  await page.locator('#lc03-reorder').click();
  await expect.poll(() => hooks(page, 'lc03')).toEqual(['disconnect', 'connect']);
  await expect(page.locator('#lc03-state')).toContainText('typed "hello"');
  await expect(page.locator('#lc03-state')).toContainText('clicks: 1');

  await page.locator('#lc03-detach').click();
  await page.locator('#lc03-detached-label').click();
  await page.locator('#lc03-attach').click();
  await expect.poll(() => hooks(page, 'lc03')).toEqual(['reinit', 'connect']);
  await expect(page.locator('#lc03-state')).toContainText('typed ""'); // a real rebuild resets it
});

test('LC04: removedCallback fires after a real removal, never on a synchronous move', async ({ page }) => {
  await page.locator('#lc04-sync').click();
  await page.waitForTimeout(100); // several frames
  expect(await hooks(page, 'lc04')).toEqual(['disconnect', 'connect']);

  await page.locator('#lc04-remove').click();
  await expect.poll(() => hooks(page, 'lc04')).toEqual(['disconnect', 'removedCallback']);

  await page.locator('#lc04-readd').click();
  await expect.poll(() => hooks(page, 'lc04')).toEqual(['connect']); // fresh activation, no reinit
});

test('LC05: destroy() → disconnect → destroyCallback; idempotent; reconnect warns and stays inert', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });

  await page.locator('#lc05-do-destroy').click();
  await expect.poll(() => hooks(page, 'lc05')).toEqual(['disconnect', 'destroyCallback']);
  await expect(page.locator('#lc05-state')).toContainText('isDestroyed true');

  await page.locator('#lc05-destroy-again').click();
  await expect(page.locator('#lc05-log')).toContainText('no hooks ran');
  expect(await hooks(page, 'lc05')).toEqual([]);

  await page.locator('#lc05-label').click();
  await expect(page.locator('#lc05-log')).toContainText('whenSettled() resolved');
  expect(await hooks(page, 'lc05')).toEqual([]);

  await page.locator('#lc05-reinsert').click();
  await page.waitForTimeout(100);
  expect(await hooks(page, 'lc05')).toEqual([]);
  expect(warnings.some((w) => w.includes('was destroyed'))).toBe(true);
});

test('LC06: a throwing reinit() is rethrown, owed, and retried; no connect() before a successful build', async ({ page, pageErrors }) => {
  await page.locator('#lc06-arm').check();
  await page.locator('#lc06-label').click();
  await expect.poll(() => hooks(page, 'lc06')).toEqual(['reinit() threw', 'caught']);
  await expect(page.locator('#lc06-arm')).not.toBeChecked();

  await page.locator('#lc06-accent').click(); // update-level change, but the owed rebuild wins
  await expect.poll(() => hooks(page, 'lc06')).toEqual(['reinit']);

  // A failed FIRST build: no connect(), no ready, until a flush succeeds.
  await page.locator('#lc06-fresh').click();
  await expect.poll(() => hooks(page, 'lc06')).toContain('reinit() threw');
  await page.waitForTimeout(50);
  const afterFresh = await hooks(page, 'lc06');
  expect(afterFresh).not.toContain('connect');
  expect(afterFresh).not.toContain('ready event');
  await expect(page.locator('#lc06-state')).toContainText('isReady false');

  await page.locator('#lc06-flush').click();
  await expect.poll(() => hooks(page, 'lc06')).toEqual(['reinit', 'connect', 'onReady twin', 'ready event', 'whenReady()']);

  // The connectedCallback throw is reported as an uncaught error — expected here.
  const rest = pageErrors.filter((e) => !e.includes('demo: reinit() failed'));
  pageErrors.length = 0;
  pageErrors.push(...rest);
});

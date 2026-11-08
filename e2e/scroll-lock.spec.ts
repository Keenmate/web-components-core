import { test, expect, type Page } from './fixtures';

// lockBodyScroll (SPEC §12.9) in a real browser:
//   - the pinned page doesn't move visually and can't scroll (wheel, scrollTo);
//   - releasing puts the scroll position back and unpins the body (that the jump is INSTANT under
//     html { scroll-behavior: smooth } is a unit test — Chromium reports a smooth scroll's
//     destination immediately, so a browser read can't tell the two apart);
//   - a lock taken by another copy of core (same Symbol.for state) keeps the page pinned.
//
// Fixture: test/scroll-lock.html

test.beforeEach(async ({ page }) => {
  await page.goto('/test/scroll-lock.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
  await page.evaluate(() => window.scrollTo({ top: 1200, behavior: 'instant' }));
});

const markerTop = (page: Page) => page.evaluate(() => document.getElementById('marker')!.getBoundingClientRect().top);

test('pinned: the page stays where it was and does not scroll', async ({ page }) => {
  const before = await markerTop(page);
  await page.evaluate(() => { (window as any).release = (window as any).core.lockBodyScroll(); });
  expect(await markerTop(page)).toBe(before);
  expect(await page.evaluate(() => getComputedStyle(document.body).position)).toBe('fixed');

  await page.mouse.move(200, 200);
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(100);
  expect(await markerTop(page)).toBe(before);
});

test('release unpins the body and restores the scroll position', async ({ page }) => {
  const before = await markerTop(page);
  const after = await page.evaluate(() => {
    const release = (window as any).core.lockBodyScroll();
    release();
    return { y: window.scrollY, position: document.body.style.position, top: document.body.style.top };
  });
  expect(after).toEqual({ y: 1200, position: '', top: '' });
  expect(await markerTop(page)).toBe(before);
});

test('another copy of core holding the lock keeps the page pinned', async ({ page }) => {
  const result = await page.evaluate(() => {
    const core = (window as any).core;
    const release = core.lockBodyScroll();
    // A second bundle joins through the shared state (what its own lockBodyScroll does).
    const state = (globalThis as any)[Symbol.for('km-scroll-lock')];
    state.count++;
    release();
    const pinnedAfterFirst = getComputedStyle(document.body).position;
    state.count--;
    return { pinnedAfterFirst, count: state.count };
  });
  expect(result).toEqual({ pinnedAfterFirst: 'fixed', count: 0 });
});

test('a page wider than the viewport cannot be scrolled sideways while locked; <html> overflow-x comes back on release', async ({ page }) => {
  const result = await page.evaluate(() => {
    const wide = document.createElement('div');
    wide.style.cssText = 'width: 3000px; height: 10px';
    document.body.append(wide);
    const release = (window as any).core.lockBodyScroll();
    const locked = getComputedStyle(document.documentElement).overflowX;
    window.scrollTo({ left: 500, behavior: 'instant' });
    const xWhileLocked = window.scrollX;
    release();
    const after = document.documentElement.style.overflowX;
    wide.remove();
    return { locked, xWhileLocked, after };
  });
  expect(result).toEqual({ locked: 'hidden', xWhileLocked: 0, after: '' });
});

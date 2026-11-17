import { test, expect, type Page } from './fixtures';

const PAGE = '/test/virtual-window.html';

interface VW {
  range: { start: number; end: number };
  scrollToIndex(i: number, o?: object): void;
  indexAt(y: number): number;
}
const vw = <T>(page: Page, fn: (v: VW) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__vw)`) as Promise<T>;
const rowCount = (page: Page): Promise<number> => page.locator('#list .row').count();

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('#list .row').first()).toHaveText('Row 0');
});

test('10 000 rows: only the visible ones + overscan are in the DOM; the scroll height is the full list', async ({ page }) => {
  expect(await rowCount(page)).toBeLessThan(25);
  const scrollHeight = await page.locator('#list').evaluate((el) => el.scrollHeight);
  expect(scrollHeight).toBe(40 + 10000 * 24); // header + spacer
});

test('wheel scrolling renders the rows under the viewport, positioned where they belong', async ({ page }) => {
  await page.locator('#list').hover();
  await page.mouse.wheel(0, 24 * 500);
  await expect.poll(() => vw(page, (v) => v.range.start)).toBeGreaterThan(400);
  const check = await page.locator('#list').evaluate((list) => {
    const box = list.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + 20, box.top + 150) as HTMLElement;
    return { text: hit.textContent, index: Number(hit.dataset.index), at: (window as unknown as { __vw: VW }).__vw.indexAt(box.top + 150) };
  });
  expect(check.text).toBe(`Row ${check.index}`);
  expect(check.at).toBe(check.index); // indexAt agrees with what is painted there
  expect(await page.evaluate(() => window.scrollY)).toBe(0); // only the list scrolled
});

test('scrollToIndex: the row lands below the sticky header; nearest leaves a visible row alone', async ({ page }) => {
  await vw(page, (v) => v.scrollToIndex(5000, { block: 'start' }));
  const row = page.locator('#list .row[data-index="5000"]');
  await expect(row).toBeVisible();
  const [rowTop, headBottom] = await Promise.all([
    row.evaluate((el) => el.getBoundingClientRect().top),
    page.locator('#list .head').evaluate((el) => el.getBoundingClientRect().bottom),
  ]);
  expect(Math.abs(rowTop - headBottom)).toBeLessThan(1);
  const before = await page.locator('#list').evaluate((el) => el.scrollTop);
  await vw(page, (v) => v.scrollToIndex(5002));
  expect(await page.locator('#list').evaluate((el) => el.scrollTop)).toBe(before);
});

test('a taller viewport renders more rows (resize watch)', async ({ page }) => {
  const before = await rowCount(page);
  await page.locator('#list').evaluate((el) => (el.style.height = '600px'));
  await expect.poll(() => rowCount(page)).toBeGreaterThan(before + 10);
});

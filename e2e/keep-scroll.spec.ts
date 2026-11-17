import { test, expect, type Page } from './fixtures';

const PAGE = '/test/keep-scroll.html';

const scrollTop = (page: Page, id: string): Promise<number> =>
  page.locator(`#${id}`).evaluate((el) => (el as unknown as { list: HTMLElement }).list.scrollTop);

test('a DOM move resets a scroller in Chromium; keepScrollAcrossMove puts it back', async ({ page }) => {
  await page.goto(PAGE);
  for (const id of ['kept', 'plain']) {
    await page.locator(`#${id}`).evaluate((el) => {
      (el as unknown as { list: HTMLElement }).list.scrollTop = 600;
    });
  }
  await expect.poll(() => scrollTop(page, 'kept')).toBe(600);
  await page.waitForTimeout(50); // the scroll events are delivered
  await page.evaluate(() => {
    const b = document.getElementById('b')!;
    b.append(document.getElementById('kept')!, document.getElementById('plain')!);
  });
  expect(await scrollTop(page, 'plain')).toBe(0); // the problem
  expect(await scrollTop(page, 'kept')).toBe(600); // the fix
  await page.waitForTimeout(50);
  expect(await scrollTop(page, 'kept')).toBe(600);
});

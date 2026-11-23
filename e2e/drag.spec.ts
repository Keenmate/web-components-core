import { test, expect, type Page } from './fixtures';

const PAGE = '/test/drag.html';

const log = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __log: string[] }).__log);
const center = async (page: Page, selector: string) => {
  const b = (await page.locator(selector).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const order = (page: Page): Promise<string[]> => page.locator('#list li').evaluateAll((els) => els.slice(0, 5).map((e) => e.textContent ?? ''));

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
});

test('mouse: drag Item 0 onto Item 3 reorders; the drop is not also a click', async ({ page }) => {
  const from = await center(page, '#list li[data-key="Item 0"]');
  const to = await center(page, '#list li[data-key="Item 3"]');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await expect(page.locator('#list li.is-over')).toHaveText('Item 3');
  await page.mouse.up();
  expect(await order(page)).toEqual(['Item 1', 'Item 2', 'Item 3', 'Item 0', 'Item 4']);
  await page.waitForTimeout(50);
  expect(await log(page)).toEqual(['start:Item 0:mouse', 'drop:Item 0->3']);
});

test('mouse: a small wobble is a click, not a drag', async ({ page }) => {
  const from = await center(page, '#list li[data-key="Item 2"]');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 2, from.y + 1);
  await page.mouse.up();
  expect(await log(page)).toEqual(['click:Item 2']);
});

test('Escape cancels; holding at the bottom edge auto-scrolls the list; the hit test pierces shadow roots', async ({ page }) => {
  const from = await center(page, '#list li[data-key="Item 1"]');
  const box = (await page.locator('#list').boundingBox())!;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 20, { steps: 3 });
  await page.mouse.move(from.x, box.y + box.height - 5, { steps: 3 });
  await expect.poll(() => page.locator('#list').evaluate((el) => el.scrollTop)).toBeGreaterThan(60);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const inner = await center(page, '#shadow');
  await page.mouse.move(inner.x, inner.y, { steps: 3 });
  await expect.poll(() => log(page)).toContain('over:shadow-inner');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await log(page)).at(-1)).toBe('cancel');
  expect(await order(page)).toEqual(['Item 0', 'Item 1', 'Item 2', 'Item 3', 'Item 4']);
});

test.describe('touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  /** Raw touch events through CDP (Playwright has no touch drag). */
  const touch = async (page: Page, steps: { type: 'touchStart' | 'touchMove' | 'touchEnd'; x?: number; y?: number; waitMs?: number }[]) => {
    const cdp = await page.context().newCDPSession(page);
    for (const s of steps) {
      await cdp.send('Input.dispatchTouchEvent', { type: s.type, touchPoints: s.type === 'touchEnd' ? [] : [{ x: s.x!, y: s.y! }] });
      if (s.waitMs) await page.waitForTimeout(s.waitMs);
    }
  };

  test('a long press then a move drags (the list does not scroll); a quick swipe scrolls instead', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'CDP touch events');
    const from = await center(page, '#list li[data-key="Item 0"]');
    const to = await center(page, '#list li[data-key="Item 2"]');
    await touch(page, [
      { type: 'touchStart', ...from, waitMs: 450 },
      { type: 'touchMove', x: from.x, y: from.y + 15, waitMs: 30 },
      { type: 'touchMove', ...to, waitMs: 30 },
      { type: 'touchEnd' },
    ]);
    await expect.poll(() => log(page)).toContain('drop:Item 0->2');
    expect((await log(page))[0]).toBe('start:Item 0:touch');
    expect(await page.locator('#list').evaluate((el) => el.scrollTop)).toBe(0);

    const before = (await log(page)).length;
    const a = await center(page, '#list li[data-key="Item 5"]');
    await touch(page, [
      { type: 'touchStart', ...a, waitMs: 20 },
      { type: 'touchMove', x: a.x, y: a.y - 40, waitMs: 20 },
      { type: 'touchMove', x: a.x, y: a.y - 90, waitMs: 20 },
      { type: 'touchEnd', waitMs: 400 },
    ]);
    expect((await log(page)).slice(before).filter((l) => l.startsWith('start'))).toEqual([]);
    expect(await page.locator('#list').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  });
});

test('observePageDrag: a file dragged over the page arms the zone; a drop disarms it', async ({ page }) => {
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File(['x'], 'a.txt', { type: 'text/plain' }));
    return d;
  });
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: dt });
  await page.dispatchEvent('body', 'dragover', { dataTransfer: dt });
  await expect(page.locator('#zone')).toHaveAttribute('drop-active', '');
  await page.dispatchEvent('body', 'drop', { dataTransfer: dt });
  await expect(page.locator('#zone')).not.toHaveAttribute('drop-active', '');

  const text = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.setData('text/plain', 'hello');
    return d;
  });
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: text }); // not files: never arms
  await page.waitForTimeout(50);
  await expect(page.locator('#zone')).not.toHaveAttribute('drop-active', '');
});

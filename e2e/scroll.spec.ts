import { test, expect, type Page } from './fixtures';

// Container scroll (SPEC §12.15) in a real browser — layout, borders, scrollbars,
// scroll-padding / scroll-margin, shadow DOM and smooth scrolling, none of which jsdom has:
//   - the walk finds a light-DOM scroller around a shadow host, and a shadow scroller around a slot;
//   - the page never moves (native scrollIntoView does);
//   - start / center / nearest land inside the client box (borders + scrollbar excluded);
//   - scroll-padding (sticky header) and scroll-margin are honoured;
//   - nearest on an already-visible row issues no scrollTo (headless Chromium doesn't animate
//     smooth scrolling, so the "don't disturb a running glide" reason can't be shown here);
//   - right-to-left horizontal scrolling;
//   - shouldRevealContainer brings a container far down the page into view;
//   - no container → the page gets the caller's block (center centres the row in the window);
//   - an element inside an iframe is measured against the iframe's own document.
//
// Fixture: test/scroll.html

test.beforeEach(async ({ page }) => {
  await page.goto('/test/scroll.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
});

/** The row's box relative to the container's visible (client) box. */
async function placement(page: Page, containerExpr: string, rowExpr: string) {
  return page.evaluate(
    ([c, r]) => {
      const container = eval(c) as HTMLElement;
      const row = eval(r) as HTMLElement;
      const box = container.getBoundingClientRect();
      const rect = row.getBoundingClientRect();
      const viewTop = box.top + container.clientTop;
      const viewLeft = box.left + container.clientLeft;
      return {
        top: rect.top - viewTop,
        bottom: rect.bottom - viewTop,
        left: rect.left - viewLeft,
        right: rect.right - viewLeft,
        clientHeight: container.clientHeight,
        clientWidth: container.clientWidth,
        scrollTop: container.scrollTop,
        pageY: window.scrollY,
      };
    },
    [containerExpr, rowExpr],
  );
}

const SHADOW_ROW = (i: number) => `document.getElementById('shadow-list').shadowRoot.querySelector('.row[data-i="${i}"]')`;

test('finds the light-DOM scroller around a shadow host; the page never moves', async ({ page }) => {
  const found = await page.evaluate(
    (rowExpr) => {
      const row = eval(rowExpr);
      const container = (window as any).core.scrollIntoContainer(row, { block: 'center' });
      return container?.id ?? null;
    },
    SHADOW_ROW(40),
  );
  expect(found).toBe('light');
  const p = await placement(page, `document.getElementById('light')`, SHADOW_ROW(40));
  expect(p.pageY).toBe(0);
  expect(p.scrollTop).toBeGreaterThan(0);
  // centred inside the client box (±1px rounding)
  expect(Math.abs((p.top + p.bottom) / 2 - p.clientHeight / 2)).toBeLessThanOrEqual(1);
});

test('native scrollIntoView moves the page; scrollIntoContainer does not (same request)', async ({ page }) => {
  const result = await page.evaluate((rowExpr) => {
    const row = eval(rowExpr) as HTMLElement;
    window.scrollTo(0, 20);
    row.scrollIntoView({ block: 'start' });
    const nativeY = window.scrollY;
    window.scrollTo(0, 20);
    document.getElementById('light')!.scrollTop = 0;
    (window as any).core.scrollIntoContainer(row, { block: 'start' });
    return { nativeY, ourY: window.scrollY };
  }, SHADOW_ROW(45));
  expect(result.nativeY).not.toBe(20);
  expect(result.ourY).toBe(20);
});

test('a slotted row scrolls the shadow scroller around its slot', async ({ page }) => {
  const scrollerExpr = `document.getElementById('slot-list').shadowRoot.querySelector('.inner')`;
  const rowExpr = `document.querySelector('#slot-list .row[data-i="35"]')`;
  const isInner = await page.evaluate(
    ([s, r]) => (window as any).core.findScrollContainer(eval(r)) === eval(s),
    [scrollerExpr, rowExpr],
  );
  expect(isInner).toBe(true);
  await page.evaluate((r) => (window as any).core.scrollIntoContainer(eval(r), { block: 'start' }), rowExpr);
  const p = await placement(page, scrollerExpr, rowExpr);
  expect(Math.abs(p.top)).toBeLessThanOrEqual(1);
  expect(p.pageY).toBe(0);
});

test('nearest: a row below aligns its bottom inside the borders; a visible row stays put', async ({ page }) => {
  await page.evaluate((r) => (window as any).core.scrollIntoContainer(eval(r)), SHADOW_ROW(20));
  let p = await placement(page, `document.getElementById('light')`, SHADOW_ROW(20));
  expect(Math.abs(p.bottom - p.clientHeight)).toBeLessThanOrEqual(1);

  const before = p.scrollTop;
  await page.evaluate((r) => (window as any).core.scrollIntoContainer(eval(r)), SHADOW_ROW(18));
  p = await placement(page, `document.getElementById('light')`, SHADOW_ROW(18));
  expect(p.scrollTop).toBe(before);
});

test('scroll-padding-top keeps the row clear of a sticky header', async ({ page }) => {
  const rowExpr = `document.querySelector('#sticky .row[data-i="25"]')`;
  await page.evaluate((r) => (window as any).core.scrollIntoContainer(eval(r), { block: 'start' }), rowExpr);
  const p = await placement(page, `document.getElementById('sticky')`, rowExpr);
  expect(Math.abs(p.top - 40)).toBeLessThanOrEqual(1);
});

test('scroll-margin-top on the row is honoured', async ({ page }) => {
  const rowExpr = `document.querySelector('#margin .row.target')`;
  await page.evaluate((r) => (window as any).core.scrollIntoContainer(eval(r), { block: 'start' }), rowExpr);
  const p = await placement(page, `document.getElementById('margin')`, rowExpr);
  expect(Math.abs(p.top - 12)).toBeLessThanOrEqual(1);
});

test('nearest on a row that is already visible issues no scrollTo at all', async ({ page }) => {
  const calls = await page.evaluate(() => {
    const box = document.getElementById('margin')!;
    let count = 0;
    const original = box.scrollTo.bind(box);
    (box as any).scrollTo = (...args: any[]) => {
      count++;
      return (original as any)(...args);
    };
    const { scrollIntoContainer } = (window as any).core;
    scrollIntoContainer(box.querySelector('.row[data-i="2"]'), { container: box });
    const visibleCalls = count;
    scrollIntoContainer(box.querySelector('.row[data-i="40"]'), { container: box });
    return { visibleCalls, total: count };
  });
  expect(calls).toEqual({ visibleCalls: 0, total: 1 });
});

test('right-to-left horizontal scroller: inline start brings a far cell into view', async ({ page }) => {
  const rowExpr = `document.querySelector('#rtl .cell[data-i="15"]')`;
  const found = await page.evaluate(
    (r) => (window as any).core.scrollIntoContainer(eval(r), { axis: 'x', inline: 'start' })?.id ?? null,
    rowExpr,
  );
  expect(found).toBe('rtl');
  const p = await placement(page, `document.getElementById('rtl')`, rowExpr);
  // inline start in RTL = the right edge
  expect(Math.abs(p.right - p.clientWidth)).toBeLessThanOrEqual(1);
});

test('shouldRevealContainer brings a container far down the page into view; off by default', async ({ page }) => {
  const rowExpr = `document.querySelector('#far .row[data-i="30"]')`;
  await page.evaluate((r) => (window as any).core.scrollIntoContainer(eval(r), { block: 'center' }), rowExpr);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await page.evaluate((r) => (window as any).core.scrollIntoContainer(eval(r), { block: 'center', shouldRevealContainer: true }), rowExpr);
  const inView = await page.evaluate((r) => {
    const box = document.getElementById('far')!.getBoundingClientRect();
    const row = (eval(r) as HTMLElement).getBoundingClientRect();
    const h = document.documentElement.clientHeight;
    return { pageY: window.scrollY, boxFits: box.top >= 0 && box.bottom <= h, rowFits: row.top >= box.top && row.bottom <= box.bottom };
  }, rowExpr);
  expect(inView.pageY).toBeGreaterThan(0);
  expect(inView.boxFits).toBe(true);
  expect(inView.rowFits).toBe(true);
});

test('no container → the page gets the same request: block center centres the row in the window', async ({ page }) => {
  const result = await page.evaluate(() => {
    const row = document.getElementById('page-row')!;
    const container = (window as any).core.scrollIntoContainer(row, { block: 'center' });
    const rect = row.getBoundingClientRect();
    return { container, offset: (rect.top + rect.bottom) / 2 - document.documentElement.clientHeight / 2, y: window.scrollY };
  });
  expect(result.container).toBeNull();
  expect(result.y).toBeGreaterThan(0);
  expect(Math.abs(result.offset)).toBeLessThanOrEqual(1);
});

test('an element inside an iframe: its scroller is found and scrolled, the page stays', async ({ page }) => {
  const result = await page.evaluate(() => {
    const frameDoc = (document.getElementById('frame') as HTMLIFrameElement).contentDocument!;
    const box = frameDoc.getElementById('box')!;
    const row = box.querySelector('.row[data-i="30"]')!;
    const { findScrollContainer, scrollIntoContainer } = (window as any).core;
    const found = findScrollContainer(row) === box;
    const scrolled = scrollIntoContainer(row, { block: 'start' }) === box;
    return { found, scrolled, scrollTop: box.scrollTop, pageY: window.scrollY };
  });
  expect(result).toEqual({ found: true, scrolled: true, scrollTop: 900, pageY: 0 });
});

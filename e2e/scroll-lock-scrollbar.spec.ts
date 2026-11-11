import { test, expect } from './fixtures';

// lockBodyScroll (SPEC §12.9) scrollbar compensation in a real browser. Fixtures:
// test/scroll-lock.html (desktop, tall page) and test/scroll-lock-phone.html (phone, page wider
// than the screen).
//
// Playwright launches headless Chromium with --hide-scrollbars; drop it so the desktop page gets
// the platform's classic scrollbar (Windows / Linux headless Chromium draw one). A launch option
// can't be set per describe group, hence its own spec file.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

// Scrollbar compensation: the body is padded by the vertical scrollbar that actually disappears
// when pinned — never by `innerWidth - clientWidth`, which on a zoomed-out phone page is the
// horizontal overflow (web-grid phone sheets saw a 651px padding-right).
test.describe('desktop: a classic scrollbar', () => {
  test('is compensated, and the content does not shift', async ({ page }) => {
    await page.goto('/test/scroll-lock.html');
    await page.locator('body[data-ready]').waitFor({ state: 'attached' });
    const result = await page.evaluate(() => {
      const root = document.documentElement;
      const scrollbar = window.innerWidth - root.clientWidth;
      const markerWidth = () => document.getElementById('marker')!.getBoundingClientRect().width;
      const widthBefore = markerWidth();
      const paddingBefore = parseFloat(getComputedStyle(document.body).paddingRight);
      const release = (window as any).core.lockBodyScroll();
      const padding = document.body.style.paddingRight;
      const widthLocked = markerWidth();
      release();
      return { scrollbar, padding, paddingBefore, widthBefore, widthLocked, after: document.body.style.paddingRight };
    });
    expect(result.scrollbar).toBeGreaterThan(0); // the precondition: a classic scrollbar is drawn
    expect(result.padding).toBe(`${result.paddingBefore + result.scrollbar}px`); // added to the page's own padding
    expect(result.widthLocked).toBe(result.widthBefore);
    expect(result.after).toBe('');
  });
});

test.describe('phone: a page wider than the screen', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

  test('no padding-right while locked, and the layout does not shift', async ({ page }) => {
    await page.goto('/test/scroll-lock-phone.html');
    await page.locator('body[data-ready]').waitFor({ state: 'attached' });
    const result = await page.evaluate(() => {
      const root = document.documentElement;
      const marker = document.getElementById('marker')!;
      const rect = () => { const r = marker.getBoundingClientRect(); return { left: r.left, width: r.width }; };
      const overflow = window.innerWidth - root.clientWidth;
      const before = rect();
      const paddingBefore = getComputedStyle(document.body).paddingRight;
      const release = (window as any).core.lockBodyScroll();
      const padding = getComputedStyle(document.body).paddingRight;
      const inline = document.body.style.paddingRight;
      const locked = rect();
      release();
      return { overflow, padding, paddingBefore, inline, before, locked };
    });
    expect(result.overflow).toBeGreaterThan(0); // the precondition: the old formula would have padded
    expect(result.inline).toBe('');
    expect(result.padding).toBe(result.paddingBefore);
    expect(result.locked).toEqual(result.before);
  });
});

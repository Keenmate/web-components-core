import { test, expect, type Page } from './fixtures';

// Review 2026-11-03 V-19 — the gaps that need a real browser:
//   - motion (V-04): an <html data-motion> / section data-motion reaches components that ALL live
//     inside a non-Bliss shadow root (nothing in the document's light DOM adopted the presets first);
//   - scroll lock (V-11): pinning the body on desktop doesn't shift the content sideways (scrollbar
//     compensation);
//   - scroll lock + observeKeyboardInset on a mobile viewport: a fixed panel tracks the visual viewport,
//     not the pinned body's negative top.
//
// Fixtures: test/motion.html, test/scroll-lock.html (reused; no new fixture needed).

// Headless Chromium hides scrollbars by default (--hide-scrollbars); the V-11 test needs a classic one.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

async function gotoReady(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
}

/** Put one motion-probe inside a plain (non-Bliss) shadow root under `wrapperHtml`'s #slot; read it. */
async function probeInPlainShadow(page: Page, wrapperHtml: string) {
  return page.evaluate((markup) => {
    const box = document.createElement('div');
    box.innerHTML = markup;
    document.body.appendChild(box);
    const slot = box.querySelector('#slot') ?? box;
    const host = document.createElement('div');
    slot.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<motion-probe></motion-probe>';
    return (window as any).readProbe(root.querySelector('motion-probe'));
  }, wrapperHtml);
}

test.describe('motion — every component inside a non-Bliss shadow root (V-04)', () => {
  test.beforeEach(async ({ page }) => gotoReady(page, '/test/motion.html'));

  test('a section data-motion reaches it', async ({ page }) => {
    expect(await probeInPlainShadow(page, '<section data-motion="none"><div id="slot"></div></section>')).toEqual({
      duration: '0s',
      scroll: 'auto',
    });
  });

  test('an author-written <html data-motion> reaches it', async ({ page }) => {
    await page.evaluate(() => document.documentElement.setAttribute('data-motion', 'smooth'));
    expect(await probeInPlainShadow(page, '<div id="slot"></div>')).toEqual({ duration: '0.25s', scroll: 'smooth' });
  });

  test('window.components.motion reaches it', async ({ page }) => {
    await page.evaluate(() => {
      ((window as any).components ??= {}).motion = 'snappy'; // before any component connected: adopted on connect
    });
    expect(await probeInPlainShadow(page, '<div id="slot"></div>')).toEqual({ duration: '0.08s', scroll: 'smooth' });
  });
});

test.describe('scroll lock', () => {
  test.beforeEach(async ({ page }) => {
    await gotoReady(page, '/test/scroll-lock.html');
    await page.evaluate(() => window.scrollTo({ top: 1200, behavior: 'instant' }));
  });

  test('desktop: pinning does not shift the content sideways (scrollbar compensation, V-11)', async ({ page }) => {
    const scrollbar = await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth);
    test.skip(scrollbar <= 0, 'this browser draws overlay scrollbars — nothing to compensate');
    const box = () =>
      page.evaluate(() => {
        const r = document.getElementById('marker')!.getBoundingClientRect();
        return { left: r.left, width: r.width, top: r.top };
      });
    const before = await box();
    await page.evaluate(() => {
      (window as any).release = (window as any).core.lockBodyScroll();
    });
    expect(await box()).toEqual(before);
    await page.evaluate(() => (window as any).release());
    expect(await box()).toEqual(before);
  });

  test('mobile viewport: a fixed panel with observeKeyboardInset tracks the visual viewport while the body is pinned', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo({ top: 1200, behavior: 'instant' }));
    const result = await page.evaluate(async () => {
      const core = (window as any).core;
      const release = core.lockBodyScroll();
      const panel = document.createElement('div');
      panel.style.cssText = 'position: fixed; left: 0; right: 0; top: 0; height: 100dvh; display: flex; flex-direction: column;';
      document.body.appendChild(panel);
      const cleanup = core.observeKeyboardInset(panel);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const vv = window.visualViewport!;
      const rect = panel.getBoundingClientRect();
      const out = {
        bodyTop: document.body.style.top,
        top: panel.style.top,
        height: panel.style.height,
        rectTop: rect.top,
        rectBottom: Math.round(rect.bottom),
        vvHeight: Math.round(vv.height),
        vvOffsetTop: vv.offsetTop,
      };
      cleanup();
      panel.remove();
      release();
      return out;
    });
    expect(result.bodyTop).toBe('-1200px'); // pinned
    expect(result.top).toBe(`${result.vvOffsetTop}px`);
    expect(result.height).toBe(`${(await page.evaluate(() => window.visualViewport!.height))}px`);
    expect(result.rectTop).toBe(result.vvOffsetTop); // not shifted by the body's negative top
    expect(result.rectBottom).toBe(result.vvHeight);
  });
});

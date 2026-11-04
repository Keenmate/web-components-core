import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetScrollLock, lockBodyScroll } from './scroll-lock.js';
import { observeKeyboardInset } from './keyboard-inset.js';

// Review 2026-11-03 V-19 #6 (overlay test gaps). Nested overlays (V-09) and dismissAllOverlays(undefined)
// (V-12) are in active-overlay.test.ts ('active-overlay nesting'); pinch-zoom in keyboard-inset.test.ts.

function setScroll(x: number, y: number): void {
  Object.defineProperty(window, 'scrollX', { value: x, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
}

describe('V-19 #6 — lockBodyScroll across copies: the restored snapshot', () => {
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });
  afterEach(() => {
    __resetScrollLock();
    document.body.removeAttribute('style');
    setScroll(0, 0);
    vi.restoreAllMocks();
  });

  it('the OTHER copy takes the first lock; this copy releases last and restores that copy’s snapshot', async () => {
    vi.resetModules();
    const other = await import('./scroll-lock.js'); // another bundle
    setScroll(20, 500);
    document.body.style.position = 'relative';
    document.body.style.overflow = 'auto';
    const releaseOther = other.lockBodyScroll(); // 0 → 1 in the other copy: it pins and saves
    expect(document.body.style.top).toBe('-500px');
    setScroll(0, 0); // the pinned page reports no scroll any more
    const releaseThis = lockBodyScroll(); // nested — must not re-capture
    releaseOther(); // the first locker leaves first
    expect(document.body.style.position).toBe('fixed');
    releaseThis();
    expect(document.body.style.position).toBe('relative');
    expect(document.body.style.overflow).toBe('auto');
    expect(document.body.style.top).toBe('');
    expect(document.body.style.left).toBe('');
    expect(document.body.style.width).toBe('');
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    expect(window.scrollTo).toHaveBeenCalledWith({ left: 20, top: 500, behavior: 'instant' });
  });
});

describe('V-19 #6 — lock → <body> swapped (Turbo / htmx) → release', () => {
  let originalBody: HTMLElement;
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    originalBody = document.body;
  });
  afterEach(() => {
    if (document.body !== originalBody) document.documentElement.replaceChild(originalBody, document.body);
    __resetScrollLock();
    document.body.removeAttribute('style');
    vi.restoreAllMocks();
  });

  it('release does not throw, balances the count, and leaves the new body unpinned', () => {
    const release = lockBodyScroll();
    const fresh = document.createElement('body');
    document.documentElement.replaceChild(fresh, originalBody);
    expect(() => release()).not.toThrow();
    expect(fresh.style.position).toBe('');
    expect(fresh.style.overflow).toBe('');
    // The count is back to 0: a new lock pins the NEW body.
    const again = lockBodyScroll();
    expect(fresh.style.position).toBe('fixed');
    again();
    expect(fresh.style.position).toBe('');
  });

  // FIXED (V-19 #6): unpin() restores the snapshot taken from the OLD body onto whatever document.body is at
  // release time. After a body swap, the new page's own inline `position` / `overflow` (absent from the
  // old body's snapshot) are removed, and the old body stays pinned (position: fixed) forever.
  it('the new body keeps its own inline styles; the old body is not left pinned', () => {
    const release = lockBodyScroll();
    const fresh = document.createElement('body');
    fresh.style.position = 'relative';
    fresh.style.overflow = 'scroll';
    document.documentElement.replaceChild(fresh, originalBody);
    release();
    expect(fresh.style.position).toBe('relative');
    expect(fresh.style.overflow).toBe('scroll');
    expect(originalBody.style.position).toBe('');
  });
});

describe('V-19 #6 — observeKeyboardInset: an offsetTop change via the scroll event alone', () => {
  class FakeViewport extends EventTarget {
    height = 800;
    offsetTop = 0;
    scale = 1;
  }
  let vp: FakeViewport;
  beforeEach(() => {
    vp = new FakeViewport();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    Object.defineProperty(window, 'visualViewport', { value: vp, configurable: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
  });

  it('follows the visual viewport scrolling (iOS bringing the field into view) without a resize', () => {
    const panel = document.createElement('div');
    const cleanup = observeKeyboardInset(panel);
    vp.height = 450; // keyboard already open
    vp.offsetTop = 120;
    vp.dispatchEvent(new Event('scroll'));
    expect(panel.style.top).toBe('120px');
    expect(panel.style.height).toBe('450px');
    vp.offsetTop = 0;
    vp.dispatchEvent(new Event('scroll'));
    expect(panel.style.top).toBe('0px');
    cleanup();
    vp.offsetTop = 300;
    vp.dispatchEvent(new Event('scroll'));
    expect(panel.style.top).toBe(''); // detached
  });

  it('a pinch-zoom scroll (scale ≠ 1) is ignored', () => {
    const panel = document.createElement('div');
    const cleanup = observeKeyboardInset(panel);
    expect(panel.style.top).toBe('0px');
    vp.scale = 2;
    vp.offsetTop = 200;
    vp.height = 400;
    vp.dispatchEvent(new Event('scroll'));
    expect(panel.style.top).toBe('0px');
    expect(panel.style.height).toBe('800px');
    cleanup();
  });
});

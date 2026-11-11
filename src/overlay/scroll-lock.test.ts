import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { lockBodyScroll, __resetScrollLock, type ScrollLockState } from './scroll-lock.js';

const STATE_KEY = Symbol.for('km-scroll-lock');
const shared = () => (globalThis as unknown as Record<symbol, ScrollLockState>)[STATE_KEY]!;

describe('lockBodyScroll', () => {
  // jsdom has no scrolling; it logs "not implemented" for scrollTo.
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });
  afterEach(() => {
    __resetScrollLock();
    document.body.removeAttribute('style');
    document.documentElement.removeAttribute('style');
    vi.restoreAllMocks();
  });

  it('pins the body at minus the scroll offset and restores everything on release', () => {
    Object.defineProperty(window, 'scrollY', { value: 300, configurable: true });
    document.body.style.overflow = 'auto';
    const release = lockBodyScroll();
    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-300px');
    expect(document.body.style.width).toBe('100%');
    expect(document.body.style.overflow).toBe('hidden');
    release();
    expect(document.body.style.position).toBe('');
    expect(document.body.style.top).toBe('');
    expect(document.body.style.overflow).toBe('auto');
    expect(window.scrollTo).toHaveBeenCalledWith({ left: 0, top: 300, behavior: 'instant' });
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });

  it('clamps <html> overflow-x while locked (no zoomed-out page under a sheet) and restores its own value', () => {
    const root = document.documentElement;
    const release = lockBodyScroll();
    expect(root.style.overflowX).toBe('hidden');
    expect(shared().saved?.rootStyle).toEqual({ 'overflow-x': '' });
    release();
    expect(root.style.overflowX).toBe('');
    root.style.overflowX = 'clip';
    const again = lockBodyScroll();
    expect(root.style.overflowX).toBe('hidden');
    again();
    expect(root.style.overflowX).toBe('clip');
  });

  it('a joiner that saved no rootStyle (older copy, pure-css) leaves <html> alone on release', () => {
    const release = lockBodyScroll();
    const root = document.documentElement;
    root.style.overflowX = 'scroll'; // whatever the page has now
    delete shared().saved!.rootStyle;
    release();
    expect(root.style.overflowX).toBe('scroll');
  });

  it('restores the body’s own inline position', () => {
    document.body.style.position = 'relative';
    const release = lockBodyScroll();
    expect(document.body.style.position).toBe('fixed');
    release();
    expect(document.body.style.position).toBe('relative');
  });

  it('ref-counts: stays locked until the last release', () => {
    const a = lockBodyScroll();
    const b = lockBodyScroll();
    a();
    expect(document.body.style.position).toBe('fixed'); // b still holds
    b();
    expect(document.body.style.position).toBe('');
  });

  it('release is idempotent — a double-release cannot unbalance the count', () => {
    const a = lockBodyScroll();
    const b = lockBodyScroll();
    a();
    a(); // second call is a no-op, must NOT drop b's hold
    expect(document.body.style.position).toBe('fixed');
    b();
    expect(document.body.style.position).toBe('');
  });

  it('captures the styles present at the FIRST lock, not at a nested one', () => {
    document.body.style.overflow = 'auto';
    const a = lockBodyScroll();
    const b = lockBodyScroll();
    a();
    b();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('shares one count across copies of core (globalThis, Symbol.for)', async () => {
    vi.resetModules();
    const other = await import('./scroll-lock.js'); // a second module instance = another bundle
    expect(other.lockBodyScroll).not.toBe(lockBodyScroll);
    document.body.style.overflow = 'auto';
    const a = lockBodyScroll();
    const b = other.lockBodyScroll();
    expect(shared().count).toBe(2);
    a();
    expect(document.body.style.position).toBe('fixed'); // the other copy still holds it
    b();
    expect(document.body.style.position).toBe('');
    expect(document.body.style.overflow).toBe('auto');
  });
});

// Review 2026-11-03 V-11.
describe('lockBodyScroll — scrollbar compensation', () => {
  afterEach(() => {
    __resetScrollLock();
    document.body.removeAttribute('style');
    vi.restoreAllMocks();
  });

  /** Stub `<html>`'s clientWidth: `pinned` while the body is position: fixed, else `free`. */
  const stubRootWidth = (free: number, pinned: number) =>
    Object.defineProperty(document.documentElement, 'clientWidth', {
      configurable: true,
      get: () => (document.body.style.position === 'fixed' ? pinned : free),
    });
  const unstubRootWidth = () =>
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 0 });

  it('pads the body by the scrollbar that disappears while pinned, and restores it', () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    stubRootWidth(1265, 1280); // a classic 15px scrollbar goes away when pinned
    document.body.style.paddingRight = '4px';
    const release = lockBodyScroll();
    expect(document.body.style.paddingRight).toBe('19px');
    release();
    expect(document.body.style.paddingRight).toBe('4px');
    unstubRootWidth();
  });

  it('no compensation on a zoomed-out phone page wider than the screen (overlay scrollbars)', () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    // innerWidth follows the zoomed-out visual viewport (the old innerWidth - clientWidth bug: 651px).
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1026);
    stubRootWidth(375, 375);
    const release = lockBodyScroll();
    expect(document.body.style.paddingRight).toBe('');
    release();
    expect(document.body.style.paddingRight).toBe('');
    unstubRootWidth();
  });

  it('nested locks pad once and restore the original inline padding on the last release', () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    stubRootWidth(1265, 1280);
    document.body.style.paddingRight = '2px';
    const a = lockBodyScroll();
    const b = lockBodyScroll();
    expect(document.body.style.paddingRight).toBe('17px');
    a();
    expect(document.body.style.paddingRight).toBe('17px');
    b();
    expect(document.body.style.paddingRight).toBe('2px');
    unstubRootWidth();
  });
});

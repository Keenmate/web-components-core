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

  it('pads the body by the scrollbar width while pinned, and restores it', () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: window.innerWidth - 15 });
    document.body.style.paddingRight = '4px';
    const release = lockBodyScroll();
    expect(document.body.style.paddingRight).toBe('19px');
    release();
    expect(document.body.style.paddingRight).toBe('4px');
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 0 });
  });
});

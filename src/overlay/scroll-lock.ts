/**
 * Lock page scroll behind a fullscreen overlay (SPEC §12.9). A single ref-counted
 * lock that PINS `document.body`: the first lock records the page's scroll position
 * and the body's inline styles, then sets `position: fixed` with `top` / `left` at
 * minus the scroll offset (the page looks unmoved) plus `overflow: hidden`; the last
 * release restores the styles and jumps back to the recorded position (instantly,
 * even under `scroll-behavior: smooth`). `overflow: hidden` alone is ignored by iOS
 * Safari for touch scrolling; a pinned body can't scroll anywhere.
 *
 * Ref-counting makes it safe when several overlays (or several component instances)
 * are open at once — page scroll stays locked until the *last* one closes. The state
 * lives on `globalThis[Symbol.for('km-scroll-lock')]` (see {@link ScrollLockState}), so
 * every bundled copy of core — and non-core code such as pure-css, which uses the
 * same key and shape — shares ONE count and one saved snapshot.
 *
 * SSR-safe: with no `document` (or no `<body>` yet) it's a no-op returning a no-op release.
 */

import { once } from '../dom/once.js';

/** The body inline styles the lock writes (and restores). */
const PINNED_PROPERTIES = ['position', 'top', 'left', 'right', 'width', 'overflow'] as const;

/**
 * Shared lock state, `globalThis[Symbol.for('km-scroll-lock')]`. A documented shape:
 * other libraries may join the same lock by incrementing `count` (and, on the 0→1
 * transition, filling `saved` and pinning the body exactly like core does).
 */
export interface ScrollLockState {
  /** How many active locks are holding page scroll shut. */
  count: number;
  /** Captured on the 0→1 transition, restored on 1→0; `null` while unlocked. */
  saved: {
    scrollX: number;
    scrollY: number;
    /** The body's inline value of each pinned property (`''` = none). */
    style: Record<string, string>;
  } | null;
}

const STATE_KEY = Symbol.for('km-scroll-lock');

function state(): ScrollLockState {
  const g = globalThis as unknown as Record<symbol, ScrollLockState | undefined>;
  return (g[STATE_KEY] ??= { count: 0, saved: null });
}

function pin(body: HTMLElement): void {
  const view = body.ownerDocument.defaultView;
  const scrollX = view?.scrollX ?? 0;
  const scrollY = view?.scrollY ?? 0;
  const style: Record<string, string> = {};
  for (const prop of PINNED_PROPERTIES) style[prop] = body.style.getPropertyValue(prop);
  state().saved = { scrollX, scrollY, style };

  body.style.setProperty('position', 'fixed');
  body.style.setProperty('top', `${-scrollY}px`);
  body.style.setProperty('left', `${-scrollX}px`);
  body.style.setProperty('right', '0');
  body.style.setProperty('width', '100%');
  body.style.setProperty('overflow', 'hidden');
}

function unpin(body: HTMLElement): void {
  const s = state();
  const saved = s.saved;
  s.saved = null;
  if (!saved) return;
  for (const prop of PINNED_PROPERTIES) {
    const value = saved.style[prop];
    if (value) body.style.setProperty(prop, value);
    else body.style.removeProperty(prop);
  }
  const view = body.ownerDocument.defaultView;
  try {
    // 'instant' beats a page-level `scroll-behavior: smooth` — the jump back must not animate.
    view?.scrollTo({ left: saved.scrollX, top: saved.scrollY, behavior: 'instant' as ScrollBehavior });
  } catch {
    // No layout engine (jsdom) — nothing to restore.
  }
}

/**
 * Lock page scroll and return a release function. Idempotent per call: the returned
 * release runs at most once, so a double-release can't unbalance the ref count. The
 * body is unpinned and the scroll position restored only when the final lock releases.
 */
export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined' || !document.body) return () => {};

  const s = state();
  if (s.count === 0) pin(document.body);
  s.count++;

  return once(() => {
    const current = state();
    current.count = Math.max(0, current.count - 1);
    if (current.count === 0 && typeof document !== 'undefined' && document.body) unpin(document.body);
  });
}

/** Test-only: force-release all locks and restore the body immediately. */
export function __resetScrollLock(): void {
  if (typeof document !== 'undefined' && document.body) unpin(document.body);
  const s = state();
  s.count = 0;
  s.saved = null;
}

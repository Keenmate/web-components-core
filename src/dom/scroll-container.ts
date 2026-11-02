/**
 * Container scroll (SPEC §12.15): bring an inner element into view by scrolling the ONE
 * container around it, never the page. `Element.scrollIntoView()` scrolls every scrollable
 * ancestor (the page included), so a search jump or a keyboard move made the whole page jump.
 *
 * Zero dependencies, SSR-safe (no `document` → `null`, nothing happens).
 */

import { composedParent } from './composed-tree.js';

/** Which overflow axis makes an ancestor a scroll container. */
export type ScrollAxis = 'y' | 'x' | 'both';

export interface FindScrollContainerOptions {
  /** Stop the walk at this element (exclusive) — e.g. a component's own root when only its
   *  internal scroller may be used. Default: walk until `<body>`. */
  stopAt?: Element | null;
  /** The axis that must scroll: `'y'` (default), `'x'`, or `'both'` (either one). */
  axis?: ScrollAxis;
}

export interface ScrollIntoContainerOptions extends FindScrollContainerOptions {
  /** Vertical: `'nearest'` (default) scrolls only as far as needed — a fully visible element
   *  stays put; `'start'` / `'center'` / `'end'` align it. */
  block?: ScrollLogicalPosition;
  /** Same values, horizontal axis. Default `'nearest'`. */
  inline?: ScrollLogicalPosition;
  /** Default `'auto'` (instant). The caller decides (e.g. from its `--*-scroll-behavior` token). */
  behavior?: ScrollBehavior;
  /** Scroll this container instead of searching (a component that knows its scroller). */
  container?: HTMLElement | null;
  /** Also bring the container itself into the viewport (`'nearest'`) when it isn't fully
   *  visible — e.g. a jump to a search hit in a tree further down the page. Default `false`. */
  revealContainer?: boolean;
}

const SCROLLING_OVERFLOW = new Set(['auto', 'scroll', 'overlay']);

/** Below this many pixels on both axes nothing moves — and `scrollTo()` isn't called at all: a
 *  redundant call can disturb a smooth scroll still running (e.g. the next key press while the
 *  list glides) and costs a scroll update for nothing. */
const MIN_DELTA = 1;

function isAvailable(): boolean {
  return typeof document !== 'undefined' && typeof getComputedStyle === 'function';
}

/** Flat-tree parent: a slotted node lays out inside its slot, so the slot's scroller is the
 *  one that moves it; otherwise the composed parent (shadow root → host). */
function flatParent(node: Element): Element | null {
  return node.assignedSlot ?? composedParent(node);
}

function isPage(el: Element): boolean {
  return el === document.documentElement || el === document.body || el === document.scrollingElement;
}

function scrollsOn(el: Element, style: CSSStyleDeclaration, axis: 'x' | 'y'): boolean {
  return axis === 'y'
    ? SCROLLING_OVERFLOW.has(style.overflowY) && el.scrollHeight > el.clientHeight
    : SCROLLING_OVERFLOW.has(style.overflowX) && el.scrollWidth > el.clientWidth;
}

/**
 * Nearest ancestor of `el` that ACTUALLY scrolls on `axis`: computed overflow `auto` | `scroll`
 * | `overlay` AND content larger than the box. Walks the flat tree (slot → shadow host → light
 * DOM), so a light-DOM wrapper around a custom element is found. Never returns `<html>`,
 * `<body>` or `document.scrollingElement` — the page is not a container. `null` = only the
 * page scrolls (or no DOM).
 */
export function findScrollContainer(el: Element, options: FindScrollContainerOptions = {}): HTMLElement | null {
  if (!isAvailable()) return null;
  const { stopAt = null, axis = 'y' } = options;
  for (let node = flatParent(el); node; node = flatParent(node)) {
    if (node === stopAt || isPage(node)) return null;
    if (!(node instanceof HTMLElement)) continue;
    const style = getComputedStyle(node);
    const matches =
      axis === 'both'
        ? scrollsOn(node, style, 'y') || scrollsOn(node, style, 'x')
        : scrollsOn(node, style, axis);
    if (matches) return node;
  }
  return null;
}

function px(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * How far to scroll one axis so the target box [tStart, tEnd] sits in the view [vStart, vEnd].
 * `nearest` follows the CSSOM rules: a box already inside, or one larger than the view that
 * covers it, doesn't move; otherwise the closer edge aligns.
 */
function axisDelta(position: ScrollLogicalPosition, tStart: number, tEnd: number, vStart: number, vEnd: number): number {
  switch (position) {
    case 'start':
      return tStart - vStart;
    case 'end':
      return tEnd - vEnd;
    case 'center':
      return (tStart + tEnd) / 2 - (vStart + vEnd) / 2;
    default: {
      const isLarger = tEnd - tStart > vEnd - vStart;
      if (tStart < vStart && tEnd > vEnd) return 0;
      if (tStart < vStart) return isLarger ? tEnd - vEnd : tStart - vStart;
      if (tEnd > vEnd) return isLarger ? tStart - vStart : tEnd - vEnd;
      return 0;
    }
  }
}

function isFullyInViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const root = document.documentElement;
  const height = root.clientHeight || window.innerHeight;
  const width = root.clientWidth || window.innerWidth;
  return rect.top >= 0 && rect.left >= 0 && rect.bottom <= height && rect.right <= width;
}

/**
 * Bring `el` into view by scrolling ONE container — `options.container` or
 * `findScrollContainer(el, options)` — never the page. The view honours the container's
 * `scroll-padding` and the element's `scroll-margin` (sticky headers are a CSS matter, as with
 * native scrolling). Nothing to move → no `scrollTo()` call.
 *
 * No container → `el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior })`: the
 * page moves only if `el` is off-screen. Returns the container used, `null` for that fallback.
 */
export function scrollIntoContainer(el: Element, options: ScrollIntoContainerOptions = {}): HTMLElement | null {
  if (!isAvailable()) return null;
  const { block = 'nearest', inline = 'nearest', behavior = 'auto', revealContainer = false } = options;
  const container = options.container ?? findScrollContainer(el, options);

  if (!container) {
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior });
    return null;
  }

  if (revealContainer && !isFullyInViewport(container)) {
    container.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior });
  }

  const box = container.getBoundingClientRect();
  const boxStyle = getComputedStyle(container);
  const target = el.getBoundingClientRect();
  const targetStyle = getComputedStyle(el);

  const viewTop = box.top + container.clientTop + px(boxStyle.scrollPaddingTop);
  const viewBottom = box.top + container.clientTop + container.clientHeight - px(boxStyle.scrollPaddingBottom);
  const viewLeft = box.left + container.clientLeft + px(boxStyle.scrollPaddingLeft);
  const viewRight = box.left + container.clientLeft + container.clientWidth - px(boxStyle.scrollPaddingRight);

  const dy = axisDelta(
    block,
    target.top - px(targetStyle.scrollMarginTop),
    target.bottom + px(targetStyle.scrollMarginBottom),
    viewTop,
    viewBottom,
  );
  // `start` / `end` are logical: in a right-to-left container the inline start is the RIGHT edge.
  const isRtl = boxStyle.direction === 'rtl';
  const dx = axisDelta(
    isRtl && inline === 'start' ? 'end' : isRtl && inline === 'end' ? 'start' : inline,
    target.left - px(targetStyle.scrollMarginLeft),
    target.right + px(targetStyle.scrollMarginRight),
    viewLeft,
    viewRight,
  );

  if (Math.abs(dy) >= MIN_DELTA || Math.abs(dx) >= MIN_DELTA) {
    container.scrollTo({ top: container.scrollTop + dy, left: container.scrollLeft + dx, behavior });
  }
  return container;
}

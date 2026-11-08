/**
 * The one "close on scroll" rule for core's floating layers (`createPopover()`, `openMenu()`):
 * like a native `<select>`, close when the user scrolls the content the layer belongs to —
 *   - never a scroll inside the layer itself (its own list);
 *   - only a scroll of the page or of a scroller AROUND the reference (an unrelated scroller —
 *     a log panel auto-scrolling, a sidebar list — doesn't count);
 *   - only once the reference has actually moved (≥ 1px) since the watch started: a scroll event
 *     can arrive a frame late (a scroll that finished just before the click that opened it).
 * `scroll` doesn't cross a shadow boundary, so it listens on the document and on every shadow
 * root between it and the reference.
 */
import { composedParent } from '../dom/composed-tree.js';

type Rectish = { getBoundingClientRect(): DOMRect | { top: number; left: number } };

export interface ScrollCloseOptions {
  /** What the layer is attached to; a virtual reference (no element) moves only with the page. */
  reference: Element | Rectish;
  /** Is the scroll event inside the layer (its panels)? Those never close it. */
  isInside(event: Event): boolean;
  /** Called for a scroll that counts (it may be called again; make it idempotent). */
  onScroll(event: Event): void;
}

/** The document plus every shadow root between it and `node`. */
export function scrollRoots(node: Node | null): (Document | ShadowRoot)[] {
  const roots: (Document | ShadowRoot)[] = [];
  for (let n: Node | null = node; n; ) {
    const root = n.getRootNode();
    if (!(root instanceof ShadowRoot)) break;
    roots.push(root);
    n = root.host;
  }
  if (typeof document !== 'undefined') roots.push(document);
  return roots;
}

/** Start watching; returns the stop. SSR-safe (no document → a no-op stop). */
export function watchScrollClose(opts: ScrollCloseOptions): () => void {
  if (typeof document === 'undefined') return () => {};
  const { reference } = opts;
  const element = reference instanceof Element ? reference : null;
  const spot = (): { top: number; left: number } => {
    const rect = reference.getBoundingClientRect();
    return { top: rect.top, left: rect.left };
  };
  const startedAt = spot();
  const hasMoved = (): boolean => {
    const now = spot();
    return Math.abs(now.top - startedAt.top) >= 1 || Math.abs(now.left - startedAt.left) >= 1;
  };
  /** The document / window, or a scroller that contains the reference (across shadow roots). */
  const isAroundReference = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return true;
    if (!element) return false; // a virtual reference: only the page moves it
    for (let n: Element | null = element; n; n = composedParent(n)) if (n === target) return true;
    return false;
  };
  const onScroll = (event: Event): void => {
    if (opts.isInside(event)) return;
    if (!isAroundReference(event.target)) return;
    if (!hasMoved()) return;
    opts.onScroll(event);
  };
  const roots = scrollRoots(element);
  for (const root of roots) root.addEventListener('scroll', onScroll, { capture: true, passive: true });
  return () => {
    for (const root of roots) root.removeEventListener('scroll', onScroll, { capture: true });
  };
}

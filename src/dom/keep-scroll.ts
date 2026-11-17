/**
 * Scroll positions that survive a DOM move (SPEC §12.31). Moving an element (a reorder, a re-parent, a
 * framework keyed list) detaches it for a moment: every scroll container inside loses its offset and comes
 * back at the top. BlissElement keeps the component's STATE across a move (no rebuild) — this keeps its
 * scroll positions too.
 *
 * `keepScrollAcrossMove(host, () => [scrollers])` records each scroller's position as it scrolls (a detached
 * element already reads 0, so recording at disconnect would be too late) and puts it back after the host's
 * next `connect()` (and once more on the next frame, after the component's own re-render). `host` must be a
 * BlissElement (it reports the reconnect).
 */

import { watchConnection } from '../element/connection-watch.js';

type Scroller = Element | null | undefined;

export function keepScrollAcrossMove(host: HTMLElement, getScrollers: () => Iterable<Scroller>): () => void {
  const saved = new WeakMap<Element, { top: number; left: number }>();
  const scrollers = (): Element[] => [...getScrollers()].filter((el): el is Element => !!el);

  const onScroll = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element) || !target.isConnected) return;
    if (!scrollers().includes(target)) return;
    saved.set(target, { top: target.scrollTop, left: target.scrollLeft });
  };
  const roots: EventTarget[] = [host];
  if (host.shadowRoot) roots.push(host.shadowRoot);
  for (const root of roots) root.addEventListener('scroll', onScroll, { capture: true, passive: true });

  const restore = (): void => {
    for (const el of scrollers()) {
      const position = saved.get(el);
      if (!position || !el.isConnected) continue;
      if (el.scrollTop !== position.top) el.scrollTop = position.top;
      if (el.scrollLeft !== position.left) el.scrollLeft = position.left;
    }
  };
  const view = host.ownerDocument.defaultView;
  const stopWatch = watchConnection(host, () => {
    restore();
    view?.requestAnimationFrame?.(restore); // after a re-render in the same frame
  });

  return () => {
    stopWatch();
    for (const root of roots) root.removeEventListener('scroll', onScroll, { capture: true });
  };
}

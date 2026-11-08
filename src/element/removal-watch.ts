/**
 * Core-internal: let a core helper bound to an element (e.g. `createCustomStyles`) hear when
 * that element is REALLY removed (still detached one frame after disconnect — the
 * `removedCallback` timing) and when it comes back. `BlissElement` drives it; a host that is
 * not a BlissElement never reports, so the helper falls back to its own `destroy()`.
 *
 * Page-wide (`sharedState`): the copy of core that defined the element may not be the copy
 * that created the helper.
 */
import { sharedState, sharedStateKey } from '../global/shared-state.js';

export interface RemovalWatcher {
  /** The element was removed (not moved). */
  onRemoved(): void;
  /** A removed element was attached again. */
  onReturned(): void;
}

const watchers = (): WeakMap<Element, Set<RemovalWatcher>> =>
  sharedState(sharedStateKey('removal-watchers'), () => new WeakMap<Element, Set<RemovalWatcher>>());

/** Watch `el`'s real removal / return; returns the unwatch. */
export function watchRemoval(el: Element, watcher: RemovalWatcher): () => void {
  const map = watchers();
  let set = map.get(el);
  if (!set) map.set(el, (set = new Set()));
  set.add(watcher);
  return () => {
    set!.delete(watcher);
  };
}

/** Does anything watch `el`? (BlissElement schedules its removal check only then, or for removedCallback.) */
export function hasRemovalWatchers(el: Element): boolean {
  return (watchers().get(el)?.size ?? 0) > 0;
}

/** Tell `el`'s watchers; a throwing watcher is reported to `onError` and the others still run. */
export function notifyRemoval(el: Element, kind: 'removed' | 'returned', onError: (error: unknown) => void): void {
  for (const w of [...(watchers().get(el) ?? [])]) {
    try {
      if (kind === 'removed') w.onRemoved();
      else w.onReturned();
    } catch (error) {
      onError(error);
    }
  }
}

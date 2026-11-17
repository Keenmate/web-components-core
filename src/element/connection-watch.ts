/**
 * Core-internal: let a core helper bound to an element hear every (re)activation — after `connect()` ran,
 * on the first connect and after every DOM move. `BlissElement` drives it (see `keepScrollAcrossMove`). A host
 * that is not a BlissElement never reports.
 *
 * Page-wide (`sharedState`): the copy of core that defined the element may not be the copy that created the
 * helper.
 */
import { sharedState, sharedStateKey } from '../global/shared-state.js';

const watchers = (): WeakMap<Element, Set<() => void>> =>
  sharedState(sharedStateKey('connection-watchers'), () => new WeakMap<Element, Set<() => void>>());

/** Call `onConnected` after each activation of `el`; returns the unwatch. */
export function watchConnection(el: Element, onConnected: () => void): () => void {
  const map = watchers();
  let set = map.get(el);
  if (!set) map.set(el, (set = new Set()));
  set.add(onConnected);
  return () => {
    set!.delete(onConnected);
  };
}

/** Tell `el`'s watchers it is active again; a throwing watcher goes to `onError`, the others still run. */
export function notifyConnected(el: Element, onError: (error: unknown) => void): void {
  const set = watchers().get(el);
  if (!set?.size) return;
  for (const watcher of [...set]) {
    try {
      watcher();
    } catch (error) {
      onError(error);
    }
  }
}

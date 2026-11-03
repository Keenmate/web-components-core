/**
 * A per-tag registry of the live element instances on the page. {@link BlissElement}
 * adds itself on connect and removes itself on disconnect, so the set is always
 * the currently-connected elements of that tag — no `querySelectorAll`, no
 * per-component `Set` boilerplate (SPEC §12.3).
 *
 * The returned elements ARE the per-instance handles: a devtools overlay can
 * enumerate every registered tag via `window.components`, list each tag's
 * instances, and act on the element directly (highlight it, toggle its logging,
 * …). See {@link registerComponent}.
 *
 * One registry per PAGE (shared by every copy of core): an element is tracked by the
 * copy that defined its class, and `getInstances()` from any other copy still sees it.
 */
import { sharedState, sharedStateKey } from './shared-state.js';

/** tagName (lowercase) → the set of connected elements of that tag. */
const registry = (): Map<string, Set<HTMLElement>> =>
  sharedState(sharedStateKey('instances'), () => new Map<string, Set<HTMLElement>>());

/** Record a newly-connected element under its tag. Called by `BlissElement`. */
export function trackInstance(tagName: string, el: HTMLElement): void {
  const map = registry();
  let set = map.get(tagName);
  if (!set) map.set(tagName, (set = new Set()));
  set.add(el);
}

/** Drop a disconnected element from its tag's set. Called by `BlissElement`. */
export function untrackInstance(tagName: string, el: HTMLElement): void {
  registry().get(tagName)?.delete(el);
}

/** The live, connected instances of `tagName`, in connection order. */
export function getInstances<T extends HTMLElement = HTMLElement>(tagName: string): T[] {
  return Array.from((registry().get(tagName) ?? []) as Set<T>);
}

/** Every tag that currently has at least one connected instance. */
export function getRegisteredTags(): string[] {
  const map = registry();
  return Array.from(map.keys()).filter((tag) => (map.get(tag)?.size ?? 0) > 0);
}

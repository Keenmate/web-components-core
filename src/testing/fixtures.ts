/**
 * Runner-agnostic DOM test fixtures for BlissElement-based components
 * (SPEC §12.4 "Testing utilities"). Pure DOM — no import of vitest/Playwright —
 * so the same helpers work under vitest+jsdom, a real browser, or any runner.
 * The deterministic "await the pipeline" signal is `element.whenSettled()` on
 * BlissElement itself; these helpers cover mount/teardown, upgrade timing, and
 * event assertions that every component test otherwise re-implements.
 */

import { sharedState, sharedStateKey } from '../global/shared-state.js';

/** Every container `mount`/`mountBeforeUpgrade` created (or element it put into a given container), for {@link cleanup}. */
const MOUNTED = new Set<HTMLElement>();

/**
 * Monotonic counter for {@link uniqueTag} — deterministic, no `Math.random`. Page-wide,
 * so two copies of core (or a test that re-imports the module) never hand out the same tag.
 */
const tagSeq = (): { next: number } => sharedState(sharedStateKey('test-tag-seq'), () => ({ next: 0 }));

/**
 * A fresh, valid custom-element tag name (`prefix-N`). Use one per test so a
 * class defined in one test never clashes with another (`customElements.define`
 * throws on a duplicate tag).
 */
export function uniqueTag(prefix = 'bliss-test'): string {
  const seq = tagSeq();
  return `${prefix}-${seq.next++}`;
}

/**
 * Idempotent `customElements.define`: defines `tag` only if it isn't already,
 * so re-running a test file (watch mode) doesn't throw "already defined".
 * Throws when `tag` is already defined by a DIFFERENT class — the test would
 * otherwise silently run against the wrong one. Returns `tag` for chaining.
 */
export function defineOnce(tag: string, ctor: CustomElementConstructor): string {
  const defined = customElements.get(tag);
  if (!defined) customElements.define(tag, ctor);
  else if (defined !== ctor) {
    throw new Error(`defineOnce: <${tag}> is already defined by a different class — use uniqueTag() for a fresh tag`);
  }
  return tag;
}

/** Options for {@link mount}. */
export interface MountOptions {
  /** Container to append into (default: a fresh `<div>` appended to `document.body`). */
  container?: HTMLElement;
}

/**
 * Mount an element (or an HTML string) into the document and track it for
 * {@link cleanup}. Given a string, its first element child is returned. The
 * element is connected, so a BlissElement runs its first `reinit()` + `connect()`
 * synchronously; `await el.whenSettled()` afterwards to await any further batch.
 */
export function mount<T extends Element = Element>(source: string | Element, opts?: MountOptions): T {
  const host = opts?.container ?? document.createElement('div');
  if (!opts?.container) {
    document.body.append(host);
    MOUNTED.add(host);
  } else if (!opts.container.isConnected) {
    // A detached container would leave the element unconnected (no build) — contrary to the
    // contract; connect it, and remove it again in cleanup().
    document.body.append(opts.container);
    MOUNTED.add(opts.container);
  }
  let el: Element | null;
  if (typeof source === 'string') {
    const tpl = document.createElement('template');
    tpl.innerHTML = source;
    // Take it from the fragment, not the host — a passed `container` may already have children.
    el = tpl.content.firstElementChild;
    host.append(tpl.content);
  } else {
    host.append(source);
    el = source;
  }
  if (!el) throw new Error('mount(): source produced no element');
  // Into a caller's container: cleanup() removes the mounted element (not the container).
  if (opts?.container) MOUNTED.add(el as HTMLElement);
  return el as unknown as T;
}

/**
 * Exercise the **pre-upgrade capture** path: create the element and set
 * properties on it while it is a plain `HTMLElement` (before its class is
 * defined), then define the class so the upgrade runs. A correct BlissElement
 * captures those pre-set properties and routes them through its setters on
 * upgrade. `tag` should be unique (see {@link uniqueTag}).
 */
export function mountBeforeUpgrade<T extends Element = Element>(
  tag: string,
  ctor: CustomElementConstructor,
  configure: (el: Record<string, unknown>) => void,
  opts?: MountOptions,
): T {
  if (typeof customElements !== 'undefined' && customElements.get(tag)) {
    // Already defined: createElement would construct it right away and the pre-upgrade path
    // this helper exists to test would silently not run.
    throw new Error(`mountBeforeUpgrade: <${tag}> is already defined — use a fresh uniqueTag()`);
  }
  const host = opts?.container ?? document.createElement('div');
  if (!opts?.container) {
    document.body.append(host);
    MOUNTED.add(host);
  }
  const el = document.createElement(tag); // plain HTMLElement — not yet upgraded
  if (opts?.container) MOUNTED.add(el);
  configure(el as unknown as Record<string, unknown>);
  host.append(el);
  defineOnce(tag, ctor); // in-DOM + define → upgrade runs the constructor now
  customElements.upgrade(el); // no-op if already upgraded; explicit for clarity
  return el as unknown as T;
}

/** Remove everything {@link mount}/{@link mountBeforeUpgrade} created. Call in `afterEach`. */
export function cleanup(): void {
  for (const host of MOUNTED) host.remove();
  MOUNTED.clear();
}

/** Resolve after the next microtask — awaits BlissElement's coalesced flush. */
export function nextTick(): Promise<void> {
  return Promise.resolve();
}

/** Resolve after the next animation frame (real browsers; falls back to a macrotask). */
export function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 16);
  });
}

/**
 * Cross-component "one overlay open at a time" coordination.
 *
 * Floating overlays across every KM component (multiselect dropdown, daterangepicker
 * calendar, a future menu, …) — and any *external* popover (a Svelte component, a
 * plain-DOM widget, another framework) — cooperate so that opening one dismisses all
 * the others. There is exactly one coordination channel: a `document` CustomEvent
 * `km-overlay-activate` (namespaced like `km-log`), carrying `{ source, group }`.
 * Everyone routes through it, so **nothing has to import this module to participate**
 * — pure DOM code can both trigger and observe the same behaviour.
 *
 * ## Groups
 * Overlays coordinate only *within a group*. Register with a `group` to scope a set of
 * controls so they dismiss each other but leave other groups untouched — e.g. a toolbar
 * of pickers that shouldn't close a sidebar of pickers. Overlays registered with no
 * group share the default (ungrouped) group. Opening a group-`A` overlay dismisses only
 * other group-`A` overlays. {@link dismissAllOverlays}() (no argument) crosses every
 * group via the {@link ALL_GROUPS} wildcard.
 *
 * ## Nesting (parents)
 * Overlays form a tree: a dropdown inside a modal, a context menu inside the dropdown, a
 * submenu… Opening a child must not dismiss its ancestors. The detail carries an optional
 * `ancestors` list — the sources NOT to dismiss — and participants are skipped when their
 * source is in it. Core fills it in for you: give {@link registerOverlay} the overlay's
 * panel element (`getElement`) and {@link OverlayHandle.activate} the element that opened
 * it (`trigger`); the parent is the nearest OPEN overlay whose panel contains the trigger
 * (across shadow roots), found in a page-wide registry every copy of core shares. Closing
 * an overlay ({@link OverlayHandle.deactivate}) dismisses the overlays opened inside it,
 * deepest first. External code may pass `ancestors` itself; an activation without it
 * behaves exactly as before.
 *
 * Direction A — dismiss KM overlays from outside code:
 *   document.dispatchEvent(new CustomEvent('km-overlay-activate', { detail: { source: myId, group: 'A' } }))
 *   // or, if you import core: notifyOverlayActivated(myId, 'A')
 *
 * Direction B — have your own popover dismissed when a KM overlay opens:
 *   document.addEventListener('km-overlay-activate', (e) => {
 *     const { source, group, ancestors = [] } = e.detail;
 *     if (source !== myId && !ancestors.includes(myId) && group === myGroup) closeMyPopover();
 *   })
 *   // or, if you import core: onOverlayActivated((source, group) => { … })
 *
 * `source` is an opaque identity used only for `===` self-comparison so an opener never
 * dismisses itself. Registered participants get a private token automatically; external
 * callers pass their own (a string, an object, anything).
 *
 * SSR-safe: with no `document`, registration still works but activation is a no-op.
 */

import { composedParent } from '../dom/composed-tree.js';
import { sharedState, sharedStateKey } from '../global/shared-state.js';
import { coreLog } from '../logging/element-logger.js';

/** The single coordination event. `detail` is an {@link OverlayActivateDetail}. */
export const OVERLAY_ACTIVATE_EVENT = 'km-overlay-activate';

/**
 * Wildcard group: an activation carrying it dismisses overlays in *every* group. A
 * registry symbol (`Symbol.for`), so every bundled copy of core — and outside code —
 * holds the same value: `dismissAllOverlays()` from one component reaches all of them.
 */
export const ALL_GROUPS: unique symbol = Symbol.for('km-overlay-all-groups');

/** Detail payload of {@link OVERLAY_ACTIVATE_EVENT}. */
export interface OverlayActivateDetail {
  /** Opaque identity of the overlay that opened; peers with a different source dismiss. */
  source: unknown;
  /** Coordination group; only same-group overlays dismiss (or all when {@link ALL_GROUPS}). */
  group: unknown;
  /** Sources of the opener's ancestor overlays (parent first) — never dismissed by this activation. */
  ancestors?: readonly unknown[];
}

/** Options of {@link registerOverlay}. */
export interface RegisterOverlayOptions {
  /** The overlay's panel (or root) element — overlays opened from inside it become its children. */
  getElement?: () => Element | null | undefined;
}

/** Options of {@link OverlayHandle.activate}. */
export interface ActivateOverlayOptions {
  /** The element that opened the overlay; the nearest open overlay containing it becomes the parent. */
  trigger?: Element | null;
  /** The parent overlay's source, when known (overrides the `trigger` lookup). */
  parent?: unknown;
}

/** Handle returned by {@link registerOverlay}. */
export interface OverlayHandle {
  /**
   * This overlay opened: broadcast so every *other* overlay in its group dismisses —
   * except its ancestors (see the module notes on nesting).
   */
  activate(opts?: ActivateOverlayOptions): void;
  /** This overlay closed: the overlays opened inside it are dismissed too (deepest first). */
  deactivate(): void;
  /** Stop participating (call on disconnect/destroy). Also deactivates. */
  destroy(): void;
}

interface Participant {
  /** Private per-registration identity, used as the event `source` on activate. */
  readonly id: object;
  /** Coordination group (default `undefined` — the ungrouped group). */
  readonly group: unknown;
  /** Called when another overlay in the same group activates (or a dismiss is requested). */
  readonly dismiss: () => void;
}

/**
 * One OPEN overlay in the page-wide tree. Shared by every copy of core, so a context
 * menu from one component finds the dropdown of another as its parent.
 */
interface OpenOverlay {
  readonly getElement?: () => Element | null | undefined;
  /** Ancestor sources, parent first. */
  readonly ancestors: readonly unknown[];
  readonly dismiss: () => void;
}

const openOverlays = (): Map<unknown, OpenOverlay> =>
  sharedState(sharedStateKey('open-overlays'), () => new Map<unknown, OpenOverlay>());

const participants = new Set<Participant>();
/** Installed lazily on first registration; removed when the last participant disposes. */
let listening = false;

function hasDocument(): boolean {
  return typeof document !== 'undefined';
}

/** An activation in `eventGroup` dismisses a participant in `participantGroup` when they match. */
function groupMatches(participantGroup: unknown, eventGroup: unknown): boolean {
  return eventGroup === ALL_GROUPS || participantGroup === eventGroup;
}

/** The single document listener: dismiss same-group participants that aren't the opener or its ancestors. */
function onActivated(e: Event): void {
  const detail = (e as CustomEvent<OverlayActivateDetail>).detail;
  const source = detail?.source;
  const group = detail?.group;
  const ancestors: readonly unknown[] = Array.isArray(detail?.ancestors) ? detail.ancestors : [];
  // Snapshot: a dismiss handler may destroy (mutating the set) mid-iteration.
  for (const p of Array.from(participants)) {
    if (p.id !== source && !ancestors.includes(p.id) && groupMatches(p.group, group)) {
      p.dismiss();
      // A dismissed overlay is closed even if its dismiss handler forgot to deactivate():
      // drop it from the tree (and close what it opened) so it can't be picked as a parent.
      const open = openOverlays();
      if (open.has(p.id)) {
        open.delete(p.id);
        dismissDescendants(p.id);
      }
    }
  }
}

/** Does `container` contain `node`, crossing shadow roots (a trigger inside a component's shadow DOM)? */
function containsComposed(container: Element, node: Node): boolean {
  for (let n: Node | null = node; n; n = composedParent(n)) {
    if (n === container) return true;
  }
  return false;
}

/** The ancestor chain (parent first) of an overlay opened from `trigger`, or under `parent`. */
function resolveAncestors(self: unknown, opts: ActivateOverlayOptions | undefined): unknown[] {
  const open = openOverlays();
  let parent: unknown = opts?.parent;
  if (parent === undefined && opts?.trigger) {
    // The nearest open overlay containing the trigger = the deepest candidate (longest chain).
    let depth = -1;
    for (const [source, entry] of open) {
      if (source === self) continue;
      const el = entry.getElement?.();
      if (el && containsComposed(el, opts.trigger) && entry.ancestors.length > depth) {
        parent = source;
        depth = entry.ancestors.length;
      }
    }
  }
  if (parent === undefined) return [];
  return [parent, ...(open.get(parent)?.ancestors ?? [])];
}

/** Dismiss every open overlay whose ancestor chain contains `source`, deepest first. */
function dismissDescendants(source: unknown): void {
  const descendants = [...openOverlays()].filter(([, entry]) => entry.ancestors.includes(source));
  descendants.sort((a, b) => b[1].ancestors.length - a[1].ancestors.length);
  const open = openOverlays();
  for (const [descendant, entry] of descendants) {
    open.delete(descendant); // closed now, whether or not its handler deactivates
    try {
      entry.dismiss();
    } catch (error) {
      coreLog(null, 'UI', 'ELEMENT').error('overlay dismiss threw', error);
    }
  }
}

function ensureListening(): void {
  if (listening || !hasDocument()) return;
  document.addEventListener(OVERLAY_ACTIVATE_EVENT, onActivated);
  listening = true;
}

function stopListeningIfIdle(): void {
  if (listening && participants.size === 0 && hasDocument()) {
    document.removeEventListener(OVERLAY_ACTIVATE_EVENT, onActivated);
    listening = false;
  }
}

/** Broadcast the coordination event. No-op without a `document` (SSR). */
function broadcast(source: unknown, group: unknown, ancestors?: readonly unknown[]): void {
  if (!hasDocument()) return;
  const detail: OverlayActivateDetail = ancestors && ancestors.length > 0 ? { source, group, ancestors } : { source, group };
  document.dispatchEvent(new CustomEvent<OverlayActivateDetail>(OVERLAY_ACTIVATE_EVENT, { detail }));
}

/**
 * Register an overlay as a participant. `onDismiss` runs when another overlay in the
 * same `group` opens (or a dismiss is requested, or its parent overlay closes) — make it
 * idempotent (a closed overlay closing again should be a no-op). `group` scopes
 * coordination (default: ungrouped). Pass `getElement` so overlays opened from inside
 * this one become its children instead of dismissing it. Returns a handle to drive activation.
 */
export function registerOverlay(onDismiss: () => void, group?: unknown, opts: RegisterOverlayOptions = {}): OverlayHandle {
  const participant: Participant = { id: {}, group, dismiss: onDismiss };
  participants.add(participant);
  ensureListening();

  const deactivate = (): void => {
    const open = openOverlays();
    if (!open.has(participant.id)) return;
    open.delete(participant.id);
    dismissDescendants(participant.id); // closing a parent closes its subtree
  };

  return {
    activate(activateOpts?: ActivateOverlayOptions): void {
      const ancestors = resolveAncestors(participant.id, activateOpts);
      openOverlays().set(participant.id, { getElement: opts.getElement, ancestors, dismiss: onDismiss });
      // Route through the event so external listeners see KM activations too; the shared
      // listener dismisses every *other* same-group participant that isn't an ancestor.
      broadcast(participant.id, participant.group, ancestors);
    },
    deactivate,
    destroy(): void {
      participants.delete(participant);
      deactivate();
      stopListeningIfIdle();
    },
  };
}

/**
 * Framework-agnostic trigger for non-registered code (Svelte, plain DOM, …): announce
 * that an overlay opened so all registered/listening overlays in `group` except `source`
 * dismiss. Pass your own stable `source` to avoid dismissing yourself; pass a `group`
 * (default: ungrouped) to scope it, or {@link ALL_GROUPS} to hit every group; pass
 * `ancestors` to keep the overlays your overlay was opened from.
 */
export function notifyOverlayActivated(source?: unknown, group?: unknown, ancestors?: readonly unknown[]): void {
  broadcast(source, group, ancestors);
}

/**
 * Dismiss registered/listening overlays right now (e.g. route change, modal open). With
 * no argument (or `undefined`) it crosses every group; pass a `group` to dismiss just that group.
 */
export function dismissAllOverlays(group?: unknown): void {
  broadcast(undefined, group === undefined ? ALL_GROUPS : group);
}

/**
 * Subscribe to overlay activations (typed sugar over the DOM event). The handler gets
 * the opener's `source`, `group` and `ancestors`; compare them to your own to decide
 * whether to close. Returns an unsubscribe function. No-op without a `document`.
 */
export function onOverlayActivated(handler: (source: unknown, group: unknown, ancestors: readonly unknown[]) => void): () => void {
  if (!hasDocument()) return () => {};
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<OverlayActivateDetail>).detail;
    handler(detail?.source, detail?.group, Array.isArray(detail?.ancestors) ? detail.ancestors : []);
  };
  document.addEventListener(OVERLAY_ACTIVATE_EVENT, listener);
  return () => document.removeEventListener(OVERLAY_ACTIVATE_EVENT, listener);
}

/** Test-only: drop all participants and detach the listener. */
export function __resetOverlays(): void {
  participants.clear();
  openOverlays().clear();
  if (listening && hasDocument()) {
    document.removeEventListener(OVERLAY_ACTIVATE_EVENT, onActivated);
  }
  listening = false;
}

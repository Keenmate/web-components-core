/**
 * `startPanelSession()` (SPEC §12.19): the NON-modal sibling of `startModalSession` — a panel that sits over the
 * page while the page stays usable (a drawer showing upload progress, a side inspector). One call, one idempotent
 * `end()`:
 *
 * - Escape through the overlay tree (a dropdown opened inside closes first) and a click outside the panel
 *   dismiss it — the browser's popover "light dismiss";
 * - the phone Back gesture dismisses it (optional);
 * - `role="dialog"` when the panel has no role, never `aria-modal`;
 * - opened by a press (`isOpenedByPointer`): the tap's trailing "ghost" click is swallowed.
 *
 * No backdrop, no `inert`, no focus trap, no scroll lock — that is what `startModalSession` adds. Focus stays
 * where it is unless `initialFocus` is given. Core never closes the panel itself: `onDismiss(reason)` tells the
 * component, which closes and calls `end()`. Layout (`.km-drawer`) and stacking (`Z_INDEX`) are the component's.
 */
import { registerOverlay, type OverlayHandle } from './active-overlay.js';
import { claimBackEntry } from './back-entry.js';
import { guardGhostClick } from './ghost-click.js';

/** Why a panel asks to close: Escape, a click outside, the phone Back gesture, or the overlay tree. */
export type PanelDismissReason = 'escape' | 'outside-click' | 'back' | 'overlay' | 'parent';

export interface PanelSessionOptions {
  /** The user asked to close (see {@link PanelDismissReason}): close the panel and call `end()`. */
  onDismiss: (reason: PanelDismissReason) => void;
  /** Escape dismisses (`'escape'`). Default `true`. A function is asked at each press. */
  shouldCloseOnEscape?: boolean | (() => boolean);
  /** Runs before an Escape close; `false` keeps the panel open (it handled the key). */
  beforeEscapeCallback?(): boolean | void;
  /** A click outside the panel (and its trigger / inside elements) dismisses (`'outside-click'`). Default `true`. */
  shouldCloseOnOutsideClick?: boolean | (() => boolean);
  /** More elements a click on doesn't count as outside (the host around the trigger, a badge that toggles it). */
  getInsideElements?: () => readonly (Element | null | undefined)[];
  /** The phone Back gesture dismisses (`'back'`). Default `true`. */
  shouldCloseOnBack?: boolean;
  /** The element that opened the panel (overlay-tree parent; where Escape returns focus). */
  trigger?: Element | null;
  /** Where focus goes on an Escape close / `end({ shouldReturnFocus: true })`. Default: `trigger`; `null` = nowhere. */
  returnFocusTo?: HTMLElement | null;
  /** Move focus into the panel on start (an element, or `true` = the panel itself, made focusable). Default: stays. */
  initialFocus?: HTMLElement | boolean;
  /** Overlay-tree group (default: a panel-only group, so a page dropdown opening doesn't dismiss it). */
  group?: unknown;
  /** Opened on a PRESS: swallow that tap's trailing click on the panel. Default `false`. */
  isOpenedByPointer?: boolean;
}

export interface PanelSession {
  /** Undo everything (idempotent) — call it on EVERY close. `shouldReturnFocus` default `false` (the page kept focus). */
  end(opts?: { shouldReturnFocus?: boolean }): void;
  /** Re-arm the Back entry from inside `onDismiss('back')` (one level up; the panel stays open). */
  rearmBack(): void;
  /** `true` once {@link end} ran. */
  readonly isEnded: boolean;
}

/** Non-modal panels coordinate among themselves only: a page dropdown opening never dismisses one. */
const PANEL_GROUP = Symbol.for('km-overlay-panel');

/** Start the session for an open, mounted `panel`; returns its handle. */
export function startPanelSession(panel: HTMLElement, opts: PanelSessionOptions): PanelSession {
  let isEnded = false;
  const undo: (() => void)[] = [];

  const hadRole = panel.hasAttribute('role');
  if (!hadRole) {
    panel.setAttribute('role', 'dialog');
    undo.push(() => panel.removeAttribute('role'));
  }

  let releaseBack: (() => void) | undefined;
  const claimBack = (): void => {
    if (isEnded || !(opts.shouldCloseOnBack ?? true)) return;
    releaseBack = claimBackEntry(() => opts.onDismiss('back'));
  };
  claimBack();

  const overlay: OverlayHandle = registerOverlay(
    (reason) => {
      if (!isEnded) opts.onDismiss(reason);
    },
    opts.group ?? PANEL_GROUP,
    {
      getElement: () => panel,
      shouldCloseOnEscape: opts.shouldCloseOnEscape ?? true,
      shouldCloseOnOutsideClick: opts.shouldCloseOnOutsideClick ?? true,
      ...(opts.beforeEscapeCallback ? { beforeEscapeCallback: opts.beforeEscapeCallback } : {}),
      ...(opts.getInsideElements ? { getInsideElements: opts.getInsideElements } : {}),
    },
  );
  const returnFocusTo = opts.returnFocusTo !== undefined ? opts.returnFocusTo : opts.trigger instanceof HTMLElement ? opts.trigger : null;
  overlay.activate({ trigger: opts.trigger ?? null, returnFocusTo });

  if (opts.isOpenedByPointer) undo.push(guardGhostClick([panel]));

  if (opts.initialFocus instanceof HTMLElement) opts.initialFocus.focus({ preventScroll: true });
  else if (opts.initialFocus === true) {
    if (!panel.hasAttribute('tabindex')) {
      panel.tabIndex = -1;
      undo.push(() => panel.removeAttribute('tabindex'));
    }
    panel.focus({ preventScroll: true });
  }

  return {
    end(endOpts) {
      if (isEnded) return;
      isEnded = true;
      overlay.deactivate({ shouldReturnFocus: endOpts?.shouldReturnFocus ?? false });
      overlay.destroy();
      releaseBack?.();
      releaseBack = undefined;
      for (const fn of undo.reverse()) fn();
    },
    rearmBack: claimBack,
    get isEnded() {
      return isEnded;
    },
  };
}

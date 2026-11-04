/**
 * `createTooltip()` — the hover/focus tooltip preset (SPEC §12.2), lifting the
 * `tooltip.ts` shape shared by multiselect / daterangepicker / grid: a portaled
 * tooltip element, show/hide on pointer + keyboard focus with a delay, and
 * `autoUpdate` while visible. `shouldFollowCursor` (multiselect's
 * `option-tooltip-follow-cursor`) anchors to a `VirtualElement` tracking the
 * pointer rather than the trigger — one preset, moving reference.
 */
import { findOverlayContainer } from './overlay-container.js';
import { anchor } from './anchor.js';
import type { AnchorHandle, Placement, Strategy, VirtualElement } from './types.js';

/** Show/hide delays, in ms. A single number sets both. */
export type TooltipDelay = number | { show?: number; hide?: number };

/** Options for {@link createTooltip}. */
export interface TooltipOptions {
  /** The element the tooltip describes; hover/focus on it toggles the tooltip. */
  trigger: HTMLElement;
  /** Tooltip content — text or an element to append. */
  content: string | HTMLElement;
  /**
   * Where to mount the tooltip. Default `document.body` (portaled) — or, when the trigger
   * is inside a modal `<dialog>` / open popover (the top layer), that element. Pass the
   * component's `ShadowRoot` to keep the tooltip inside the shadow tree, so it
   * inherits shadow-scoped CSS custom properties and component tooltip styles.
   */
  container?: HTMLElement | ShadowRoot;
  /** Preferred placement. Default `'top'`. */
  placement?: Placement;
  /** Gap from the trigger, in px. Default `8`. */
  offset?: number;
  /** Show/hide delay(s), in ms. Default `0`. */
  delay?: TooltipDelay;
  /** Anchor to the pointer via a `VirtualElement` instead of the trigger. Default `false`. */
  shouldFollowCursor?: boolean;
  /** Class(es) applied to the tooltip element. */
  cssClass?: string;
  /** Class toggled on the tooltip while it is visible. Default `'is-visible'`. */
  visibleClass?: string;
  /** Positioning strategy. Default `'fixed'`. */
  strategy?: Strategy;
  /** Element to inherit `data-theme` from (C-CS-10). Default: the trigger. */
  inheritThemeFrom?: HTMLElement;
  /**
   * Called right before the tooltip becomes visible. Use it to dismiss a related
   * tooltip that would otherwise overlap (e.g. a remove-button tooltip hiding its
   * parent badge tooltip).
   */
  beforeShowCallback?(): void;
}

/** Handle returned by {@link createTooltip}. */
export interface TooltipHandle {
  /** The tooltip element (created and owned by the tooltip). */
  readonly element: HTMLElement;
  /** Whether the tooltip is currently shown. */
  readonly isVisible: boolean;
  /** Show now (ignores the show delay). */
  show(): void;
  /** Hide now (ignores the hide delay). */
  hide(): void;
  /** Remove listeners, hide, and drop the element. Idempotent. */
  destroy(): void;
}

let tooltipSeq = 0;

/** Add `id` to the element's space-separated `aria-describedby` (keeping what is there). */
function addDescribedBy(el: Element, id: string): void {
  const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  if (!ids.includes(id)) el.setAttribute('aria-describedby', [...ids, id].join(' '));
}

function removeDescribedBy(el: Element, id: string): void {
  const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((x) => x && x !== id);
  if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
  else el.removeAttribute('aria-describedby');
}

function normalizeDelay(delay: TooltipDelay | undefined): { show: number; hide: number } {
  if (typeof delay === 'number') return { show: delay, hide: delay };
  return { show: delay?.show ?? 0, hide: delay?.hide ?? 0 };
}

export function createTooltip(opts: TooltipOptions): TooltipHandle {
  // Resolved at each show: a trigger inside a modal <dialog> mounts the tooltip in the dialog.
  const container = (): HTMLElement | ShadowRoot => opts.container ?? findOverlayContainer(opts.trigger);
  const placement = opts.placement ?? 'top';
  const visibleClass = opts.visibleClass ?? 'is-visible';
  const delay = normalizeDelay(opts.delay);

  const element = document.createElement('div');
  element.setAttribute('role', 'tooltip');
  if (opts.cssClass) element.className = opts.cssClass;
  if (typeof opts.content === 'string') element.textContent = opts.content;
  else element.append(opts.content);

  let handle: AnchorHandle | undefined;
  let visible = false;
  let isDestroyed = false;
  // The tooltip describes its trigger for assistive tech while it is shown (aria-describedby).
  element.id ||= `km-tooltip-${++tooltipSeq}`;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let cursorRect: DOMRect | undefined;

  const cursorReference: VirtualElement = {
    getBoundingClientRect: () => cursorRect ?? opts.trigger.getBoundingClientRect(),
    contextElement: opts.trigger,
  };

  const onMouseMove = (event: MouseEvent): void => {
    cursorRect = new DOMRect(event.clientX, event.clientY, 0, 0);
    if (visible) handle?.update();
  };

  // Begin following the pointer the moment it ENTERS the trigger — seed the rect
  // from the enter event and attach the move listener NOW, not in show(). When a
  // show delay is set, show() runs after it; if the pointer is stationary during
  // that window (the normal "hover to read" case) no mousemove fires, so cursorRect
  // would still be undefined at show time and the VirtualElement falls back to the
  // trigger's full rect → the tooltip pins to the trigger's corner instead of the
  // cursor. Seeding here guarantees a cursor rect before the first anchor().
  const startTrackingCursor = (event: MouseEvent): void => {
    cursorRect = new DOMRect(event.clientX, event.clientY, 0, 0);
    opts.trigger.addEventListener('mousemove', onMouseMove);
  };
  const stopTrackingCursor = (): void => {
    opts.trigger.removeEventListener('mousemove', onMouseMove);
  };

  const clearTimers = (): void => {
    if (showTimer) clearTimeout(showTimer);
    if (hideTimer) clearTimeout(hideTimer);
    showTimer = hideTimer = undefined;
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') hide(); // dismissible without moving the pointer or focus (WCAG 1.4.13)
  };

  const show = (): void => {
    clearTimers();
    if (visible || isDestroyed) return;
    opts.beforeShowCallback?.();
    visible = true;
    container().append(element);
    const reference = opts.shouldFollowCursor ? cursorReference : opts.trigger;
    handle = anchor(element, reference, {
      placement,
      strategy: opts.strategy,
      offset: opts.offset ?? 8,
      inheritThemeFrom: opts.inheritThemeFrom ?? opts.trigger,
      // A trigger removed from the page while its tooltip shows (a re-rendered row) takes the
      // tooltip with it, instead of leaving it mounted with positioning running.
      beforeComputeCallback: () => {
        if (!opts.trigger.isConnected) hide();
      },
    });
    addDescribedBy(opts.trigger, element.id);
    document.addEventListener('keydown', onKeydown, true);
    // Ensure cursor tracking is live. For a pointer show it was already attached on
    // mouseenter (so cursorRect was seeded through the show delay); for an imperative
    // show() / focus show it's attached here. addEventListener is idempotent on the
    // same function ref, so the double-attach from mouseenter is a no-op.
    if (opts.shouldFollowCursor) opts.trigger.addEventListener('mousemove', onMouseMove);
    element.classList.add(visibleClass);
  };

  const hide = (): void => {
    clearTimers();
    // Always detach cursor tracking — the listener may have been attached on
    // mouseenter while the show delay was still pending (never became visible).
    stopTrackingCursor();
    // A later focus / show() places the tooltip at the trigger, not where the pointer last was.
    cursorRect = undefined;
    if (!visible) return;
    visible = false;
    element.classList.remove(visibleClass);
    handle?.destroy();
    handle = undefined;
    element.remove();
    removeDescribedBy(opts.trigger, element.id);
    document.removeEventListener('keydown', onKeydown, true);
  };

  const scheduleShow = (): void => {
    clearTimers();
    if (delay.show > 0) showTimer = setTimeout(show, delay.show);
    else show();
  };
  const scheduleHide = (): void => {
    clearTimers();
    if (delay.hide > 0) hideTimer = setTimeout(hide, delay.hide);
    else hide();
  };

  const onMouseEnter = (event: MouseEvent): void => {
    if (opts.shouldFollowCursor) startTrackingCursor(event);
    scheduleShow();
  };
  // The pointer leaving doesn't hide a tooltip whose trigger still has keyboard focus, and
  // the pointer may move onto the tooltip itself (hoverable content, WCAG 1.4.13).
  const onMouseLeave = (): void => {
    if (opts.trigger.matches(':focus-within')) return;
    scheduleHide();
  };
  // Focus moving between two controls inside the trigger keeps the tooltip where it is.
  const onFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget;
    if (next instanceof Node && opts.trigger.contains(next)) return;
    scheduleHide();
  };

  opts.trigger.addEventListener('mouseenter', onMouseEnter);
  opts.trigger.addEventListener('mouseleave', onMouseLeave);
  opts.trigger.addEventListener('focusin', scheduleShow);
  opts.trigger.addEventListener('focusout', onFocusOut);
  element.addEventListener('mouseenter', clearTimers);
  element.addEventListener('mouseleave', onMouseLeave);

  return {
    element,
    get isVisible() {
      return visible;
    },
    show,
    hide,
    destroy() {
      isDestroyed = true;
      opts.trigger.removeEventListener('mouseenter', onMouseEnter);
      opts.trigger.removeEventListener('mouseleave', onMouseLeave);
      opts.trigger.removeEventListener('focusin', scheduleShow);
      opts.trigger.removeEventListener('focusout', onFocusOut);
      element.removeEventListener('mouseenter', clearTimers);
      element.removeEventListener('mouseleave', onMouseLeave);
      hide();
    },
  };
}

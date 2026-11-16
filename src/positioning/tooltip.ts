/**
 * `createTooltip()` — the hover/focus tooltip preset (SPEC §12.2), lifting the
 * `tooltip.ts` shape shared by multiselect / daterangepicker / grid: a portaled
 * tooltip element, show/hide on pointer + keyboard focus with a delay, and
 * `autoUpdate` while visible. `shouldFollowCursor` (multiselect's
 * `option-tooltip-follow-cursor`) anchors to a `VirtualElement` tracking the
 * pointer rather than the trigger — one preset, moving reference.
 *
 * Delegated mode (`selector`): ONE tooltip for many targets inside `trigger` (calendar days, grid
 * cells, tree nodes) — one set of listeners on the root, the target found with `closest(selector)`,
 * the content resolved per target when it shows. Moving from one target to the next while a
 * tooltip shows switches at once (no second show delay).
 */
import { findOverlayContainer } from './overlay-container.js';
import { anchor } from './anchor.js';
import { coreLog } from '../logging/element-logger.js';
import type { AnchorHandle, Placement, Strategy, VirtualElement } from './types.js';

/** Show/hide delays, in ms. A single number sets both. */
export type TooltipDelay = number | { show?: number; hide?: number };

/** What a content resolver may return: text, an element, or nothing (= no tooltip for this target). */
export type TooltipContent = string | HTMLElement | null | undefined;

/** Options for {@link createTooltip}. */
export interface TooltipOptions {
  /**
   * The element the tooltip describes; hover/focus on it toggles the tooltip. With
   * {@link selector}: the ROOT the targets live in (a component's shadow root works).
   */
  trigger: HTMLElement | ShadowRoot;
  /**
   * Delegated mode: the targets inside `trigger` that get a tooltip (`'.drp__day[data-tooltip]'`).
   * One tooltip element serves all of them; `content` is usually a function of the target.
   */
  selector?: string;
  /**
   * Tooltip content — text (set as text, never parsed as HTML), an element to append, or a function
   * called at every show with the target (the trigger, or the matched element in delegated mode).
   * A function returning `null` / `undefined` / `''` shows nothing for that target.
   */
  content: string | HTMLElement | ((target: HTMLElement) => TooltipContent);
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
  /**
   * Touch: a tap on a target toggles its tooltip (a tap elsewhere closes it), and the emulated
   * hover / focus a tap produces is ignored. For targets that do nothing else on a tap (a calendar
   * badge, a status icon). Default `false` (a tap shows it through the emulated hover).
   */
  shouldToggleOnTap?: boolean;
  /** Class(es) applied to the tooltip element. */
  cssClass?: string;
  /** Class toggled on the tooltip while it is visible. Default `'is-visible'`. */
  visibleClass?: string;
  /** An arrow element (kept as the tooltip's last child, positioned by `anchor()`'s `arrow`). */
  arrow?: HTMLElement;
  /** Positioning strategy. Default `'fixed'`. */
  strategy?: Strategy;
  /**
   * Resolve the fixed containing block from the tooltip (see `anchor()`); for a target that is itself
   * a containing block (a cell with `transform` on hover). Default `false`.
   */
  shouldUseFixedContainingBlock?: boolean;
  /** Element to inherit `data-theme` from (C-CS-10). Default: the target. */
  inheritThemeFrom?: HTMLElement;
  /**
   * Called right before the tooltip becomes visible, with the target. Return `false` to not show
   * it. Also the place to dismiss a related tooltip that would otherwise overlap (e.g. a
   * remove-button tooltip hiding its parent badge tooltip).
   */
  beforeShowCallback?(target: HTMLElement): boolean | void;
}

/** Handle returned by {@link createTooltip}. */
export interface TooltipHandle {
  /** The tooltip element (created and owned by the tooltip). */
  readonly element: HTMLElement;
  /** Whether the tooltip is currently shown. */
  readonly isVisible: boolean;
  /** The target the tooltip shows for (`null` while hidden). */
  readonly target: HTMLElement | null;
  /** Show now (ignores the show delay) — for `target` (delegated mode), else the trigger. */
  show(target?: HTMLElement): void;
  /** Hide now (ignores the hide delay). */
  hide(): void;
  /** Re-resolve the content for the current target (its data changed while shown). */
  refresh(): void;
  /** Remove listeners, hide, and drop the element. Idempotent. */
  destroy(): void;
}

let tooltipSeq = 0;

/** How long after a touch the browser's emulated mouse / focus events are ignored (toggle-on-tap). */
const TOUCH_GHOST_MS = 800;

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
  const root = opts.trigger;
  const isDelegated = !!opts.selector;
  /** The host element of the root: the trigger itself, or the shadow root's host. */
  const rootElement: HTMLElement = root instanceof HTMLElement ? root : (root.host as HTMLElement);
  if (!isDelegated && !(root instanceof HTMLElement)) {
    coreLog(rootElement, 'UI', 'ELEMENT').warn('createTooltip: a ShadowRoot trigger needs a `selector` (delegated mode)');
  }
  const placement = opts.placement ?? 'top';
  const visibleClass = opts.visibleClass ?? 'is-visible';
  const delay = normalizeDelay(opts.delay);

  const element = document.createElement('div');
  element.setAttribute('role', 'tooltip');
  if (opts.cssClass) element.className = opts.cssClass;
  // The tooltip describes its target for assistive tech while it is shown (aria-describedby).
  element.id ||= `km-tooltip-${++tooltipSeq}`;
  if (typeof opts.content !== 'function') setContent(opts.content);

  function setContent(content: TooltipContent): void {
    element.replaceChildren();
    if (typeof content === 'string') element.textContent = content;
    else if (content) element.append(content);
    if (opts.arrow) element.append(opts.arrow);
  }

  /** The target an event node belongs to: the trigger, or the closest selector match inside the root. */
  const findTarget = (node: EventTarget | null): HTMLElement | null => {
    if (!(node instanceof Node)) return null;
    if (!isDelegated) return root.contains(node) ? rootElement : null;
    const el = node instanceof Element ? node : node.parentElement;
    const match = el?.closest(opts.selector!);
    return match instanceof HTMLElement && root.contains(match) ? match : null;
  };

  let handle: AnchorHandle | undefined;
  let visible = false;
  let isDestroyed = false;
  /** The target shown (or about to be shown, while the show delay runs). */
  let current: HTMLElement | null = null;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let lastTouchAt = -Infinity;
  const isTouchGhost = (): boolean => !!opts.shouldToggleOnTap && Date.now() - lastTouchAt < TOUCH_GHOST_MS;

  // The pointer as an offset from the target's top-left corner, not a viewport point: a scroll
  // moves the target without a mousemove (a tapped card on a phone keeps focus, so nothing hides
  // the tooltip), and a viewport point would leave the tooltip behind on screen.
  let cursorOffset: { x: number; y: number } | undefined;
  const setCursor = (event: MouseEvent, target: HTMLElement): void => {
    const rect = target.getBoundingClientRect();
    cursorOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const cursorReference: VirtualElement = {
    getBoundingClientRect: () => {
      const rect = (current ?? rootElement).getBoundingClientRect();
      return cursorOffset ? new DOMRect(rect.left + cursorOffset.x, rect.top + cursorOffset.y, 0, 0) : rect;
    },
    get contextElement() {
      return current ?? rootElement;
    },
  };

  const onMouseMove = (event: Event): void => {
    if (!current) return;
    setCursor(event as MouseEvent, current);
    if (visible) handle?.update();
  };

  // Begin following the pointer the moment it ENTERS the target — seed the rect from the enter
  // event and attach the move listener NOW, not in show(). When a show delay is set, show() runs
  // after it; if the pointer is stationary during that window (the normal "hover to read" case)
  // no mousemove fires, so the cursor would still be undefined at show time and the
  // VirtualElement falls back to the target's full rect → the tooltip pins to the target's
  // corner instead of the cursor. Seeding here guarantees a cursor rect before the first anchor().
  const startTrackingCursor = (event: MouseEvent, target: HTMLElement): void => {
    setCursor(event, target);
    root.addEventListener('mousemove', onMouseMove);
  };
  const stopTrackingCursor = (): void => {
    root.removeEventListener('mousemove', onMouseMove);
  };

  const clearTimers = (): void => {
    if (showTimer) clearTimeout(showTimer);
    if (hideTimer) clearTimeout(hideTimer);
    showTimer = hideTimer = undefined;
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') hide(); // dismissible without moving the pointer or focus (WCAG 1.4.13)
  };

  // Toggle-on-tap: a tap outside the root and the tooltip closes it.
  const onDocumentPointerDown = (event: PointerEvent): void => {
    const path = event.composedPath();
    if (path.includes(element) || path.includes(rootElement)) return;
    hide();
  };

  /** Detach the tooltip from its current target (keeps it mounted when switching targets). */
  const detach = (): void => {
    handle?.destroy();
    handle = undefined;
    if (current) removeDescribedBy(current, element.id);
  };

  const show = (target: HTMLElement | null = current ?? (isDelegated ? null : rootElement)): void => {
    clearTimers();
    if (isDestroyed || !target) return;
    if (visible && target === current) return;
    if (typeof opts.content === 'function') {
      const content = opts.content(target);
      if (content == null || content === '') {
        hide();
        return;
      }
      setContent(content);
    }
    if (opts.beforeShowCallback?.(target) === false) {
      hide();
      return;
    }
    if (visible) detach();
    current = target;
    if (!visible) {
      visible = true;
      // Resolved at each show: a target inside a modal <dialog> mounts the tooltip in the dialog.
      (opts.container ?? findOverlayContainer(target)).append(element);
      document.addEventListener('keydown', onKeydown, true);
      if (opts.shouldToggleOnTap) document.addEventListener('pointerdown', onDocumentPointerDown, true);
    }
    const reference = opts.shouldFollowCursor ? cursorReference : target;
    handle = anchor(element, reference, {
      placement,
      strategy: opts.strategy,
      offset: opts.offset ?? 8,
      inheritThemeFrom: opts.inheritThemeFrom ?? target,
      ...(opts.arrow ? { arrow: { element: opts.arrow } } : {}),
      ...(opts.shouldUseFixedContainingBlock ? { shouldUseFixedContainingBlock: true } : {}),
      // A target removed from the page while its tooltip shows (a re-rendered row) takes the
      // tooltip with it, instead of leaving it mounted with positioning running.
      beforeComputeCallback: () => {
        if (!target.isConnected) hide();
      },
    });
    addDescribedBy(target, element.id);
    // Ensure cursor tracking is live. For a pointer show it was already attached on enter (so the
    // cursor was seeded through the show delay); for an imperative show() / focus show it's
    // attached here. addEventListener is idempotent on the same function ref.
    if (opts.shouldFollowCursor) root.addEventListener('mousemove', onMouseMove);
    element.classList.add(visibleClass);
  };

  const hide = (): void => {
    clearTimers();
    // Always detach cursor tracking — the listener may have been attached on enter while the
    // show delay was still pending (never became visible).
    stopTrackingCursor();
    // A later focus / show() places the tooltip at the target, not where the pointer last was.
    cursorOffset = undefined;
    if (!visible) {
      current = null;
      return;
    }
    visible = false;
    element.classList.remove(visibleClass);
    detach();
    current = null;
    element.remove();
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  };

  const scheduleShow = (target: HTMLElement): void => {
    clearTimers();
    // Moving between targets while one shows: switch at once.
    if (delay.show > 0 && !visible) {
      current = target;
      showTimer = setTimeout(() => show(target), delay.show);
    } else show(target);
  };
  const scheduleHide = (): void => {
    clearTimers();
    if (delay.hide > 0) hideTimer = setTimeout(hide, delay.hide);
    else hide();
  };

  /** The pointer leaving doesn't hide a tooltip whose target still has keyboard focus. */
  const hasFocusWithin = (): boolean => !!current?.matches(':focus-within');

  // --- single trigger: enter / leave on the trigger -------------------------------------------
  const onMouseEnter = (event: MouseEvent): void => {
    if (isTouchGhost()) return;
    if (opts.shouldFollowCursor) startTrackingCursor(event, rootElement);
    scheduleShow(rootElement);
  };
  // The pointer may move onto the tooltip itself (hoverable content, WCAG 1.4.13).
  const onMouseLeave = (): void => {
    if (hasFocusWithin() || (!isDelegated && rootElement.matches(':focus-within'))) return;
    scheduleHide();
  };

  // --- delegated: over / out on the root ------------------------------------------------------
  const onMouseOver = (event: Event): void => {
    if (isTouchGhost()) return;
    const target = findTarget(event.target);
    if (target && target === current) {
      if (visible) clearTimers(); // back from the tooltip onto its own target: keep it
      if (visible || showTimer) return;
    }
    if (!target) {
      if (current && !hasFocusWithin()) scheduleHide();
      return;
    }
    if (opts.shouldFollowCursor) startTrackingCursor(event as MouseEvent, target);
    scheduleShow(target);
  };
  const onMouseOut = (event: Event): void => {
    const next = (event as MouseEvent).relatedTarget;
    if (next instanceof Node && (root.contains(next) || element.contains(next))) return; // mouseover handles it
    if (!hasFocusWithin()) scheduleHide();
  };

  // --- both: focus, tap ------------------------------------------------------------------------
  const onFocusIn = (event: Event): void => {
    if (isTouchGhost()) return;
    const target = findTarget(event.target);
    if (target) scheduleShow(target);
  };
  // Focus moving between two controls inside the target keeps the tooltip where it is.
  const onFocusOut = (event: Event): void => {
    const next = (event as FocusEvent).relatedTarget;
    if (next instanceof Node && current?.contains(next)) return;
    scheduleHide();
  };
  const onPointerDown = (event: Event): void => {
    if ((event as PointerEvent).pointerType !== 'mouse') lastTouchAt = Date.now();
  };
  const onClick = (event: Event): void => {
    if (!isTouchGhost()) return;
    const target = findTarget(event.target);
    if (target && !(visible && target === current)) show(target);
    else hide();
  };

  type Listener = [EventTarget, string, (event: Event) => void];
  const listeners: Listener[] = isDelegated
    ? [[root, 'mouseover', onMouseOver], [root, 'mouseout', onMouseOut]]
    : [[root, 'mouseenter', onMouseEnter as (event: Event) => void], [root, 'mouseleave', onMouseLeave]];
  listeners.push([root, 'focusin', onFocusIn], [root, 'focusout', onFocusOut]);
  if (opts.shouldToggleOnTap) listeners.push([root, 'pointerdown', onPointerDown], [root, 'click', onClick]);
  listeners.push([element, 'mouseenter', clearTimers], [element, 'mouseleave', onMouseLeave]);
  for (const [target, type, fn] of listeners) target.addEventListener(type, fn);

  return {
    element,
    get isVisible() {
      return visible;
    },
    get target() {
      return visible ? current : null;
    },
    show(target?: HTMLElement) {
      show(target ?? (isDelegated ? current : rootElement));
    },
    hide,
    refresh() {
      if (!visible || !current || typeof opts.content !== 'function') return;
      const target = current;
      const content = opts.content(target);
      if (content == null || content === '') hide();
      else {
        setContent(content);
        handle?.update();
      }
    },
    destroy() {
      if (isDestroyed) return;
      hide();
      isDestroyed = true;
      for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
    },
  };
}

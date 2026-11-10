/**
 * `anchor()` — the low-level positioning primitive (SPEC §12.2). Places a
 * floating element against a reference and (by default) keeps it placed via
 * floating-ui `autoUpdate`, unifying the ~15 hand-rolled call sites across the
 * five components: `'fixed'` strategy by default, the recurring
 * `offset → (size) → flip → shift` middleware stack, width-matching via `size()`
 * (replacing three different hacks), and `data-theme` inheritance for portaled
 * layers (C-CS-10). The two presets ({@link createTooltip}, {@link createPopover})
 * are thin wrappers over this.
 */
import {
  arrow as arrowMiddleware,
  autoUpdate,
  computePosition,
  flip as flipMiddleware,
  offset as offsetMiddleware,
  platform as floatingUiPlatform,
  shift as shiftMiddleware,
  size as sizeMiddleware,
  type Middleware,
  type Platform,
} from '@floating-ui/dom';
import { readDropdownOffset } from './dropdown-offset.js';
import { composedClosest, isAtOrBelow } from '../dom/composed-tree.js';
import { coreLog } from '../logging/element-logger.js';
import { callSafely } from '../logging/safe-call.js';
import { detectFixedDrift, getFixedPositionOffsetParent } from './containing-block.js';
import type { AnchorHandle, AnchorOptions, Placement } from './types.js';

type Reference = Parameters<typeof computePosition>[0];

/**
 * The attributes a portaled layer inherits from the nearest element carrying each (self or
 * ancestor, across shadow roots): the page's theme (pure-css / Keenmate's `data-theme`,
 * Bootstrap's `data-bs-theme`), and what core itself mirrors onto a component host — the
 * EFFECTIVE scheme `data-context-theme` (a Tailwind `.dark` class, `setThemeMode()`,
 * `theme-source`; SPEC §12.10) and the motion level `data-motion` (SPEC §12.16). A panel moved
 * to `<body>` would otherwise lose both.
 */
const THEME_ATTRIBUTES = ['data-theme', 'data-bs-theme', 'data-context-theme', 'data-motion'] as const;

/** The per-instance switches: read only up to the component host once core has resolved it. */
const INSTANCE_THEME_ATTRIBUTES: ReadonlySet<string> = new Set(['data-theme', 'data-bs-theme']);

/**
 * Copy the nearest theme attributes from `source` onto `target` (self or ancestor, across
 * shadow roots). Returns a restore: the panel element is often reused across opens, so its
 * own attributes come back when the anchor is destroyed (a theme removed meanwhile must
 * not stick to it).
 *
 * Above the nearest host carrying `data-context-theme`, a `data-theme` / `data-bs-theme` is
 * NOT copied: core already folded the page / section signal into that host's context, and the
 * panel's per-instance rules win over its context rules — a section's `data-theme="dark"` would
 * turn the panel dark next to a light component. Without such a host the nearest one is copied.
 */
function inheritTheme(source: HTMLElement, target: HTMLElement): () => void {
  const restores: (() => void)[] = [];
  const contextHost = composedClosest(source, '[data-context-theme]');
  for (const name of THEME_ATTRIBUTES) {
    let themed = composedClosest(source, `[${name}]`);
    if (themed && contextHost && INSTANCE_THEME_ATTRIBUTES.has(name) && !isAtOrBelow(themed, contextHost)) {
      themed = null;
    }
    const theme = themed?.getAttribute(name);
    if (theme == null) continue;
    const previous = target.getAttribute(name);
    target.setAttribute(name, theme);
    restores.push(() => (previous === null ? target.removeAttribute(name) : target.setAttribute(name, previous)));
  }
  return () => {
    for (const restore of restores) restore();
  };
}

const OPPOSITE_SIDE = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' } as const;

/** Position an arrow element on the side facing the reference (centered via its own size). */
function positionArrow(el: HTMLElement, placement: Placement, data: { x?: number; y?: number } | undefined): void {
  if (!data) return;
  const side = placement.split('-')[0] as keyof typeof OPPOSITE_SIDE;
  const staticSide = OPPOSITE_SIDE[side];
  el.style.left = data.x != null ? `${data.x}px` : '';
  el.style.top = data.y != null ? `${data.y}px` : '';
  el.style.right = '';
  el.style.bottom = '';
  // Half the arrow sticks out past the panel edge: its height on a top / bottom edge, its width on a side.
  const size = staticSide === 'top' || staticSide === 'bottom' ? el.offsetHeight : el.offsetWidth;
  el.style[staticSide] = `-${size / 2}px`;
}

/** The inline size properties the `size()` steps write (matchWidth, maxHeight, maxWidth). */
type SizeProperty = 'width' | 'minWidth' | 'maxWidth' | 'maxHeight';

/**
 * Writes the size properties and remembers each one's inline value from before the first
 * write, so `destroy()` can put back exactly what the anchor changed (a reused panel must not
 * keep a stale `max-height` or a width from a reference it no longer follows).
 */
function createSizeWriter(floating: HTMLElement): { set(prop: SizeProperty, value: string): void; restore(): void } {
  const original = new Map<SizeProperty, string>();
  return {
    set(prop, value) {
      if (!original.has(prop)) original.set(prop, floating.style[prop]);
      floating.style[prop] = value;
    },
    restore() {
      for (const [prop, value] of original) floating.style[prop] = value;
      original.clear();
    },
  };
}

/**
 * Build the middleware stack in the canonical order: offset → size → flip → shift.
 * `flipEnabled` lets the caller drop `flip` after freezing (`lockPlacement: 'freeze'`).
 */
function buildMiddleware(
  opts: AnchorOptions,
  flipEnabled: boolean,
  sizes: ReturnType<typeof createSizeWriter>,
  defaultOffset: number,
): Middleware[] {
  const middleware: Middleware[] = [offsetMiddleware(opts.offset ?? defaultOffset)];

  if (opts.matchWidth) {
    const mode = opts.matchWidth;
    middleware.push(
      sizeMiddleware({
        apply({ rects }) {
          const width = `${rects.reference.width}px`;
          // 'exact' pins the width; 'min' floors it (grow for wider content);
          // 'max' caps it (shrink for narrower content).
          sizes.set(mode === 'exact' ? 'width' : mode === 'max' ? 'maxWidth' : 'minWidth', width);
        },
      }),
    );
  }

  if (flipEnabled) {
    // lockPlacement:'initial' — prefer returning to the initial placement over reordering.
    // ('freeze' flips normally on the first frame, then this rebuilds without flip.)
    middleware.push(
      flipMiddleware({
        ...(opts.lockPlacement === 'initial' ? { fallbackStrategy: 'initialPlacement' } : {}),
        ...(opts.flipPadding != null ? { padding: opts.flipPadding } : {}),
        ...(opts.fallbackPlacements ? { fallbackPlacements: opts.fallbackPlacements } : {}),
      }),
    );
  }

  const shift = opts.shift ?? 8;
  if (shift !== false) middleware.push(shiftMiddleware({ padding: shift }));

  // Height-cap (calendar / dropdown): scroll internally instead of overflowing.
  if (opts.maxHeight) {
    const padding = typeof opts.maxHeight === 'object' ? opts.maxHeight.padding : undefined;
    middleware.push(
      sizeMiddleware({
        padding,
        apply({ availableHeight }) {
          sizes.set('maxHeight', `${Math.max(0, availableHeight)}px`);
        },
      }),
    );
  }

  // Width-cap (user-resizable panel): stop the floating element overflowing the
  // viewport horizontally. Mirrors maxHeight; only sets max-width.
  if (opts.maxWidth) {
    const padding = typeof opts.maxWidth === 'object' ? opts.maxWidth.padding : undefined;
    middleware.push(
      sizeMiddleware({
        padding,
        apply({ availableWidth }) {
          sizes.set('maxWidth', `${Math.max(0, availableWidth)}px`);
        },
      }),
    );
  }

  // Arrow last (floating-ui requirement): it reads the final resolved coordinates.
  if (opts.arrow) middleware.push(arrowMiddleware({ element: opts.arrow.element, padding: opts.arrow.padding }));

  return middleware;
}

/**
 * Position `floating` against `reference` and keep it there. Returns a handle:
 * `update()` recomputes once, `destroy()` stops `autoUpdate`. The `floating`
 * element must already be in the document (so it can be measured); the presets
 * handle mounting.
 */
export function anchor(
  floating: HTMLElement,
  reference: Reference,
  opts: AnchorOptions = {},
): AnchorHandle {
  const strategy = opts.strategy ?? 'fixed';

  const restoreTheme = opts.inheritThemeFrom ? inheritTheme(opts.inheritThemeFrom, floating) : undefined;

  floating.style.position = strategy;
  floating.style.left = '0';
  floating.style.top = '0';

  // `placement`/`middleware` are mutable so `lockPlacement: 'freeze'` can pin the
  // first resolved placement and drop `flip` for every subsequent frame.
  let placement = opts.placement ?? 'bottom-start';
  let flipEnabled = opts.shouldFlip ?? true;
  const sizes = createSizeWriter(floating);
  // No `offset` given: the page's field → panel gap (`--base-dropdown-offset`), read once where it opens.
  const defaultOffset = opts.offset === undefined ? readDropdownOffset(reference instanceof Element ? reference : (reference as { contextElement?: Element }).contextElement ?? floating) : 0;
  let middleware = buildMiddleware(opts, flipEnabled, sizes, defaultOffset);
  const freeze = opts.lockPlacement === 'freeze';
  let frozen = false;

  // `shouldUseFixedContainingBlock` sugar: narrow floating-ui's offset-parent search to the
  // CB properties browsers reliably honour for `position: fixed`, resolved from the
  // FLOATING element (not the reference — see the option doc). An explicit `platform`
  // wins over the sugar.
  const useFixedCB = !!opts.shouldUseFixedContainingBlock && !opts.platform;
  const effectivePlatform: Platform | undefined =
    opts.platform ??
    (useFixedCB
      ? { ...floatingUiPlatform, getOffsetParent: () => getFixedPositionOffsetParent(floating) }
      : undefined);

  // `computePosition` resolves async — a result landing after destroy() must not
  // move the panel or fire callbacks (it may already be reused for another anchor).
  let isDestroyed = false;
  const run = (): void => {
    if (isDestroyed) return;
    if (opts.beforeComputeCallback) callSafely(opts.beforeComputeCallback, { source: floating, message: 'anchor beforeComputeCallback threw' });
    void computePosition(reference, floating, {
      placement,
      strategy,
      middleware,
      ...(effectivePlatform ? { platform: effectivePlatform } : {}),
    }).then(({ x, y, placement: resolved, middlewareData }) => {
      if (isDestroyed) return;
      floating.style.left = `${x}px`;
      floating.style.top = `${y}px`;
      if (opts.arrow) positionArrow(opts.arrow.element, resolved, middlewareData.arrow);
      if (freeze && !frozen) {
        // Pin the placement floating-ui just chose; stop flipping from now on.
        frozen = true;
        placement = resolved;
        flipEnabled = false;
        middleware = buildMiddleware(opts, false, sizes, defaultOffset);
      }
      // Each callback is isolated: one that throws is logged and the others still run.
      const { onPlaced, onComputed, onDrift } = opts;
      if (onPlaced) callSafely(() => onPlaced(resolved), { source: floating, message: 'anchor onPlaced threw' });
      if (onComputed) callSafely(() => onComputed({ x, y, placement: resolved }), { source: floating, message: 'anchor onComputed threw' });
      // Drift is a `position: fixed` diagnosis — an absolute panel is MEANT to sit in its offset parent.
      if (onDrift && reference instanceof Element && strategy === 'fixed') {
        // Measure against the frame x / y were computed in: the effective platform's offset
        // parent (the fixed-CB parent with the sugar, a custom platform's answer, else
        // floating-ui's own, which already accounts for a transformed ancestor — measuring
        // against the viewport there reported a panel that sat on target, review D-29).
        // Only reports when actually drifted.
        const report = (offsetParent: unknown): void => {
          if (isDestroyed) return;
          const frame = offsetParent instanceof Element ? offsetParent : window;
          const drift = detectFixedDrift({ panel: floating, reference, expectedX: x, expectedY: y, offsetParent: frame });
          if (drift) callSafely(() => onDrift(drift), { source: floating, message: 'anchor onDrift threw' });
        };
        const frameSource = effectivePlatform ?? floatingUiPlatform;
        const offsetParent: unknown = frameSource.getOffsetParent ? frameSource.getOffsetParent(floating) : window;
        if (offsetParent instanceof Promise) void offsetParent.then(report, () => report(window));
        else report(offsetParent);
      }
    }).catch((error: unknown) => {
      // computePosition itself rejected (a detached reference, a throwing platform hook):
      // log it instead of leaving an unhandled rejection that bypasses the core logger.
      coreLog(floating, 'UI', 'ELEMENT').error('anchor: computing the position failed', error);
    });
  };

  let cleanup: (() => void) | undefined;
  if (opts.shouldAutoUpdate ?? true) cleanup = autoUpdate(reference, floating, run, opts.autoUpdateOptions);
  else run();

  return {
    update: run,
    destroy() {
      if (isDestroyed) return;
      isDestroyed = true;
      cleanup?.();
      cleanup = undefined;
      restoreTheme?.();
      sizes.restore();
    },
  };
}

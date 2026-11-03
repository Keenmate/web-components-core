/**
 * Motion level (SPEC §12.16): `auto | none | snappy | smooth` for every BlissElement, page-wide via
 * `window.components.motion`, and as a `data-motion` attribute on any element (a section, `<html>`).
 *
 * Components already read their speeds from the shared contract tokens
 * (`--<prefix>-transition-normal: var(--base-duration-normal, 0.15s)`, `--<prefix>-scroll-behavior:
 * var(--base-scroll-behavior, smooth)`), so a preset only has to set those tokens — on the element
 * or an ancestor — and every component follows without its own code.
 *
 * `MOTION_CSS` is adopted into each root a component lives in (the document, or the shadow root of
 * the component that renders it), so `[data-motion]` matches the host itself and works with or
 * without base-css-variables. The OS `prefers-reduced-motion: reduce` always wins: it comes last
 * and zeroes the durations on `:root` and on every `[data-motion]` element.
 *
 * Preset values match base-css-variables' `[data-motion]` presets (the reference); a test keeps
 * them in sync.
 */

import { adoptStyles } from '../dom/adopt-styles.js';
import { notifyEach } from '../logging/safe-call.js';

/** Motion levels. `auto` = no override: follow the page / section / OS. */
export const MOTION_VALUES = ['auto', 'none', 'snappy', 'smooth'] as const;
export type Motion = (typeof MOTION_VALUES)[number];

/** The attribute on a BlissElement (input) and the attribute core writes the resolved level to. */
export const MOTION_ATTRIBUTE = 'motion';
export const MOTION_DATA_ATTRIBUTE = 'data-motion';

/** The four contract speeds per preset (`--base-duration-fast / -normal / -medium / -slow`).
 *  Every preset also sets `--base-scroll-behavior` (`none` → `auto`, the others → `smooth`), so a
 *  level nested inside another follows the nearest one for scrolling too. */
export const MOTION_PRESETS: Readonly<Record<Exclude<Motion, 'auto'>, readonly [string, string, string, string]>> = {
  none: ['0s', '0s', '0s', '0s'],
  snappy: ['0.05s', '0.08s', '0.12s', '0.15s'],
  smooth: ['0.15s', '0.25s', '0.35s', '0.45s'],
};

const durations = ([fast, normal, medium, slow]: readonly string[]): string =>
  `--base-duration-fast: ${fast}; --base-duration-normal: ${normal}; --base-duration-medium: ${medium}; --base-duration-slow: ${slow};`;

export const MOTION_CSS = `
[data-motion="none"] { ${durations(MOTION_PRESETS.none)} --base-scroll-behavior: auto; }
[data-motion="snappy"] { ${durations(MOTION_PRESETS.snappy)} --base-scroll-behavior: smooth; }
[data-motion="smooth"] { ${durations(MOTION_PRESETS.smooth)} --base-scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) {
  :root, :host, [data-motion] { ${durations(MOTION_PRESETS.none)} --base-scroll-behavior: auto; }
}
`;

export function isMotion(value: unknown): value is Motion {
  return typeof value === 'string' && (MOTION_VALUES as readonly string[]).includes(value);
}

/** Adopt the presets into the root `node` lives in (document or a shadow root). Idempotent, SSR-safe. */
export function adoptMotionStyles(node: Node): void {
  const root = node.getRootNode?.();
  // A document (9) or a shadow root (11) — adoptStyles falls back to <style> without adoptedStyleSheets.
  if (root && (root.nodeType === 9 || root.nodeType === 11)) adoptStyles(root as unknown as DocumentOrShadowRoot, MOTION_CSS);
}

// ---------------------------------------------------------------------------
// Page-wide level — window.components.motion
// ---------------------------------------------------------------------------

interface MotionState {
  level: Motion;
  listeners: Set<(level: Motion) => void>;
}

/** On globalThis because each component bundles its own core copy (like logging / the loader hook). */
const STATE_KEY = Symbol.for('@keenmate/web-components-core:motion');
const HOOK_KEY = 'motion';

function state(): MotionState {
  const g = globalThis as unknown as Record<symbol, MotionState | undefined>;
  return (g[STATE_KEY] ??= { level: 'auto', listeners: new Set() });
}

function setLevel(value: unknown): void {
  const s = state();
  const next: Motion = isMotion(value) ? value : 'auto';
  if (next === s.level) return;
  s.level = next;
  // A throwing listener is logged and skipped — the other elements still follow the level.
  notifyEach(s.listeners, next, { message: 'page motion listener threw' });
}

/**
 * Publish `window.components.motion` as a NON-enumerable accessor (enumerating
 * `window.components` still yields component tags only). A value the page assigned
 * earlier as a plain property is adopted; an invalid value reads as `'auto'`.
 * Idempotent; SSR-safe.
 */
export function publishMotionHook(): void {
  if (typeof window === 'undefined') return;
  const components = (window.components ??= {}) as object;
  const existing = Object.getOwnPropertyDescriptor(components, HOOK_KEY);
  if (existing && existing.get) return;
  if (existing) setLevel(existing.value);
  Object.defineProperty(components, HOOK_KEY, {
    enumerable: false,
    configurable: true,
    get: () => state().level,
    set: setLevel,
  });
}

/** The page-wide level (`'auto'` when unset). */
export function getPageMotion(): Motion {
  publishMotionHook();
  return state().level;
}

/** Subscribe to page-wide level changes; returns the unsubscribe. */
export function observePageMotion(listener: (level: Motion) => void): () => void {
  publishMotionHook();
  const { listeners } = state();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

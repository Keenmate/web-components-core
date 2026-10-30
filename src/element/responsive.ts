/**
 * Responsive rules (SPEC §6.7) — page-wide, per-tag and per-instance partial
 * configs keyed by device class (or computed by a callback), layered on top of a
 * component's BASE config by {@link BlissElement}. One generic mechanism for every
 * component, so an app tunes "what a component does on a phone" in one place:
 *
 * ```js
 * window.components.responsive = { mobile: { presentation: 'fullscreen' } };
 * window.components.responsiveCallback = (ctx) => (ctx.env.orientation === 'landscape' ? { … } : undefined);
 * window.components['web-multiselect'].responsive = { tablet: { presentation: 'modal' } };
 * el.responsive = { tablet: { presentation: 'floating' } };      // also <x responsive='{"tablet":{…}}'>
 * el.responsiveCallback = (ctx) => ({ … });
 * ```
 *
 * Precedence (later wins, key by key): global map → global callback → per-tag map
 * → per-tag callback → INSTANCE attributes/properties → instance map → instance
 * callback. This module holds the types, the page-wide state (shared across
 * bundled core copies via `Symbol.for`) and the pure layer merge; the element side
 * lives in `bliss-element.ts`.
 */
import type { DeviceClass, EnvironmentSnapshot } from '../environment/environment.js';
import { coreLog } from '../logging/element-logger.js';

/** Partial configs keyed by device class — the declarative form of a responsive rule. */
export type ResponsiveMap<C = Record<string, unknown>> = Partial<Record<DeviceClass, Partial<C> | null>>;

/** What a {@link ResponsiveCallback} receives. */
export interface ResponsiveContext<C = Record<string, unknown>> {
  /** The current environment snapshot. */
  env: EnvironmentSnapshot;
  /** `classifyDevice(env)` — the key the maps use. */
  deviceClass: DeviceClass;
  /** `env.breakpoint` — the width bucket (from `--base-breakpoint-*` / `configureBreakpoints`). */
  breakpoint: string;
  /** The component host. */
  element: HTMLElement;
  /** The component tag, lowercase (`'web-multiselect'`). */
  component: string;
  /** The element's BASE config — what attributes / properties / defaults say, without any responsive override. Frozen copy. */
  config: Readonly<C>;
}

/**
 * The computed form of a responsive rule. Return the keys to override,
 * `undefined` for "nothing to add". From an INSTANCE callback, `null` means
 * "ignore every page rule for this element" (from a page callback it's the same
 * as `undefined`). A throw is logged and treated as `undefined`.
 */
export type ResponsiveCallback<C = Record<string, unknown>> = (ctx: ResponsiveContext<C>) => Partial<C> | null | undefined;

/** configKeys a rule may never set (core-owned / the rules themselves). */
export const RESPONSIVE_RESERVED_KEYS: ReadonlySet<string> = new Set(['responsive', 'responsiveCallback', 'shouldDefer']);

/** The core-observed JSON attribute for the instance map. */
export const RESPONSIVE_ATTRIBUTE = 'responsive';

// ---------------------------------------------------------------------------
// Page-wide state: window.components.responsive / .responsiveCallback
// ---------------------------------------------------------------------------

/** Called when a page layer changes; `tag` set → only that tag's per-tag rule changed. */
export type ResponsiveListener = (tag?: string) => void;

interface ResponsivePageState {
  map: ResponsiveMap | undefined;
  callback: ResponsiveCallback | undefined;
  /** One refresh function per connected element, across every core copy on the page. */
  listeners: Set<ResponsiveListener>;
}

/** On globalThis because each component bundles its own core copy (like logging / the loader hook). */
const STATE_KEY = Symbol.for('@keenmate/web-components-core:responsive');
const MAP_KEY = 'responsive';
const CALLBACK_KEY = 'responsiveCallback';

function state(): ResponsivePageState {
  const g = globalThis as unknown as Record<symbol, ResponsivePageState | undefined>;
  return (g[STATE_KEY] ??= { map: undefined, callback: undefined, listeners: new Set() });
}

/** A responsive map is a plain object (non-array); `null`/`undefined` = unset. */
export function isResponsiveMap(value: unknown): value is ResponsiveMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Run every element's refresh (a page layer changed). */
export function notifyResponsiveChange(tag?: string): void {
  for (const listener of [...state().listeners]) {
    try {
      listener(tag);
    } catch (error) {
      coreLog(undefined, 'INIT', 'ELEMENT').error('responsive refresh threw', error);
    }
  }
}

/** Enlist an element's refresh; returns the unsubscribe. Called by `BlissElement` while connected. */
export function onResponsiveChange(listener: ResponsiveListener): () => void {
  const listeners = state().listeners;
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Define `target[MAP_KEY]` / `target[CALLBACK_KEY]` as accessors that validate,
 * store via `store` and notify. A plain value already on `target` is adopted.
 */
function defineRuleAccessors(
  target: object,
  enumerable: boolean,
  store: { getMap(): ResponsiveMap | undefined; setMap(v: ResponsiveMap | undefined): void; getCallback(): ResponsiveCallback | undefined; setCallback(v: ResponsiveCallback | undefined): void },
  label: string,
  notify: () => void,
): void {
  const adopt = (key: string): { had: boolean; value: unknown } => {
    const d = Object.getOwnPropertyDescriptor(target, key);
    if (!d) return { had: false, value: undefined };
    return { had: true, value: d.get ? d.get.call(target) : d.value };
  };
  const preMap = adopt(MAP_KEY);
  const preCallback = adopt(CALLBACK_KEY);
  const setMap = (value: unknown): void => {
    if (value != null && !isResponsiveMap(value)) {
      coreLog(undefined, 'INIT', 'ELEMENT').warn(`${label}.responsive must be an object keyed by device class (or null); keeping previous value`, value);
      return;
    }
    store.setMap(value ?? undefined);
    notify();
  };
  const setCallback = (value: unknown): void => {
    if (value != null && typeof value !== 'function') {
      coreLog(undefined, 'INIT', 'ELEMENT').warn(`${label}.responsiveCallback must be a function (or null); keeping previous value`, value);
      return;
    }
    store.setCallback((value as ResponsiveCallback | null) ?? undefined);
    notify();
  };
  Object.defineProperty(target, MAP_KEY, { enumerable, configurable: true, get: store.getMap, set: setMap });
  Object.defineProperty(target, CALLBACK_KEY, { enumerable, configurable: true, get: store.getCallback, set: setCallback });
  if (preMap.had && preMap.value !== store.getMap()) setMap(preMap.value);
  if (preCallback.had && preCallback.value !== store.getCallback()) setCallback(preCallback.value);
}

/**
 * Publish `window.components.responsive` / `.responsiveCallback` as NON-enumerable
 * accessors (tag enumeration unaffected), adopting values the page assigned
 * earlier as plain properties. Idempotent; SSR-safe. Called by
 * `registerComponent()` and whenever an element reads the page rules.
 */
export function publishResponsiveHooks(): void {
  if (typeof window === 'undefined') return;
  const components = (window.components ??= {}) as object;
  const existing = Object.getOwnPropertyDescriptor(components, MAP_KEY);
  if (existing?.get && Object.getOwnPropertyDescriptor(components, CALLBACK_KEY)?.get) return; // already ours
  const s = state();
  defineRuleAccessors(
    components,
    false,
    {
      getMap: () => s.map,
      setMap: (v) => (s.map = v),
      getCallback: () => s.callback,
      setCallback: (v) => (s.callback = v),
    },
    'window.components',
    () => notifyResponsiveChange(),
  );
}

/**
 * Install the per-tag `responsive` / `responsiveCallback` accessors on a
 * `window.components[tag]` entry (enumerable, like the entry's other members),
 * adopting values the page set on a pre-existing entry. Called by
 * `registerComponent()`.
 */
export function installTagResponsiveHooks(entry: object, tag: string): void {
  let map: ResponsiveMap | undefined;
  let callback: ResponsiveCallback | undefined;
  defineRuleAccessors(
    entry,
    true,
    {
      getMap: () => map,
      setMap: (v) => (map = v),
      getCallback: () => callback,
      setCallback: (v) => (callback = v),
    },
    `window.components['${tag}']`,
    () => notifyResponsiveChange(tag),
  );
}

/** The page layers for one tag, in precedence order (global map, global callback, tag map, tag callback). */
export interface PageRules {
  globalMap?: ResponsiveMap;
  globalCallback?: ResponsiveCallback;
  tagMap?: ResponsiveMap;
  tagCallback?: ResponsiveCallback;
}

/** Read the page rules that apply to `tag` (empty under SSR). */
export function readPageRules(tag: string): PageRules {
  if (typeof window === 'undefined') {
    const s = state();
    return { globalMap: s.map, globalCallback: s.callback };
  }
  publishResponsiveHooks();
  const components = window.components as Record<string, unknown> | undefined;
  const entry = components?.[tag] as { responsive?: unknown; responsiveCallback?: unknown } | undefined;
  const pick = <T>(value: unknown, ok: (v: unknown) => boolean): T | undefined => (ok(value) ? (value as T) : undefined);
  const isFn = (v: unknown): boolean => typeof v === 'function';
  return {
    globalMap: pick(components?.[MAP_KEY], isResponsiveMap),
    globalCallback: pick(components?.[CALLBACK_KEY], isFn),
    tagMap: entry && typeof entry === 'object' ? pick(entry.responsive, isResponsiveMap) : undefined,
    tagCallback: entry && typeof entry === 'object' ? pick(entry.responsiveCallback, isFn) : undefined,
  };
}

/** Whether any page layer is set for `tag`. */
export function hasPageRules(rules: PageRules): boolean {
  return !!(rules.globalMap || rules.globalCallback || rules.tagMap || rules.tagCallback);
}

/**
 * Structural equality for config values: `Object.is`, plus plain arrays / plain
 * objects compared recursively — so a callback returning a fresh
 * `{ labels: { … } }` literal on every run doesn't count as a change.
 */
export function responsiveValueEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => responsiveValueEqual(v, bb[i]));
  }
  const protoA = Object.getPrototypeOf(a);
  const protoB = Object.getPrototypeOf(b);
  const isPlain = (p: unknown): boolean => p === Object.prototype || p === null;
  if (!isPlain(protoA) || !isPlain(protoB)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && responsiveValueEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** @internal Test hook: clear the page-wide rules (listeners stay — elements own them). */
export function __resetResponsive(): void {
  const s = state();
  s.map = undefined;
  s.callback = undefined;
}

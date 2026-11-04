/**
 * Responsive rules (SPEC §6.7) — page-wide, per-tag and per-instance partial
 * configs keyed by device class and/or breakpoint (or computed by a callback), layered on top of a
 * component's BASE config by {@link BlissElement}. One generic mechanism for every
 * component, so an app tunes "what a component does on a phone" in one place:
 *
 * ```js
 * window.components.responsive = { device: { mobile: { presentation: 'fullscreen' } } };
 * window.components.responsiveCallback = (ctx) => (ctx.env.orientation === 'landscape' ? { … } : undefined);
 * window.components['web-multiselect'].responsive = { breakpoint: { tablet: { presentation: 'modal' } } };
 * el.responsive = { device: { tablet: { presentation: 'floating' } } };   // also <x responsive='{"device":{"tablet":{…}}}'>
 * el.responsiveCallback = (ctx) => ({ … });
 * ```
 *
 * Precedence (later wins, key by key): global map → global callback → per-tag map
 * → per-tag callback → INSTANCE attributes/properties → instance map → instance
 * callback. This module holds the types, the page-wide state (shared across
 * bundled core copies via `Symbol.for`), the setting validation and the pure layer merge
 * ({@link mergeResponsiveRule} / {@link mergeResponsiveMap}); the element side — which
 * layers to run, when, and staging the result — lives in `bliss-element.ts`.
 */
import { sharedState, sharedStateKey } from '../global/shared-state.js';
import type { DeviceClass, EnvironmentSnapshot } from '../environment/environment.js';
import { coreLog } from '../logging/element-logger.js';
import { resolveFromProperty } from '../inputs/apply.js';
import type { InputDef } from '../inputs/types.js';

/**
 * The declarative form of a responsive rule — partial configs on two explicit axes:
 * - `device` — keyed by `classifyDevice(env)` (capability first, then the short side);
 * - `breakpoint` — keyed by `env.breakpoint` (window-width buckets, 768 / 1024 lines).
 *
 * Within one map the `breakpoint` entry applies first, then the `device` entry over
 * it (device wins on the same key). A `null` entry in an INSTANCE map = ignore every
 * page rule for this element; in a page map it means nothing.
 */
export type ResponsiveMap<C = Record<string, unknown>> = {
  device?: Partial<Record<DeviceClass, Partial<C> | null>>;
  breakpoint?: Partial<Record<string, Partial<C> | null>>;
};

/** The top-level keys of a {@link ResponsiveMap}. */
export type ResponsiveMapAxis = 'device' | 'breakpoint';

/** Allowed top-level keys of a {@link ResponsiveMap}, in merge order (later wins). */
export const RESPONSIVE_MAP_AXES: readonly ResponsiveMapAxis[] = ['breakpoint', 'device'];

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
const STATE_KEY = '@keenmate/web-components-core:responsive';
const MAP_KEY = 'responsive';
const CALLBACK_KEY = 'responsiveCallback';

function state(): ResponsivePageState {
  return sharedState(STATE_KEY, () => ({ map: undefined, callback: undefined, listeners: new Set() }));
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
    if (!isResponsiveMapSetting(value)) {
      coreLog(undefined, 'INIT', 'ELEMENT').warn(`${label}.responsive must be ${RESPONSIVE_MAP_EXPECTED}; keeping previous value`, value);
      return;
    }
    store.setMap(value ?? undefined);
    notify();
  };
  const setCallback = (value: unknown): void => {
    if (!isResponsiveCallbackSetting(value)) {
      coreLog(undefined, 'INIT', 'ELEMENT').warn(`${label}.responsiveCallback must be ${RESPONSIVE_CALLBACK_EXPECTED}; keeping previous value`, value);
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
  // The once-per-page warnings about the page-wide rules (BlissElement#warnResponsiveOnce).
  sharedState(sharedStateKey('responsive-page-warnings'), () => new Set<string>()).clear();
}

// ---------------------------------------------------------------------------
// Setting validation — shared by the page / tag accessors and the element setters
// ---------------------------------------------------------------------------

/** What a `responsive` setting accepts (for warnings). */
export const RESPONSIVE_MAP_EXPECTED = 'an object { device?, breakpoint? }, or null';
/** What a `responsiveCallback` setting accepts (for warnings). */
export const RESPONSIVE_CALLBACK_EXPECTED = 'a function, or null';

/** A valid `responsive` setting: a map, or `null` / `undefined` (clear). */
export function isResponsiveMapSetting(value: unknown): value is ResponsiveMap | null | undefined {
  return value == null || isResponsiveMap(value);
}

/** A valid `responsiveCallback` setting: a function, or `null` / `undefined` (clear). */
export function isResponsiveCallbackSetting(value: unknown): value is ResponsiveCallback | null | undefined {
  return value == null || typeof value === 'function';
}

// ---------------------------------------------------------------------------
// The layer merge — pure: everything element-specific comes in through the context
// ---------------------------------------------------------------------------

/** What {@link mergeResponsiveRule} / {@link mergeResponsiveMap} need from the element. */
export interface ResponsiveMergeContext {
  /** The input row for a configKey; `undefined` = the component has no such input. */
  getInput(configKey: string): InputDef | undefined;
  /** The element's base config (what `getBatchValuesCallback` sees). */
  readonly base: Readonly<Record<string, unknown>>;
  /** The host is form-associated: `disabled` can't be set by a rule (it must reflect). */
  readonly isFormAssociated: boolean;
  /** Report a problem with a rule (the element dedupes and logs it). */
  warn(message: string, ...detail: unknown[]): void;
}

/**
 * Merge one rule result into `out`: each key validated by its input's converter;
 * unknown / reserved / invalid keys warn and are skipped. Returns `true` when the
 * result is `null` (the instance opt-out signal; the caller decides if it counts).
 * Unknown keys from the GLOBAL page layers are skipped silently — a page-wide rule
 * legitimately names inputs only some components have.
 */
export function mergeResponsiveRule(
  ctx: ResponsiveMergeContext,
  result: unknown,
  label: string,
  out: Record<string, unknown>,
  isGlobal = false,
): boolean {
  if (result === null) return true;
  if (result === undefined) return false;
  if (!isResponsiveMap(result)) {
    ctx.warn(`${label} returned a non-object; ignored`, result);
    return false;
  }
  for (const [key, value] of Object.entries(result)) {
    if (value === undefined) continue;
    if (RESPONSIVE_RESERVED_KEYS.has(key)) {
      ctx.warn(`${label}: reserved key "${key}" skipped`);
      continue;
    }
    const def = ctx.getInput(key);
    if (!def) {
      if (!isGlobal) ctx.warn(`${label}: unknown key "${key}" skipped`);
      continue;
    }
    const resolved = resolveFromProperty(def, value);
    if (!resolved) {
      ctx.warn(`${label}: invalid value for "${key}" skipped`, value);
      continue;
    }
    // The browser disables a form-associated host by its own `disabled` ATTRIBUTE, and
    // responsive overrides never reflect — so an override could only half-disable it.
    if (def.attribute === 'disabled' && ctx.isFormAssociated) {
      ctx.warn(`${label}: "${key}" can't be set by a responsive rule (disabling must reflect to the attribute); skipped`);
      continue;
    }
    out[key] = resolved.value; // normalized, like an assigned value
    // Same rule as an explicit write (SPEC §6.2): the input's batch values come along,
    // at this layer, unless this rule names them itself.
    if (def.getBatchValuesCallback) mergeBatchValues(ctx, def, resolved.value, result as Record<string, unknown>, label, out);
  }
  return false;
}

/** {@link mergeResponsiveRule}: add the values `source`'s `getBatchValuesCallback` implies for `value`. */
function mergeBatchValues(
  ctx: ResponsiveMergeContext,
  source: InputDef,
  value: unknown,
  rule: Record<string, unknown>,
  label: string,
  out: Record<string, unknown>,
): void {
  let implied: Record<string, unknown> | null | undefined;
  try {
    implied = source.getBatchValuesCallback!(value as never, ctx.base as never);
  } catch (err) {
    ctx.warn(`${label}: getBatchValuesCallback of "${source.configKey}" threw; no other inputs set`, err);
    return;
  }
  if (!implied) return;
  for (const [key, v] of Object.entries(implied)) {
    if (key === source.configKey || rule[key] !== undefined) continue; // the rule's own value wins
    const def = ctx.getInput(key);
    const resolved = def ? resolveFromProperty(def, v) : null;
    if (!resolved) continue;
    out[key] = resolved.value;
  }
}

/**
 * Merge one responsive map into `out`: the `breakpoint` entry (width bucket) first, then
 * the `device` entry (`classifyDevice`) over it — device wins on the same key. Any other
 * top-level key (e.g. the pre-rc15 `{ mobile: … }` shape) warns and is ignored; a
 * non-object axis likewise. Returns `true` when either axis entry is `null` (the instance
 * opt-out signal; the caller decides if it counts).
 */
export function mergeResponsiveMap(
  ctx: ResponsiveMergeContext,
  map: ResponsiveMap,
  deviceClass: string,
  breakpoint: string,
  label: string,
  out: Record<string, unknown>,
  isGlobal = false,
): boolean {
  const unknown = Object.keys(map).filter((key) => !(RESPONSIVE_MAP_AXES as readonly string[]).includes(key));
  if (unknown.length > 0) {
    ctx.warn(
      `${label}: unknown top-level key(s) ${unknown.map((k) => `"${k}"`).join(', ')} ignored — a responsive map is { device?: { <deviceClass>: {…} }, breakpoint?: { <breakpoint>: {…} } }`,
    );
  }
  let isNull = false;
  const axes: Array<[ResponsiveMapAxis, string]> = [
    ['breakpoint', breakpoint],
    ['device', deviceClass],
  ];
  for (const [axis, key] of axes) {
    const entries = map[axis];
    if (entries == null) continue;
    if (!isResponsiveMap(entries)) {
      ctx.warn(`${label}.${axis} must be an object; ignored`, entries);
      continue;
    }
    if (mergeResponsiveRule(ctx, (entries as Record<string, unknown>)[key], `${label}.${axis}.${key}`, out, isGlobal)) isNull = true;
  }
  return isNull;
}

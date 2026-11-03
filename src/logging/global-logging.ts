/**
 * The page-wide logging switch (SPEC §12.1 / §12.3): one set of controls that
 * applies a level to EVERY logger bundle on the page — each component's
 * `createLoggers()` bundle plus core's own `CORE` bundle — and to every bundle
 * created later (a late-registered component adopts the current global level).
 * Published as the non-enumerable `window.components.logging`:
 *
 * ```js
 * window.components.logging.disableLogging();       // all components + CORE
 * window.components.logging.enableLogging('debug');
 * window.components.logging.setLogLevel('warn');
 * window.components.logging.getCategories();        // ['CORE:ELEMENT', 'MULTISELECT:INIT', …]
 * ```
 *
 * Components bundle their own copy of core, so the state lives on `globalThis`
 * under a `Symbol.for` key: every core copy on the page shares ONE bundle list,
 * ONE current level and ONE controls object. A later per-component call
 * (`window.components['web-x'].logging.setLogLevel(…)`) simply sets that
 * bundle's levels again, so it wins for that component.
 */
import { isLogLevel, type LogLevelDesc } from './log-core.js';

/** The page-wide controls — same method names as a component's `logging` entry. */
export interface GlobalLoggingControls {
  /** Turn logging on for every bundle (default level: `debug`). */
  enableLogging(level?: LogLevelDesc): void;
  /** Silence every bundle. */
  disableLogging(): void;
  /** Set the same level on every bundle. */
  setLogLevel(level: LogLevelDesc): void;
  /** Every `NAMESPACE:CATEGORY` label currently known, in registration order. */
  getCategories(): string[];
}

/** The slice of a `LoggerBundle` the global switch drives (kept minimal: shared across core copies/versions). */
export interface GlobalLoggingTarget {
  readonly namespace: string;
  readonly LOGGING_CATEGORIES: readonly string[];
  setLogLevel(level: LogLevelDesc): void;
}

interface GlobalLoggingState {
  /** The last level set through the global controls; `undefined` = never set (bundles keep their defaults). */
  level: LogLevelDesc | undefined;
  bundles: Set<GlobalLoggingTarget>;
  controls: GlobalLoggingControls;
}

const STATE_KEY = Symbol.for('@keenmate/web-components-core:logging');

function state(): GlobalLoggingState {
  const g = globalThis as unknown as Record<symbol, GlobalLoggingState | undefined>;
  let s = g[STATE_KEY];
  if (!s) {
    const created: GlobalLoggingState = {
      level: undefined,
      bundles: new Set(),
      controls: undefined as unknown as GlobalLoggingControls,
    };
    const applyAll = (level: LogLevelDesc): void => {
      // Check BEFORE storing: a stored bad level would make every later createLoggers()
      // (any lazily loaded component, any copy of core) throw at registration.
      if (!isLogLevel(level)) {
        throw new TypeError(`window.components.logging: invalid level "${String(level)}" (expected trace | debug | info | warn | error | silent)`);
      }
      created.level = level;
      for (const bundle of created.bundles) bundle.setLogLevel(level);
    };
    created.controls = {
      enableLogging: (level = 'debug') => applyAll(level),
      disableLogging: () => applyAll('silent'),
      setLogLevel: (level) => applyAll(level),
      getCategories: () => {
        const out = new Set<string>();
        for (const bundle of created.bundles) {
          for (const category of bundle.LOGGING_CATEGORIES) out.add(`${bundle.namespace}:${category}`);
        }
        return [...out];
      },
    };
    s = g[STATE_KEY] = created;
  }
  return s;
}

/** The page-wide controls (also reachable as `window.components.logging` in a browser). */
export function getGlobalLogging(): GlobalLoggingControls {
  return state().controls;
}

/**
 * Publish the controls as the NON-enumerable `window.components.logging`, so
 * enumerating `window.components` still yields only component tags (tag names
 * always contain a hyphen, so `logging` can't clash). Idempotent; SSR-safe.
 */
export function publishGlobalLogging(): void {
  if (typeof window === 'undefined') return;
  const components = (window.components ??= {}) as object;
  if (Object.prototype.hasOwnProperty.call(components, 'logging')) return;
  Object.defineProperty(components, 'logging', {
    value: state().controls,
    enumerable: false,
    configurable: true,
    writable: false,
  });
}

/**
 * Enlist a bundle under the global switch. When a global level was already set,
 * the bundle adopts it now (late registration). Called by `createLoggers()`.
 */
export function registerGlobalLoggingTarget(bundle: GlobalLoggingTarget): void {
  const s = state();
  s.bundles.add(bundle);
  // isLogLevel: the shared state may come from an older copy of core that stored a bad level.
  if (s.level !== undefined && isLogLevel(s.level)) bundle.setLogLevel(s.level);
  publishGlobalLogging();
}

/** @internal Test hook: forget the page-wide level (bundles keep their current levels). */
export function __resetGlobalLogging(): void {
  state().level = undefined;
}

/**
 * Helpers every component test suite ended up re-implementing (review 2026-11-03, L-13):
 * reset core's PAGE-WIDE state between tests, capture console output as readable lines,
 * and await one event. Runner-agnostic like the rest of `/testing` (no vitest import).
 */
import { __resetAdoptedStyles } from '../dom/adopt-styles.js';
import { __resetResponsive } from '../element/responsive.js';
import { __resetElementSizeObservers } from '../environment/element-size.js';
import { __resetEnvironment } from '../environment/environment.js';
import { __resetTheme } from '../environment/theme.js';
import { __resetGlobalLogging } from '../logging/global-logging.js';
import { __resetOverlays } from '../overlay/active-overlay.js';
import { __resetScrollLock } from '../overlay/scroll-lock.js';

/**
 * Reset the page-wide state core keeps across components (shared by every copy of core):
 * open overlays and their routing, the body scroll lock, the environment snapshot and
 * breakpoints, theme watchers, responsive page rules, the global log level, adopted-style
 * caches and element-size observers. Call in `afterEach` when tests open overlays, lock
 * scrolling or set page rules — otherwise state leaks into the next test.
 */
export function resetPageState(): void {
  __resetOverlays();
  __resetScrollLock();
  __resetEnvironment();
  __resetTheme();
  __resetResponsive();
  __resetGlobalLogging();
  __resetAdoptedStyles();
  __resetElementSizeObservers();
}

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';

/** A console capture started by {@link captureConsole}. */
export interface ConsoleCapture {
  /** Every captured call, in order: the method and its raw arguments. */
  readonly calls: ReadonlyArray<{ method: ConsoleMethod; args: readonly unknown[] }>;
  /**
   * The captured calls as readable lines — core's `%c` colour directives and their CSS
   * arguments dropped: `'[NS:INIT] #id message'`. Optionally only one method's.
   */
  lines(method?: ConsoleMethod): string[];
  /** Put the real console methods back. */
  restore(): void;
}

/** `['%c[NS:INIT]%c #x', css, css, 'msg', detail]` → `'[NS:INIT] #x msg'`. */
function lineOf(args: readonly unknown[]): string {
  const [first, ...rest] = args;
  if (typeof first !== 'string' || !first.includes('%c')) return args.map(String).join(' ');
  const cssCount = first.split('%c').length - 1;
  const message = rest[cssCount];
  const label = first.replace(/%c/g, '');
  return message === undefined ? label : `${label} ${String(message)}`;
}

/**
 * Capture (and silence) `console.log / info / warn / error / debug` until `restore()`.
 * Core's element loggers look the console method up per call, so they are captured; a
 * component's TYPE loggers bind the method when created — start the capture before the
 * component module is imported to see those.
 */
export function captureConsole(methods: readonly ConsoleMethod[] = ['log', 'info', 'warn', 'error', 'debug']): ConsoleCapture {
  const calls: { method: ConsoleMethod; args: readonly unknown[] }[] = [];
  const target = console as unknown as Record<ConsoleMethod, (...args: unknown[]) => void>;
  const originals = new Map<ConsoleMethod, (...args: unknown[]) => void>();
  for (const method of methods) {
    originals.set(method, target[method]);
    target[method] = (...args: unknown[]) => void calls.push({ method, args });
  }
  return {
    calls,
    lines: (method) => calls.filter((c) => !method || c.method === method).map((c) => lineOf(c.args)),
    restore() {
      for (const [method, original] of originals) target[method] = original;
      originals.clear();
    },
  };
}

/**
 * Resolve with the next `name` event on `target` (e.g. `await waitForEvent(el, 'change')`).
 * Rejects after `timeout` ms (default 2000) so a missing event fails the test instead of
 * hanging it.
 */
export function waitForEvent<E extends Event = CustomEvent>(
  target: EventTarget,
  name: string,
  opts: { timeout?: number } = {},
): Promise<E> {
  const timeout = opts.timeout ?? 2000;
  return new Promise<E>((resolve, reject) => {
    const timer = setTimeout(() => {
      target.removeEventListener(name, onEvent);
      reject(new Error(`waitForEvent: no "${name}" event within ${timeout}ms`));
    }, timeout);
    function onEvent(event: Event): void {
      clearTimeout(timer);
      target.removeEventListener(name, onEvent);
      resolve(event as E);
    }
    target.addEventListener(name, onEvent);
  });
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetEnvironment,
  classifyDevice,
  configureBreakpoints,
  getEnvironment,
  observeEnvironment,
  observeViewport,
  type EnvironmentSnapshot,
} from './environment.js';

// Review 2026-11-03 V-19 #1 (environment test gaps). jsdom has no matchMedia: a controllable mock,
// optionally WITHOUT addEventListener (old Safari's addListener / removeListener only).
type MediaState = Record<string, boolean>;

function installMatchMedia(state: MediaState, opts: { isLegacy?: boolean } = {}) {
  const listeners = new Map<string, Set<() => void>>();
  const calls = { addEventListener: 0, removeEventListener: 0, addListener: 0, removeListener: 0 };
  const add = (query: string, cb: () => void): void => {
    let set = listeners.get(query);
    if (!set) listeners.set(query, (set = new Set()));
    set.add(cb);
  };
  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() {
      return !!state[query];
    },
    onchange: null,
    ...(opts.isLegacy
      ? {}
      : {
          addEventListener: (_type: string, cb: () => void) => {
            calls.addEventListener++;
            add(query, cb);
          },
          removeEventListener: (_type: string, cb: () => void) => {
            calls.removeEventListener++;
            listeners.get(query)?.delete(cb);
          },
        }),
    addListener: (cb: () => void) => {
      calls.addListener++;
      add(query, cb);
    },
    removeListener: (cb: () => void) => {
      calls.removeListener++;
      listeners.get(query)?.delete(cb);
    },
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
  return {
    set(next: MediaState) {
      Object.assign(state, next);
    },
    fire(query: string) {
      [...(listeners.get(query) ?? [])].forEach((cb) => cb());
    },
    /** Live callbacks across every query. */
    live: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    calls,
  };
}

function setSize(width: number, height = 800): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

const DESKTOP: MediaState = {
  '(pointer: coarse)': false,
  '(pointer: fine)': true,
  '(any-pointer: coarse)': false,
  '(hover: hover)': true,
  '(orientation: portrait)': false,
};

const TABLET_LANDSCAPE: MediaState = {
  '(pointer: coarse)': true,
  '(pointer: fine)': false,
  '(any-pointer: coarse)': true,
  '(hover: hover)': false,
  '(orientation: portrait)': false,
};

beforeEach(() => {
  setSize(1200);
});

afterEach(() => {
  __resetEnvironment();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as { matchMedia?: unknown }).matchMedia;
  setSize(1024, 768);
});

describe('V-19 #1 — an immediate-fire throw (V-01)', () => {
  it('observeEnvironment: logged, the unsubscribe is returned, and it releases the shared listeners', () => {
    const media = installMatchMedia({ ...DESKTOP });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    let unsub: (() => void) | undefined;
    expect(() => {
      unsub = observeEnvironment(() => {
        calls++;
        throw new Error('boom');
      });
    }).not.toThrow();
    expect(calls).toBe(1);
    expect(error.mock.calls.flat().join(' ')).toContain('environment listener threw');
    expect(media.live()).toBeGreaterThan(0); // the subscription stands
    media.set({ '(orientation: portrait)': true });
    media.fire('(orientation: portrait)');
    expect(calls).toBe(2); // still subscribed after the throwing first call
    unsub!();
    expect(media.live()).toBe(0); // no leak
  });

  it('observeViewport: the same — the throwing first call does not leak the subscription', () => {
    const media = installMatchMedia({ ...DESKTOP });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const unsub = observeViewport(() => {
      throw new Error('boom');
    });
    expect(typeof unsub).toBe('function');
    expect(media.live()).toBeGreaterThan(0);
    unsub();
    expect(media.live()).toBe(0);
  });
  // BlissElement level (ready still fires, remove() unsubscribes): src/element/hook-errors.test.ts
  // 'a throwing first environmentChanged() still announces ready, and remove() unsubscribes it'.
});

describe('V-19 #1 — configureBreakpoints() inside a listener (re-entrant recompute)', () => {
  // FIXED (V-19 #1): recompute() is not re-entrant. A listener calling configureBreakpoints() runs a nested
  // recompute that notifies everyone with the new snapshot, then the OUTER notifyEach loop keeps going and
  // hands the remaining listeners the stale outer snapshot ('desktop') as their last notification, while
  // getEnvironment() says 'mobile'.
  it('every subscriber ends on the final breakpoint, not the stale outer snapshot', () => {
    installMatchMedia({ ...DESKTOP });
    setSize(800); // tablet with the defaults
    let hasReconfigured = false;
    const first: string[] = [];
    const second: string[] = [];
    const unsubA = observeEnvironment(
      (env) => {
        first.push(env.breakpoint);
        if (!hasReconfigured) {
          hasReconfigured = true;
          configureBreakpoints({ mobile: 900, desktop: Infinity }); // 800 → mobile
        }
      },
      { shouldFireImmediately: false },
    );
    const unsubB = observeEnvironment((env) => second.push(env.breakpoint), { shouldFireImmediately: false });

    configureBreakpoints({ mobile: 500, desktop: Infinity }); // 800 → desktop — notifies A, which reconfigures
    expect(getEnvironment().breakpoint).toBe('mobile');
    expect(first.at(-1)).toBe('mobile');
    expect(second.at(-1)).toBe('mobile');
    unsubA();
    unsubB();
  });
});

describe('V-19 #1 — observeViewport only + configureBreakpoints across copies', () => {
  it('a copy with only a viewport subscriber re-resolves when another copy reconfigures', async () => {
    installMatchMedia({ ...DESKTOP });
    setSize(800);
    const unsub = observeViewport(() => {});
    expect(getEnvironment().breakpoint).toBe('tablet');
    vi.resetModules();
    const other = await import('./environment.js'); // another bundle
    other.configureBreakpoints({ mobile: 900, desktop: Infinity });
    expect(getEnvironment().breakpoint).toBe('mobile'); // heard km-breakpoints-change
    unsub();
    other.__resetEnvironment();
  });
});

describe('V-19 #1 — the legacy addListener / removeListener path (old Safari)', () => {
  it('attaches through addListener, hears changes, and detaches through removeListener', () => {
    const media = installMatchMedia({ ...DESKTOP }, { isLegacy: true });
    const seen: string[] = [];
    const unsub = observeEnvironment((env) => seen.push(env.orientation));
    expect(media.calls.addListener).toBe(5);
    expect(media.calls.addEventListener).toBe(0);
    media.set({ '(orientation: portrait)': true });
    media.fire('(orientation: portrait)');
    expect(seen).toEqual(['landscape', 'portrait']);
    unsub();
    expect(media.calls.removeListener).toBe(5);
    expect(media.live()).toBe(0);
  });

  it('prefers addEventListener when both exist', () => {
    const media = installMatchMedia({ ...DESKTOP });
    const unsub = observeEnvironment(() => {});
    expect(media.calls.addEventListener).toBe(5);
    expect(media.calls.addListener).toBe(0);
    unsub();
    expect(media.calls.removeEventListener).toBe(5);
    expect(media.calls.removeListener).toBe(0);
  });
});

describe('V-19 #1 — a keyboard-induced height change does not flip the device class (V-05)', () => {
  it('a landscape tablet whose viewport height shrinks to 420 stays a tablet; no environmentChanged', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.spyOn(screen, 'width', 'get').mockReturnValue(1280);
    vi.spyOn(screen, 'height', 'get').mockReturnValue(800);
    installMatchMedia({ ...TABLET_LANDSCAPE });
    setSize(1280, 800);
    const seen: EnvironmentSnapshot[] = [];
    const unsub = observeEnvironment((env) => seen.push(env));
    expect(classifyDevice(seen[0]!)).toBe('tablet');

    setSize(1280, 420); // soft keyboard open
    window.dispatchEvent(new Event('resize'));
    expect(getEnvironment().viewportHeight).toBe(420);
    expect(classifyDevice(getEnvironment())).toBe('tablet');
    expect(seen).toHaveLength(1); // no discrete flip
    unsub();
  });
});

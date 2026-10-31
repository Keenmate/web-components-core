import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { define } from './define.js';
import { toBool, toEnum, toInt, toObject, toText } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';
import { __resetEnvironment, __viewportSubscriberCount } from '../environment/environment.js';
import { registerComponent } from '../global/register-component.js';
import { __resetResponsive, type ResponsiveCallback, type ResponsiveContext, type ResponsiveMap } from './responsive.js';

// ── environment mock (jsdom has no matchMedia) ─────────────────────────────
type MediaState = Record<string, boolean>;
const listeners = new Map<string, Set<() => void>>();
let media: MediaState = {};

const DESKTOP: MediaState = {
  '(pointer: coarse)': false,
  '(pointer: fine)': true,
  '(any-pointer: coarse)': false,
  '(hover: hover)': true,
  '(orientation: portrait)': false,
};
const TOUCH: MediaState = {
  '(pointer: coarse)': true,
  '(pointer: fine)': false,
  '(any-pointer: coarse)': true,
  '(hover: hover)': false,
  '(orientation: portrait)': true,
};

function installMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() {
      return !!media[query];
    },
    onchange: null,
    addEventListener: (_t: string, cb: () => void) => {
      let set = listeners.get(query);
      if (!set) listeners.set(query, (set = new Set()));
      set.add(cb);
    },
    removeEventListener: (_t: string, cb: () => void) => listeners.get(query)?.delete(cb),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
}

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

/** Switch the simulated device; fires the media listeners like a real flip. */
function device(kind: 'desktop' | 'tablet' | 'mobile', orientation: 'portrait' | 'landscape' = 'portrait'): void {
  if (kind === 'desktop') {
    media = { ...DESKTOP };
    setViewport(1280, 800);
  } else {
    media = { ...TOUCH, '(orientation: portrait)': orientation === 'portrait' };
    const [short, long] = kind === 'mobile' ? [390, 844] : [768, 1024];
    setViewport(orientation === 'portrait' ? short : long, orientation === 'portrait' ? long : short);
  }
  for (const set of listeners.values()) for (const cb of [...set]) cb();
}

function envListenerCount(): number {
  let n = 0;
  for (const set of listeners.values()) n += set.size;
  return n;
}

// ── test element ────────────────────────────────────────────────────────────
class RespElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'presentation', attribute: 'presentation', converter: toEnum(['auto', 'floating', 'modal', 'fullscreen'] as const, { default: 'auto' }), default: 'auto', shouldReflect: true },
    { configKey: 'columns', attribute: 'columns', converter: toInt({ min: 1 }), default: 2, on: 'reinit' },
    { configKey: 'label', attribute: 'label', converter: toText({ default: 'x' }), default: 'x' },
    { configKey: 'isCompact', attribute: 'compact', converter: toBool('presence'), default: false },
    { configKey: 'labels', converter: toObject(), default: {} },
  ];
  readonly calls: string[] = [];
  readonly partials: Record<string, unknown>[] = [];
  seenAtReinit: Record<string, unknown> = {};
  protected override reinit(): void {
    this.calls.push('reinit');
    this.seenAtReinit = { ...this.config };
  }
  protected override update(partial: Record<string, unknown>): void {
    this.calls.push(`update:${Object.keys(partial).sort().join(',')}`);
    this.partials.push({ ...partial });
  }
  get cfg(): Readonly<Record<string, unknown>> {
    return this.config;
  }
}
const TAG = 'resp-element';
define(TAG, RespElement as unknown as CustomElementConstructor);

type Resp = RespElement & {
  presentation: string;
  columns: number;
  label: string;
  isCompact: boolean;
  labels: Record<string, string>;
};

function make(html = `<${TAG}></${TAG}>`): Resp {
  const host = document.createElement('div');
  host.innerHTML = html;
  const el = host.firstElementChild as Resp;
  document.body.appendChild(el);
  return el;
}

const comps = () => window.components as Record<string, any>;

beforeEach(() => {
  installMatchMedia();
  device('desktop');
});

afterEach(() => {
  document.body.innerHTML = '';
  __resetResponsive();
  for (const key of Object.keys(window.components ?? {})) delete comps()[key];
  __resetEnvironment();
  listeners.clear();
  delete (window as { matchMedia?: unknown }).matchMedia;
  setViewport(1024, 768);
  vi.restoreAllMocks();
});

describe('responsive rules — first build + basics', () => {
  it('no rules: nothing changes, no environment subscription', () => {
    const el = make();
    expect(el.presentation).toBe('auto');
    expect(el.calls).toEqual(['reinit']);
    expect(envListenerCount()).toBe(0);
  });

  it('the first build already gets the rule (no flash of the desktop layout)', () => {
    device('mobile');
    comps(); // ensure window.components exists
    window.components!.responsive = { mobile: { presentation: 'fullscreen', columns: 1 } };
    const el = make();
    expect(el.calls).toEqual(['reinit']);
    expect(el.seenAtReinit.presentation).toBe('fullscreen');
    expect(el.seenAtReinit.columns).toBe(1);
    expect(el.presentation).toBe('fullscreen'); // the getter reports the effective value
  });

  it('a deferred element applies the rules at release', () => {
    device('mobile');
    window.components = window.components ?? {};
    const el = make(`<${TAG} defer></${TAG}>`);
    el.responsive = { mobile: { columns: 1 } };
    expect(el.calls).toEqual([]);
    el.release();
    expect(el.calls).toEqual(['reinit']);
    expect(el.seenAtReinit.columns).toBe(1);
  });

  it('overrides never reflect to attributes and never count as explicit', () => {
    const el = make(`<${TAG}></${TAG}>`);
    el.responsive = { desktop: { presentation: 'modal' } };
    expect(el.presentation).toBe('modal');
    expect(el.hasAttribute('presentation')).toBe(false);
    el.responsive = null;
    expect(el.presentation).toBe('auto');
  });
});

describe('responsive rules — precedence', () => {
  it('global map → global callback → tag map → tag callback → explicit instance → instance map → instance callback', async () => {
    registerComponent(TAG, RespElement as unknown as CustomElementConstructor, { config: { name: 'x', version: '1' }, shouldAutoDefine: false });
    const el = make();
    const set = (k: string) => el.label;
    void set;

    window.components!.responsive = { desktop: { label: 'global-map' } };
    expect(el.label).toBe('global-map');

    window.components!.responsiveCallback = () => ({ label: 'global-cb' });
    expect(el.label).toBe('global-cb');

    comps()[TAG].responsive = { desktop: { label: 'tag-map' } };
    expect(el.label).toBe('tag-map');

    comps()[TAG].responsiveCallback = () => ({ label: 'tag-cb' });
    expect(el.label).toBe('tag-cb');

    el.setAttribute('label', 'explicit');
    expect(el.label).toBe('explicit'); // an attribute on the element beats every page rule

    el.responsive = { desktop: { label: 'instance-map' } };
    expect(el.label).toBe('instance-map');

    el.responsiveCallback = () => ({ label: 'instance-cb' });
    expect(el.label).toBe('instance-cb');

    // and unwinding restores each lower layer
    el.responsiveCallback = null;
    expect(el.label).toBe('instance-map');
    el.responsive = null;
    expect(el.label).toBe('explicit');
    el.removeAttribute('label'); // no longer explicit → the page rules apply again
    expect(el.label).toBe('tag-cb');
    comps()[TAG].responsiveCallback = undefined;
    expect(el.label).toBe('tag-map');
    comps()[TAG].responsive = undefined;
    expect(el.label).toBe('global-cb');
    window.components!.responsiveCallback = undefined;
    expect(el.label).toBe('global-map');
    window.components!.responsive = undefined;
    expect(el.label).toBe('x'); // the default
    await el.whenSettled();
  });

  it('merges key by key across layers', () => {
    window.components = window.components ?? {};
    window.components.responsive = { desktop: { label: 'g', isCompact: true } };
    const el = make();
    el.responsive = { desktop: { label: 'i' } };
    expect(el.label).toBe('i');
    expect(el.isCompact).toBe(true);
  });

  it('a property assigned while a page rule overrides it becomes explicit and wins', () => {
    window.components = window.components ?? {};
    window.components.responsive = { desktop: { columns: 3 } };
    const el = make();
    expect(el.columns).toBe(3);
    el.columns = 4;
    expect(el.columns).toBe(4);
    window.components.responsive = { desktop: { columns: 5 } };
    expect(el.columns).toBe(4); // still explicit
  });

  it('a property assigned while an instance rule overrides it updates the base only', () => {
    const el = make();
    el.responsive = { desktop: { columns: 3 } };
    const seen: Array<Readonly<Record<string, unknown>>> = [];
    el.responsiveCallback = (ctx) => {
      seen.push(ctx.config);
      return undefined;
    };
    el.columns = 4;
    expect(el.columns).toBe(3); // the instance rule wins
    el.flush();
    expect(seen.at(-1)?.columns).toBe(4); // ctx.config is the BASE config
    el.responsive = null;
    expect(el.columns).toBe(4); // rule gone → the base value
  });
});

describe('responsive rules — null opt-out', () => {
  beforeEach(() => {
    window.components = window.components ?? {};
    window.components.responsive = { desktop: { label: 'page', isCompact: true } };
  });

  it('an instance callback returning null ignores every page rule', () => {
    const el = make();
    expect(el.label).toBe('page');
    el.responsiveCallback = () => null;
    expect(el.label).toBe('x');
    expect(el.isCompact).toBe(false);
  });

  it('an instance map entry of null ignores the page rules on that class', () => {
    const el = make();
    el.responsive = { desktop: null, mobile: { label: 'm' } };
    expect(el.label).toBe('x');
  });

  it('an instance null still applies the instance map values', () => {
    const el = make();
    el.responsive = { desktop: { label: 'own' } };
    el.responsiveCallback = () => null;
    expect(el.label).toBe('own');
    expect(el.isCompact).toBe(false);
  });

  it('a page-level null is the same as undefined', () => {
    window.components!.responsiveCallback = () => null;
    const el = make();
    expect(el.label).toBe('page');
  });
});

describe('responsive rules — environment re-run + diffing', () => {
  const map: ResponsiveMap = { mobile: { presentation: 'fullscreen' }, tablet: { presentation: 'modal' } };

  it('re-runs on a device flip and stages only the changed keys in one batch', async () => {
    const el = make();
    el.responsive = map;
    await el.whenSettled();
    el.calls.length = 0;
    device('mobile');
    expect(el.presentation).toBe('fullscreen');
    await el.whenSettled();
    expect(el.calls).toEqual(['update:presentation']);
    expect(el.partials.at(-1)).toEqual({ presentation: 'fullscreen' });
    device('tablet');
    await el.whenSettled();
    expect(el.calls).toEqual(['update:presentation', 'update:presentation']);
    expect(el.presentation).toBe('modal');
    device('desktop');
    await el.whenSettled();
    expect(el.presentation).toBe('auto'); // back to base
    expect(el.partials.at(-1)).toEqual({ presentation: 'auto' });
  });

  it('no update when the result is unchanged (orientation flip on the same class)', async () => {
    device('mobile', 'portrait');
    const el = make();
    el.responsive = map;
    await el.whenSettled();
    el.calls.length = 0;
    device('mobile', 'landscape');
    await el.whenSettled();
    await Promise.resolve();
    expect(el.calls).toEqual([]);
  });

  it('a callback returning a fresh but equal object is not a change', async () => {
    const el = make();
    el.responsiveCallback = () => ({ labels: { empty: 'Nothing' } });
    await el.whenSettled();
    el.calls.length = 0;
    device('mobile');
    await el.whenSettled();
    expect(el.calls).toEqual([]);
    expect(el.labels).toEqual({ empty: 'Nothing' });
  });

  it('a reinit-level key triggers reinit, not update', async () => {
    const el = make();
    el.responsive = { mobile: { columns: 1 } };
    await el.whenSettled();
    el.calls.length = 0;
    device('mobile');
    await el.whenSettled();
    expect(el.calls).toEqual(['reinit']);
    expect(el.seenAtReinit.columns).toBe(1);
  });

  it('the callback context carries env, deviceClass, breakpoint, element, component', () => {
    device('tablet');
    const el = make();
    let ctx: ResponsiveContext | undefined;
    el.responsiveCallback = (c) => {
      ctx = c;
      return undefined;
    };
    expect(ctx?.deviceClass).toBe('tablet');
    expect(ctx?.breakpoint).toBe('mobile'); // 768 wide = the mobile width bucket
    expect(ctx?.element).toBe(el);
    expect(ctx?.component).toBe(TAG);
    expect(ctx?.env.isTouchPrimary).toBe(true);
    expect(Object.isFrozen(ctx?.config)).toBe(true);
  });

  it('subscribes to the environment only while a layer is set and the element is connected', () => {
    const el = make();
    expect(envListenerCount()).toBe(0);
    el.responsive = map;
    expect(envListenerCount()).toBeGreaterThan(0);
    el.remove();
    expect(envListenerCount()).toBe(0);
    document.body.appendChild(el);
    expect(envListenerCount()).toBeGreaterThan(0);
    el.responsive = null;
    expect(envListenerCount()).toBe(0);
  });

  it('a base change re-runs the callbacks', async () => {
    const el = make();
    el.responsiveCallback = (ctx) => (ctx.config.label === 'big' ? { columns: 5 } : undefined);
    expect(el.columns).toBe(2);
    el.label = 'big';
    await el.whenSettled();
    expect(el.columns).toBe(5);
  });

  it('config changed while detached is applied on reconnect', () => {
    const el = make();
    el.remove();
    el.responsive = { desktop: { columns: 7 } };
    el.calls.length = 0;
    document.body.appendChild(el);
    expect(el.calls).toEqual(['reinit']);
    expect(el.seenAtReinit.columns).toBe(7);
  });
});

describe('responsive rules — continuous width (callbacks only)', () => {
  // Drive the rAF-coalesced resize handler synchronously and the viewport throttle via fake timers.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function resize(width: number): void {
    setViewport(width, 800);
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(50);
  }

  it('a callback re-runs on a width change inside one breakpoint bucket', async () => {
    const el = make();
    el.responsiveCallback = (ctx) => (ctx.env.viewportWidth <= 1200 ? { columns: 3 } : undefined);
    await el.whenSettled();
    expect(el.columns).toBe(2);
    resize(1100); // still the `desktop` bucket and device class — no discrete change
    expect(el.columns).toBe(3);
    resize(1250);
    expect(el.columns).toBe(2);
  });

  it('a page-level callback follows the width too', () => {
    registerComponent(TAG, RespElement as unknown as CustomElementConstructor, { config: { name: 'x', version: '1' }, shouldAutoDefine: false });
    const el = make();
    comps()[TAG].responsiveCallback = (ctx: ResponsiveContext) => (ctx.env.viewportWidth <= 1200 ? { label: 'narrow' } : undefined);
    expect(el.label).toBe('x');
    resize(1100);
    expect(el.label).toBe('narrow');
  });

  it('a map-only element does not subscribe to the continuous channel', () => {
    const el = make();
    el.responsive = { mobile: { columns: 1 } };
    expect(__viewportSubscriberCount()).toBe(0);
    el.responsiveCallback = () => undefined;
    expect(__viewportSubscriberCount()).toBe(1);
    el.responsiveCallback = null;
    expect(__viewportSubscriberCount()).toBe(0);
    el.responsiveCallback = () => undefined;
    el.remove();
    expect(__viewportSubscriberCount()).toBe(0);
    document.body.appendChild(el);
    expect(__viewportSubscriberCount()).toBe(1);
  });

  it('no update when the callback result is unchanged across width changes', async () => {
    const el = make();
    let runs = 0;
    el.responsiveCallback = (ctx) => {
      runs++;
      return ctx.env.viewportWidth <= 600 ? { columns: 1 } : { label: 'wide' };
    };
    await el.whenSettled();
    el.calls.length = 0;
    const before = runs;
    resize(1100);
    resize(900);
    await el.whenSettled();
    expect(runs).toBeGreaterThan(before);
    expect(el.calls).toEqual([]);
  });
});

describe('responsive rules — validation', () => {
  it('invalid values, unknown keys and reserved keys warn and are skipped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make();
    el.responsive = {
      desktop: { presentation: 'nope', bogus: 1, responsive: {}, shouldDefer: true, label: 'ok' } as never,
    };
    expect(el.presentation).toBe('auto');
    expect(el.label).toBe('ok');
    const text = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(text).toMatch(/invalid value for "presentation"/);
    expect(text).toMatch(/unknown key "bogus"/);
    expect(text).toMatch(/reserved key "responsive"/);
    expect(text).toMatch(/reserved key "shouldDefer"/);
  });

  it('unknown keys in the page-wide (global) rules are skipped silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.components = window.components ?? {};
    window.components.responsive = { desktop: { someOtherComponentsKey: 1, label: 'g' } as never };
    const el = make();
    expect(el.label).toBe('g');
    expect(warn).not.toHaveBeenCalled();
  });

  it('a throwing callback is logged and treated as undefined', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = make();
    el.responsive = { desktop: { label: 'map' } };
    el.responsiveCallback = () => {
      throw new Error('boom');
    };
    expect(el.label).toBe('map');
    expect(error).toHaveBeenCalled();
  });

  it('rejects a non-object responsive / non-function responsiveCallback', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make();
    el.responsive = { desktop: { label: 'a' } };
    el.responsive = 'nope' as never;
    el.responsiveCallback = 42 as never;
    expect(el.responsive).toEqual({ desktop: { label: 'a' } });
    expect(el.responsiveCallback).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('responsive rules — attribute + pre-upgrade', () => {
  it('reads the responsive attribute as JSON; removing it clears the map', () => {
    const el = make(`<${TAG} responsive='{"desktop":{"label":"attr"}}'></${TAG}>`);
    expect(el.label).toBe('attr');
    expect(el.responsive).toEqual({ desktop: { label: 'attr' } });
    el.removeAttribute('responsive');
    expect(el.label).toBe('x');
  });

  it('invalid JSON warns and keeps the previous map', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make(`<${TAG} responsive='{"desktop":{"label":"attr"}}'></${TAG}>`);
    el.setAttribute('responsive', '{nope');
    expect(el.label).toBe('attr');
    expect(warn).toHaveBeenCalled();
  });

  it('a responsive / responsiveCallback assigned before upgrade is kept', () => {
    const tag = 'resp-late-element';
    const el = document.createElement(tag) as Resp;
    const cb: ResponsiveCallback = () => ({ label: 'cb' });
    (el as unknown as Record<string, unknown>).responsive = { desktop: { isCompact: true } };
    (el as unknown as Record<string, unknown>).responsiveCallback = cb;
    document.body.appendChild(el);
    class Late extends RespElement {}
    define(tag, Late as unknown as CustomElementConstructor);
    expect(el.responsiveCallback).toBe(cb);
    expect(el.isCompact).toBe(true);
    expect(el.label).toBe('cb');
  });
});

describe('responsive rules — page registry', () => {
  it('window.components.responsive / responsiveCallback are non-enumerable', () => {
    registerComponent(TAG, RespElement as unknown as CustomElementConstructor, { config: { name: 'x', version: '1' }, shouldAutoDefine: false });
    window.components!.responsive = { desktop: {} };
    window.components!.responsiveCallback = () => undefined;
    expect(Object.keys(window.components!)).toEqual([TAG]);
  });

  it('adopts plain values the page set before core loaded (global + per-tag), keeping the entry object', () => {
    // A fresh page: the page script ran before any component bundle.
    const pageEntry = { responsive: { desktop: { label: 'tag-early' } } };
    window.components = { responsive: { desktop: { isCompact: true } }, [TAG]: pageEntry } as never;
    const entry = registerComponent(TAG, RespElement as unknown as CustomElementConstructor, {
      config: { name: 'x', version: '1' },
      shouldAutoDefine: false,
    });
    expect(entry).toBe(pageEntry as unknown);
    expect(typeof entry.getInstances).toBe('function');
    expect(Object.keys(window.components!)).toEqual([TAG]); // global `responsive` became non-enumerable
    const el = make();
    expect(el.label).toBe('tag-early');
    expect(el.isCompact).toBe(true);
  });

  it('a page setter re-evaluates existing instances (one batch, diffed)', async () => {
    registerComponent(TAG, RespElement as unknown as CustomElementConstructor, { config: { name: 'x', version: '1' }, shouldAutoDefine: false });
    const a = make();
    const b = make();
    a.calls.length = 0;
    b.calls.length = 0;
    comps()[TAG].responsive = { desktop: { label: 'L', isCompact: true } };
    await a.whenSettled();
    await b.whenSettled();
    expect(a.calls).toEqual(['update:isCompact,label']);
    expect(b.calls).toEqual(['update:isCompact,label']);
    comps()[TAG].responsive = { desktop: { label: 'L', isCompact: true } }; // same result
    await Promise.resolve();
    expect(a.calls).toHaveLength(1);
  });

  it('per-tag rules only reach their own tag', () => {
    class Other extends RespElement {}
    define('resp-other-element', Other as unknown as CustomElementConstructor);
    registerComponent(TAG, RespElement as unknown as CustomElementConstructor, { config: { name: 'x', version: '1' }, shouldAutoDefine: false });
    const other = make(`<resp-other-element></resp-other-element>`);
    comps()[TAG].responsive = { desktop: { label: 'mine' } };
    expect(other.label).toBe('x');
  });
});

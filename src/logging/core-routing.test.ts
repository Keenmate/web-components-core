/**
 * Core's own messages go through loggers (SPEC §12.1): instance line format,
 * the CORE fallback, default `warn`, the page-wide `window.components.logging`
 * switch, and every former direct-`console` call site.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// jsdom has no layout — the menu only needs anchor() to exist.
vi.mock('../positioning/anchor.js', () => ({
  anchor: vi.fn(() => ({ update: vi.fn(), destroy: vi.fn() })),
}));

import { BlissElement } from '../element/bliss-element.js';
import { runBeforeCallback, runBeforeCallbackSync } from '../element/before-callback.js';
import { getMenuChildren, resolveActionItem, runAction } from '../actions/resolve.js';
import type { ActionEventDetail } from '../actions/types.js';
import { openMenu } from '../menu/open-menu.js';
import { resolveThemeSource, setThemeMode } from '../environment/theme.js';
import { getInstances, getRegisteredTags } from '../global/instances.js';
import { registerComponent } from '../global/register-component.js';
import { toInt } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';
import { createLoggers, DEFAULT_LOG_LEVEL, type LoggerBundle } from './create-loggers.js';
import { coreLogging } from './element-logger.js';
import { __resetGlobalLogging } from './global-logging.js';
import { LOG_LEVELS, getLogger } from './log-core.js';
import { consoleLine, consoleLines } from './console-line.test-util.js';

let seq = 0;
const freshTag = (): string => `route-test-${seq++}`;
let nsSeq = 0;
const freshNs = (): string => `RT${nsSeq++}`;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  // Forget any page-wide level so the next test's bundles start at their default.
  __resetGlobalLogging();
  coreLogging.resetLogging();
});

/** A component with one validated int input that can shout through `this.log`. */
function defineComponent(opts: { namespace?: string; categories?: readonly string[] } = {}) {
  const tag = freshTag();
  class El extends BlissElement {
    protected static override inputs: readonly InputDef[] = [
      { configKey: 'pageSize', attribute: 'page-size', converter: toInt({ min: 1 }), default: 10, on: 'update' },
    ];
    say(category: string, level: 'debug' | 'warn', msg: string): void {
      this.log[category]![level](msg);
    }
  }
  // Typed as the default categories for convenient access; tests with other categories don't read them.
  const bundle = opts.namespace
    ? (createLoggers(opts.namespace, opts.categories ?? ['INIT', 'DATA', 'UI']) as unknown as LoggerBundle<'INIT' | 'DATA' | 'UI'>)
    : undefined;
  registerComponent(tag, El as unknown as CustomElementConstructor, { config: { name: 'x', version: '1' }, ...(bundle ? { logging: bundle } : {}) });
  type Inst = El & { pageSize: number; say: El['say']; enableLogging(level?: string): void };
  const make = (id?: string): Inst => {
    const el = document.createElement(tag) as unknown as Inst;
    if (id) (el as unknown as HTMLElement).id = id;
    document.body.append(el as unknown as Node);
    return el;
  };
  return { tag, bundle, make };
}

describe('instance line format', () => {
  it('own bundle: [NS:INIT] #id — the tag is not repeated', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ns = freshNs();
    const { make } = defineComponent({ namespace: ns });
    const el = make('country');
    el.setAttribute('page-size', 'abc');
    expect(warn).toHaveBeenCalledOnce();
    const args = warn.mock.calls[0]!;
    expect(args[0]).toBe(`%c[${ns}:INIT]%c #country`);
    expect(String(args[1])).toContain('color:');
    expect(consoleLine(args)).toBe(`[${ns}:INIT] #country rejected invalid value for attribute page-size="abc" (expected an integer); keeping previous value`);
    expect(args[4]).toBe(10); // the kept value stays a separate (inspectable) arg
  });

  it('own bundle, no id: a running number', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ns = freshNs();
    const { make } = defineComponent({ namespace: ns });
    make().setAttribute('page-size', '0');
    expect(warn.mock.calls[0]![0]).toMatch(new RegExp(`^%c\\[${ns}:INIT\\]%c #\\d+$`));
  });

  it('the id is read per line (set after creation still shows)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { make } = defineComponent({ namespace: freshNs() });
    const el = make();
    (el as unknown as HTMLElement).id = 'late';
    el.setAttribute('page-size', 'x');
    expect(warn.mock.calls[0]![0]).toMatch(/%c #late$/);
  });

  it('no bundle registered for the tag: falls back to [CORE:ELEMENT] tag#id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tag, make } = defineComponent(); // like web-grid: no logging option
    make('main').setAttribute('page-size', 'abc');
    expect(consoleLines(warn)).toEqual([
      `[CORE:ELEMENT] ${tag}#main rejected invalid value for attribute page-size="abc" (expected an integer); keeping previous value`,
    ]);
  });

  it('a bundle without the INIT category: falls back to its first category', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ns = freshNs();
    const { make } = defineComponent({ namespace: ns, categories: ['SETUP', 'DRAW'] });
    make('g').setAttribute('page-size', 'abc');
    expect(consoleLines(warn)[0]).toMatch(new RegExp(`^\\[${ns}:SETUP\\] #g rejected`));
  });

  it('this.log without a bundle maps every category to CORE:ELEMENT', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tag, make } = defineComponent();
    make('solo').say('DRAG', 'warn', 'hello');
    expect(consoleLines(warn)).toEqual([`[CORE:ELEMENT] ${tag}#solo hello`]);
  });

  it('this.log held from before the bundle registered follows it afterwards', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tag = freshTag();
    const ns = freshNs();
    class El extends BlissElement {
      get held(): Record<string, { warn(...a: unknown[]): void }> {
        return this.log;
      }
    }
    customElements.define(tag, El as unknown as CustomElementConstructor); // built before registration
    const el = document.createElement(tag) as unknown as El;
    (el as unknown as HTMLElement).id = 'early';
    document.body.append(el as unknown as Node);
    const held = el.held; // the CORE fallback proxy
    registerComponent(tag, El as unknown as CustomElementConstructor, {
      config: { name: 'x', version: '1' },
      logging: createLoggers(ns, ['INIT', 'UI']),
    });
    held.UI!.warn('own category');
    held.DRAG!.warn('unknown category');
    expect(consoleLines(warn)).toEqual([`[${ns}:UI] #early own category`, `[${ns}:INIT] #early unknown category`]);
  });
});

describe('default level warn', () => {
  it('warnings visible, debug hidden — for component bundles and CORE', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ns = freshNs();
    const { bundle, make } = defineComponent({ namespace: ns });
    expect(bundle!.loggers.INIT.getLevel()).toBe(LOG_LEVELS.WARN);
    expect(coreLogging.loggers.ELEMENT.getLevel()).toBe(LOG_LEVELS.WARN);
    const el = make('a');
    el.say('DATA', 'debug', 'quiet');
    el.say('DATA', 'warn', 'loud');
    expect(debug).not.toHaveBeenCalled();
    expect(consoleLines(warn)).toEqual([`[${ns}:DATA] #a loud`]);
  });

  it('enableLogging() adds debug; disableLogging() silences warnings too', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { bundle, make } = defineComponent({ namespace: freshNs() });
    const el = make();
    bundle!.enableLogging();
    el.say('DATA', 'debug', 'now visible');
    expect(debug).toHaveBeenCalledOnce();
    bundle!.disableLogging();
    el.setAttribute('page-size', 'abc');
    expect(warn).not.toHaveBeenCalled();
  });

  it('a level persisted in localStorage still wins over the default', () => {
    const ns = freshNs();
    localStorage.setItem(`km-log:${ns}:INIT`, 'DEBUG');
    try {
      const bundle = createLoggers(ns);
      expect(bundle.loggers.INIT.getLevel()).toBe(LOG_LEVELS.DEBUG);
      expect(bundle.loggers.DATA.getLevel()).toBe(LOG_LEVELS.WARN);
    } finally {
      localStorage.removeItem(`km-log:${ns}:INIT`);
    }
  });

  it('a second createLoggers() for the same namespace keeps the current level', () => {
    const ns = freshNs();
    createLoggers(ns).setLogLevel('debug');
    expect(createLoggers(ns).loggers.UI.getLevel()).toBe(LOG_LEVELS.DEBUG);
    expect(getLogger(`${ns}:UI`).getLevel()).toBe(LOG_LEVELS.DEBUG);
  });
});

describe('window.components.logging (page-wide switch)', () => {
  it('is a non-enumerable key: tags-only enumeration is unaffected', () => {
    const { tag, make } = defineComponent({ namespace: freshNs() });
    make();
    const components = window.components!;
    expect(typeof components.logging?.disableLogging).toBe('function');
    expect(Object.keys(components)).not.toContain('logging');
    expect(Object.keys(components)).toContain(tag);
    for (const key in components) expect(key).not.toBe('logging');
    expect(getRegisteredTags()).not.toContain('logging');
    expect(getInstances('logging')).toEqual([]);
  });

  it('disable/enable/setLogLevel reach every bundle incl. CORE', () => {
    const a = defineComponent({ namespace: freshNs() }).bundle!;
    const b = defineComponent({ namespace: freshNs() }).bundle!;
    const g = window.components!.logging!;
    g.disableLogging();
    for (const l of [a.loggers.INIT, b.loggers.UI, coreLogging.loggers.MENU]) expect(l.getLevel()).toBe(LOG_LEVELS.SILENT);
    g.enableLogging('debug');
    for (const l of [a.loggers.DATA, b.loggers.INIT, coreLogging.loggers.THEME]) expect(l.getLevel()).toBe(LOG_LEVELS.DEBUG);
    g.setLogLevel('error');
    expect(a.loggers.UI.getLevel()).toBe(LOG_LEVELS.ERROR);
    g.enableLogging(); // default debug
    expect(b.loggers.UI.getLevel()).toBe(LOG_LEVELS.DEBUG);
  });

  it('a component registered AFTER the global call adopts the global level', () => {
    window.components!.logging!.disableLogging();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bundle, make } = defineComponent({ namespace: freshNs() });
    expect(bundle!.loggers.INIT.getLevel()).toBe(LOG_LEVELS.SILENT);
    make().setAttribute('page-size', 'abc');
    expect(warn).not.toHaveBeenCalled();
  });

  it('a later per-component call wins for that component', () => {
    const one = defineComponent({ namespace: freshNs() });
    const two = defineComponent({ namespace: freshNs() });
    window.components!.logging!.disableLogging();
    window.components![one.tag]!.logging!.setLogLevel('debug');
    expect(one.bundle!.loggers.UI.getLevel()).toBe(LOG_LEVELS.DEBUG);
    expect(two.bundle!.loggers.UI.getLevel()).toBe(LOG_LEVELS.SILENT);
  });

  it('a per-instance override still works on top of a silenced type', () => {
    const debug = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { make } = defineComponent({ namespace: freshNs() });
    window.components!.logging!.disableLogging();
    const el = make('loud');
    el.enableLogging('debug');
    el.say('UI', 'debug', 'just me');
    expect(debug).toHaveBeenCalledOnce();
  });

  it('getCategories lists NAMESPACE:CATEGORY across bundles', () => {
    const ns = freshNs();
    defineComponent({ namespace: ns, categories: ['INIT', 'FILE'] });
    const all = window.components!.logging!.getCategories();
    expect(all).toEqual(expect.arrayContaining(['CORE:ELEMENT', 'CORE:ACTIONS', 'CORE:MENU', 'CORE:THEME', `${ns}:INIT`, `${ns}:FILE`]));
  });

  // Review L-01: a bad level used to be stored first, so every later createLoggers() threw.
  it('an invalid level throws at the call and is not stored; later components still load', () => {
    const g = window.components!.logging!;
    g.setLogLevel('error');
    expect(() => g.setLogLevel('verbose' as never)).toThrow(/invalid level "verbose"/);
    const { bundle } = defineComponent({ namespace: freshNs() });
    expect(bundle!.loggers.UI.getLevel()).toBe(LOG_LEVELS.ERROR); // the last valid level
  });

  it('a bad level stored by an older copy of core is ignored at registration', () => {
    const state = (globalThis as unknown as Record<symbol, { level: unknown }>)[Symbol.for('@keenmate/web-components-core:logging')]!;
    state.level = 'verbose';
    expect(() => defineComponent({ namespace: freshNs() })).not.toThrow();
    state.level = undefined;
  });
});

describe('levels coalesce, closest first: element → type → page → warn', () => {
  it('nothing is set by default: every level falls back to warn', () => {
    const { bundle } = defineComponent({ namespace: freshNs() });
    expect(bundle!.loggers.UI.getLevel()).toBe(LOG_LEVELS.WARN);
  });

  it('a type level wins over the page level, whatever the order of the calls', () => {
    const one = defineComponent({ namespace: freshNs() });
    const two = defineComponent({ namespace: freshNs() });
    const page = window.components!.logging!;
    window.components![one.tag]!.logging!.setLogLevel('error');
    page.enableLogging('debug'); // after the type call — must not overwrite it
    expect(one.bundle!.loggers.UI.getLevel()).toBe(LOG_LEVELS.ERROR);
    expect(two.bundle!.loggers.UI.getLevel()).toBe(LOG_LEVELS.DEBUG);
    window.components![one.tag]!.logging!.resetLogging();
    expect(one.bundle!.loggers.UI.getLevel()).toBe(LOG_LEVELS.DEBUG); // follows the page again
    page.resetLogging();
    expect(one.bundle!.loggers.UI.getLevel()).toBe(LOG_LEVELS.WARN);
  });

  it('setCategoryLevel(category, null) clears just that category', () => {
    const { tag, bundle } = defineComponent({ namespace: freshNs() });
    window.components!.logging!.setLogLevel('info');
    const controls = window.components![tag]!.logging!;
    controls.setLogLevel('error');
    controls.setCategoryLevel('DATA', null);
    expect(bundle!.loggers.DATA.getLevel()).toBe(LOG_LEVELS.INFO);
    expect(bundle!.loggers.UI.getLevel()).toBe(LOG_LEVELS.ERROR);
  });

  it("a level persisted in localStorage is the category's own level", () => {
    const ns = freshNs();
    localStorage.setItem(`km-log:${ns}:UI`, 'ERROR');
    try {
      const { bundle } = defineComponent({ namespace: ns });
      window.components!.logging!.enableLogging('debug');
      expect(bundle!.loggers.UI.getLevel()).toBe(LOG_LEVELS.ERROR);
      expect(bundle!.loggers.INIT.getLevel()).toBe(LOG_LEVELS.DEBUG);
    } finally {
      localStorage.removeItem(`km-log:${ns}:UI`);
    }
  });

  it('an element level wins over its type: it can log less as well as more', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tag, make } = defineComponent({ namespace: freshNs() });
    window.components![tag]!.logging!.enableLogging('debug');
    const el = make('quiet') as ReturnType<typeof make> & { disableLogging(): void; resetLogging(): void; isLoggingEnabled: boolean };
    el.enableLogging('error');
    el.say('UI', 'debug', 'hidden');
    el.say('UI', 'warn', 'hidden too');
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(el.isLoggingEnabled).toBe(true);

    el.disableLogging(); // silent, even though the type is at debug
    el.setAttribute('page-size', 'abc'); // a core INIT warning on the element's behalf
    expect(warn).not.toHaveBeenCalled();
    expect(el.isLoggingEnabled).toBe(false);

    el.resetLogging(); // follows the type (debug) again
    el.say('UI', 'debug', 'shown');
    expect(log).toHaveBeenCalledOnce();
    expect(el.isLoggingEnabled).toBe(false);
  });

  it('isLoggingEnabled reads any level spelling; an invalid level warns and changes nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { make } = defineComponent({ namespace: freshNs() });
    const el = make('x') as ReturnType<typeof make> & { isLoggingEnabled: boolean };
    el.enableLogging('SILENT');
    expect(el.isLoggingEnabled).toBe(false);
    el.enableLogging('info');
    el.enableLogging('verbose');
    expect(el.isLoggingEnabled).toBe(true); // still info
    expect(consoleLines(warn)).toEqual([expect.stringContaining('enableLogging: invalid level "verbose"')]);
  });
});

describe('page switch next to an older copy of core', () => {
  const KEY = Symbol.for('@keenmate/web-components-core:logging');
  type State = { level: unknown; bundles: Set<unknown>; controls: Record<string, unknown> };

  it('takes over controls without resetLogging and still pushes levels to legacy bundles', () => {
    const state = (globalThis as unknown as Record<symbol, State>)[KEY]!;
    const ours = state.controls;
    const legacyControls = { enableLogging() {}, disableLogging() {}, setLogLevel() {}, getCategories: () => [] };
    state.controls = legacyControls;
    Object.defineProperty(window.components!, 'logging', { value: legacyControls, configurable: true, enumerable: false });
    const pushed: unknown[] = [];
    const legacy = { namespace: 'OLD', LOGGING_CATEGORIES: ['INIT'], setLogLevel: (l: unknown) => pushed.push(l) };
    state.bundles.add(legacy);
    try {
      defineComponent({ namespace: freshNs() }); // a newer copy registers → takes over
      const page = window.components!.logging!;
      expect(typeof page.resetLogging).toBe('function');
      expect(page).toBe(state.controls);
      expect(pushed).toEqual([]); // no page level yet → the legacy bundle keeps its own
      page.setLogLevel('error');
      page.resetLogging();
      expect(pushed).toEqual(['error', 'warn']);
    } finally {
      state.bundles.delete(legacy);
      state.controls = ours;
      Object.defineProperty(window.components!, 'logging', { value: ours, configurable: true, enumerable: false });
    }
  });
});

describe('former console call sites', () => {
  it('BlissElement: a throwing on<Name> twin → the element UI logger', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ns = freshNs();
    const tag = freshTag();
    class El extends BlissElement<{ select: object }> {
      protected static override events = ['select'];
      fire(): void {
        this.emit('select', {});
      }
    }
    registerComponent(tag, El as unknown as CustomElementConstructor, { config: { name: 'x', version: '1' }, logging: createLoggers(ns) });
    const el = document.createElement(tag) as unknown as El & { onSelect: unknown };
    el.id = 'ms';
    document.body.append(el as unknown as Node);
    const boom = new Error('boom');
    el.onSelect = () => {
      throw boom;
    };
    el.fire();
    expect(consoleLines(error)).toEqual([`[${ns}:UI] #ms onSelect handler threw`]);
    expect(error.mock.calls[0]).toContain(boom); // the Error stays a separate arg
  });

  it('BlissElement: an invalid property assignment → INIT', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ns = freshNs();
    const { make } = defineComponent({ namespace: ns });
    const el = make('p');
    el.pageSize = -5;
    expect(consoleLines(warn)).toEqual([`[${ns}:INIT] #p rejected invalid value for property "pageSize"; keeping previous value`]);
  });

  it('resolveActionItem / getMenuChildren: through the ctx element, else CORE:ACTIONS', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ns = freshNs();
    const { make } = defineComponent({ namespace: ns });
    const el = make('tv') as unknown as HTMLElement;
    const ctx = Object.defineProperty({}, 'element', { value: el, enumerable: false });
    resolveActionItem({ text: 's', getTextCallback: () => { throw new Error('x'); } }, ctx);
    resolveActionItem({ text: 's', getTextCallback: () => { throw new Error('x'); } }, { name: 'plain' });
    await getMenuChildren({ getChildrenCallback: () => { throw new Error('y'); } }, {}, el);
    expect(consoleLines(error)).toEqual([
      `[${ns}:UI] #tv action item getTextCallback threw — using the static value`,
      '[CORE:ACTIONS] action item getTextCallback threw — using the static value',
      `[${ns}:UI] #tv action item getChildrenCallback threw — using the static value`,
    ]);
  });

  it('runAction: onClick / built-in throws → the detail element', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ns = freshNs();
    const { make } = defineComponent({ namespace: ns });
    const el = make('dp') as unknown as HTMLElement;
    const detail = Object.defineProperty(
      { action: 'today', item: { action: 'today', onClick: () => { throw new Error('a'); } } },
      'element',
      { value: el, enumerable: false },
    ) as unknown as ActionEventDetail<unknown, string>;
    await runAction({ detail, emitAction: () => {}, runBuiltIn: () => { throw new Error('b'); } });
    expect(consoleLines(error)).toEqual([
      `[${ns}:UI] #dp action item onClick threw`,
      `[${ns}:UI] #dp built-in action "today" threw`,
    ]);
  });

  it('runBeforeCallback*: through the ctx element, else CORE:ELEMENT', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ns = freshNs();
    const { make } = defineComponent({ namespace: ns });
    const el = make('ms') as unknown as HTMLElement;
    const ctx = Object.defineProperty({}, 'element', { value: el, enumerable: false });
    await runBeforeCallback(() => { throw new Error('x'); }, ctx, 'beforeDeleteCallback');
    await runBeforeCallback(() => { throw new Error('x'); }, {}, 'beforeDeleteCallback');
    runBeforeCallbackSync(async () => true, ctx, 'beforeDragStartCallback');
    expect(consoleLines(error)).toEqual([
      `[${ns}:UI] #ms beforeDeleteCallback threw — treated as reject`,
      '[CORE:ELEMENT] beforeDeleteCallback threw — treated as reject',
    ]);
    expect(consoleLines(warn)).toEqual([
      `[${ns}:UI] #ms beforeDragStartCallback must be synchronous here; a returned Promise is ignored (continuing) — resolving to false cannot cancel`,
    ]);
  });

  it('openMenu: a runAction throw → the component owning the host', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ns = freshNs();
    const { make } = defineComponent({ namespace: ns });
    const el = make('menu-owner') as unknown as HTMLElement;
    const shadow = el.attachShadow({ mode: 'open' });
    const container = document.createElement('div');
    shadow.append(container);
    const handle = openMenu([{ id: 'a', text: 'A' }], {}, {
      at: { x: 0, y: 0 },
      host: container, // a plain element inside the component's shadow root
      runAction: () => {
        throw new Error('r');
      },
    });
    shadow.querySelector<HTMLElement>('.km-menu__item')!.click();
    handle.close();
    expect(consoleLines(error)).toEqual([`[${ns}:UI] #menu-owner menu runAction threw`]);
  });

  it('theme: setThemeMode (no element) → [CORE:THEME]; a bad theme-source → the host element', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setThemeMode('sepia' as never);
    const ns = freshNs();
    const { make } = defineComponent({ namespace: ns });
    resolveThemeSource(make('th') as unknown as HTMLElement, '[[nope');
    expect(consoleLines(warn)).toEqual([
      `[CORE:THEME] setThemeMode: unknown mode "sepia"; expected 'dark', 'light' or 'auto'`,
      `[${ns}:INIT] #th theme-source "[[nope" is not a valid selector; using the page`,
    ]);
  });
});

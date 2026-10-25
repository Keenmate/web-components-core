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
  coreLogging.setLogLevel(DEFAULT_LOG_LEVEL);
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
    expect(consoleLine(args)).toBe(`[${ns}:INIT] #country rejected invalid value for attribute page-size="abc" (not a number); keeping previous value`);
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
      `[CORE:ELEMENT] ${tag}#main rejected invalid value for attribute page-size="abc" (not a number); keeping previous value`,
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
});

describe('default level warn', () => {
  it('warnings visible, debug hidden — for component bundles and CORE', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
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
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
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
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
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
      `[${ns}:UI] #ms beforeDeleteCallback threw — treated as cancel`,
      '[CORE:ELEMENT] beforeDeleteCallback threw — treated as cancel',
    ]);
    expect(consoleLines(warn)).toEqual([
      `[${ns}:UI] #ms beforeDragStartCallback must be synchronous; a returned Promise is ignored (continuing)`,
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
    shadow.querySelector<HTMLElement>('.bliss-menu__item')!.click();
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

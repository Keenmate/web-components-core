import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from '../element/bliss-element.js';
import { createLoggers } from '../logging/create-loggers.js';
import { getInstances, getRegisteredTags } from './instances.js';
import { registerComponent } from './register-component.js';

let seq = 0;
/** A fresh tag per test so the global registry / customElements never collide. */
function freshTag(): string {
  return `reg-test-${seq++}`;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('registerComponent', () => {
  it('publishes to window.components and auto-defines the element', () => {
    const tag = freshTag();
    class El extends BlissElement {}
    const entry = registerComponent(tag, El as unknown as CustomElementConstructor, {
      config: { name: '@keenmate/x', version: '1.2.3', author: 'KM' },
    });

    expect(window.components?.[tag]).toBe(entry);
    expect(entry.version()).toBe('1.2.3');
    expect(entry.config.author).toBe('KM');
    expect(customElements.get(tag)).toBe(El); // auto-defined
    // The page-wide loader hook is published as a non-enumerable accessor (SPEC §12.14).
    const desc = Object.getOwnPropertyDescriptor(window.components!, 'renderLoaderCallback');
    expect(desc?.enumerable).toBe(false);
    expect(Object.keys(window.components!).every((k) => k.includes('-'))).toBe(true);
  });

  it('shouldAutoDefine:false leaves the element undefined until register()', () => {
    const tag = freshTag();
    class El extends BlissElement {}
    const entry = registerComponent(tag, El as unknown as CustomElementConstructor, {
      config: { name: 'x', version: '0.0.0' },
      shouldAutoDefine: false,
    });
    expect(customElements.get(tag)).toBeUndefined();
    entry.register();
    expect(customElements.get(tag)).toBe(El);
  });

  it('flattens a LoggerBundle into logging controls', () => {
    const tag = freshTag();
    class El extends BlissElement {}
    const logging = createLoggers('REGTEST', ['INIT', 'DATA']);
    const spy = vi.spyOn(logging, 'setCategoryLevel');
    const entry = registerComponent(tag, El as unknown as CustomElementConstructor, {
      config: { name: 'x', version: '1' },
      logging,
    });

    expect(entry.logging?.getCategories()).toEqual(['INIT', 'DATA']);
    entry.logging?.setCategoryLevel('DATA', 'debug');
    expect(spy).toHaveBeenCalledWith('DATA', 'debug');
    spy.mockRestore();
    entry.logging?.setCategoryLevel('REGTEST:INIT', 'error'); // the namespaced form works too
    expect(logging.loggers.INIT.getLevel()).toBe(4); // error
  });

  it('omits logging when no bundle is supplied', () => {
    const tag = freshTag();
    class El extends BlissElement {}
    const entry = registerComponent(tag, El as unknown as CustomElementConstructor, {
      config: { name: 'x', version: '1' },
    });
    expect(entry.logging).toBeUndefined();
  });
});

describe('live-instance registry', () => {
  it('tracks instances on connect and drops them on disconnect', () => {
    const tag = freshTag();
    class El extends BlissElement {}
    registerComponent(tag, El as unknown as CustomElementConstructor, {
      config: { name: 'x', version: '1' },
    });

    expect(getInstances(tag)).toEqual([]);

    const a = document.createElement(tag);
    const b = document.createElement(tag);
    document.body.append(a, b);
    expect(getInstances(tag)).toEqual([a, b]);
    expect(window.components?.[tag]?.getInstances()).toEqual([a, b]);
    expect(getRegisteredTags()).toContain(tag);

    a.remove();
    expect(getInstances(tag)).toEqual([b]);
    b.remove();
    expect(getInstances(tag)).toEqual([]);
    expect(getRegisteredTags()).not.toContain(tag);
  });

  it('per-instance logging: enableLogging() makes only that element loud', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const tag = freshTag();
    // Expose this.log through a tiny method so the test can drive it.
    class El extends BlissElement {
      shout(): void {
        this.log.DATA!.debug('hi');
      }
    }
    const logging = createLoggers('PERINST', ['DATA']);
    logging.disableLogging(); // type-level silent
    registerComponent(tag, El as unknown as CustomElementConstructor, {
      config: { name: 'x', version: '1' },
      logging,
    });

    const a = document.createElement(tag) as unknown as El & { shout(): void; enableLogging(): void; disableLogging(): void };
    const b = document.createElement(tag) as unknown as El & { shout(): void };
    document.body.append(a as unknown as Node, b as unknown as Node);

    a.shout();
    b.shout();
    expect(spy).not.toHaveBeenCalled(); // type silent, no overrides

    a.enableLogging(); // overlay picks element a
    a.shout();
    b.shout();
    expect(spy).toHaveBeenCalledOnce(); // only a
    // Own bundle → the tag is dropped from the instance part (the namespace already names it).
    expect(spy.mock.calls[0]![0]!).toMatch(/^%c\[PERINST:DATA\]%c #\d+$/);

    a.disableLogging();
    a.shout();
    expect(spy).toHaveBeenCalledOnce(); // back to silent
  });

  it('the instance log label prefers the element id, else a counter', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const tag = freshTag();
    class El extends BlissElement {
      shout(): void {
        this.log.DATA!.debug('hi');
      }
    }
    const logging = createLoggers('LABELID', ['DATA']);
    logging.disableLogging();
    registerComponent(tag, El as unknown as CustomElementConstructor, {
      config: { name: 'x', version: '1' },
      logging,
    });

    const named = document.createElement(tag) as unknown as El & { shout(): void; enableLogging(): void };
    named.id = 'country-picker';
    const anon = document.createElement(tag) as unknown as El & { shout(): void; enableLogging(): void };
    document.body.append(named as unknown as Node, anon as unknown as Node);

    named.enableLogging();
    named.shout();
    expect(spy.mock.calls[0]![0]!).toBe('%c[LABELID:DATA]%c #country-picker');

    anon.enableLogging();
    anon.shout();
    expect(spy.mock.calls[1]![0]!).toMatch(/^%c\[LABELID:DATA\]%c #\d+$/);
  });

  it('a DOM move re-tracks the same instance without duplicating it', () => {
    const tag = freshTag();
    class El extends BlissElement {}
    registerComponent(tag, El as unknown as CustomElementConstructor, {
      config: { name: 'x', version: '1' },
    });
    const host1 = document.createElement('div');
    const host2 = document.createElement('div');
    document.body.append(host1, host2);

    const el = document.createElement(tag);
    host1.append(el);
    expect(getInstances(tag)).toEqual([el]);
    host2.append(el); // move: disconnect then reconnect
    expect(getInstances(tag)).toEqual([el]);
  });
});

// Review V-02 / V-03 / L-11: every component bundles its own copy of core.
describe('two copies of core on one page', () => {
  it('getInstances() / getRegisteredTags() from another copy see this copy’s elements', async () => {
    const tag = freshTag();
    class El extends BlissElement {}
    registerComponent(tag, El as unknown as CustomElementConstructor, { config: { name: 'x', version: '1' } });
    const el = document.createElement(tag);
    document.body.append(el);
    vi.resetModules();
    const other = await import('./instances.js'); // a second module instance = another bundle
    expect(other.getInstances).not.toBe(getInstances);
    expect(other.getInstances(tag)).toEqual([el]);
    expect(other.getRegisteredTags()).toContain(tag);
  });

  it('a second copy registering an already-defined tag keeps the first entry and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tag = freshTag();
    class First extends BlissElement {}
    const logging = createLoggers(`TWICE${seq}`);
    const first = registerComponent(tag, First as unknown as CustomElementConstructor, { config: { name: 'x', version: '2.0.0' }, logging });
    const el = document.createElement(tag);
    document.body.append(el);

    vi.resetModules();
    const otherCore = await import('./register-component.js');
    const otherBase = await import('../element/bliss-element.js');
    class Second extends otherBase.BlissElement {}
    const second = otherCore.registerComponent(tag, Second as unknown as CustomElementConstructor, { config: { name: 'x', version: '1.9.0' } });

    expect(second).toBe(first);
    expect(window.components![tag]).toBe(first);
    expect(first.version()).toBe('2.0.0');
    expect(first.logging).toBeDefined();
    expect(first.getInstances()).toEqual([el]);
    expect(warn.mock.calls.some((args) => args.some((x) => String(x).includes('a second copy (version 1.9.0) was ignored')))).toBe(true);
    warn.mockRestore();
  });

  it('registering the SAME class again still updates the entry (HMR / re-import)', () => {
    const tag = freshTag();
    class El extends BlissElement {}
    registerComponent(tag, El as unknown as CustomElementConstructor, { config: { name: 'x', version: '1' } });
    const again = registerComponent(tag, El as unknown as CustomElementConstructor, { config: { name: 'x', version: '1.0.1' } });
    expect(again.version()).toBe('1.0.1');
  });
});

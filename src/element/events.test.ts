import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { normalizeEventDefs, defaultEventProperty } from './events.js';
import { consoleLines } from '../logging/console-line.test-util.js';

let seq = 0;
function freshTag(): string {
  return `evt-test-${seq++}`;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('normalizeEventDefs', () => {
  it('expands bare names and resolves the default on<Name> property', () => {
    expect(normalizeEventDefs(['select', 'date-select'])).toEqual([
      { name: 'select', property: 'onSelect', bubbles: undefined, composed: undefined, cancelable: undefined },
      { name: 'date-select', property: 'onDateSelect', bubbles: undefined, composed: undefined, cancelable: undefined },
    ]);
  });

  it('honors explicit property override and property:false', () => {
    const [a, b] = normalizeEventDefs([
      { name: 'change', property: 'onValueChange' },
      { name: 'internal', property: false },
    ]);
    expect(a!.property).toBe('onValueChange');
    expect(b!.property).toBeNull();
  });

  it('defaultEventProperty PascalCases kebab names', () => {
    expect(defaultEventProperty('file-status-changed')).toBe('onFileStatusChanged');
  });
});

describe('emit', () => {
  it('dispatches a bubbling, non-composed CustomEvent by default', () => {
    const tag = freshTag();
    class El extends BlissElement<{ select: { option: string } }> {
      protected static override events = ['select'];
      fire(o: string): void {
        this.emit('select', { option: o });
      }
    }
    customElements.define(tag, El as unknown as CustomElementConstructor);

    const el = document.createElement(tag) as unknown as El;
    document.body.append(el as unknown as Node);
    const outer = vi.fn();
    document.body.addEventListener('select', outer); // bubbles → reaches ancestor

    el.fire('a');
    expect(outer).toHaveBeenCalledOnce();
    const evt = outer.mock.calls[0]![0] as CustomEvent<{ option: string }>;
    expect(evt.detail.option).toBe('a');
    expect(evt.bubbles).toBe(true);
    expect(evt.composed).toBe(false);
  });

  it('applies per-event dispatch overrides from the table', () => {
    const tag = freshTag();
    class El extends BlissElement<{ ping: undefined }> {
      protected static override events = [{ name: 'ping', bubbles: false }];
      fire(): void {
        this.emit('ping');
      }
    }
    customElements.define(tag, El as unknown as CustomElementConstructor);

    const el = document.createElement(tag) as unknown as El;
    document.body.append(el as unknown as Node);
    const onEl = vi.fn();
    const onBody = vi.fn();
    el.addEventListener('ping', onEl);
    document.body.addEventListener('ping', onBody);

    el.fire();
    expect(onEl).toHaveBeenCalledOnce();
    expect(onBody).not.toHaveBeenCalled(); // bubbles:false → does not reach ancestor
  });
});

describe('managed on<Name> handler property', () => {
  it('assigning a handler makes it the on* twin: called with the detail, before the DOM event, same object', () => {
    const tag = freshTag();
    class El extends BlissElement<{ select: { option: string } }> {
      protected static override events = ['select'];
      fire(o: string): void {
        this.emit('select', { option: o });
      }
    }
    customElements.define(tag, El as unknown as CustomElementConstructor);

    const el = document.createElement(tag) as unknown as El & { onSelect: ((d: unknown) => void) | null };
    document.body.append(el as unknown as Node);

    const order: string[] = [];
    const handler = vi.fn(() => order.push('twin'));
    const listener = vi.fn(() => order.push('event'));
    el.onSelect = handler;
    el.addEventListener('select', listener);
    el.fire('x');
    expect(order).toEqual(['twin', 'event']);
    const detail = (handler.mock.calls[0] as unknown[])[0] as { option: string };
    expect(detail.option).toBe('x');
    expect(((listener.mock.calls[0] as unknown[])[0] as CustomEvent).detail).toBe(detail);
    expect(el.onSelect).toBe(handler); // getter returns the assigned twin
  });

  it('a throwing twin is logged and the DOM event still fires', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tag = freshTag();
    class El extends BlissElement<{ select: { option: string } }> {
      protected static override events = ['select'];
      fire(): void {
        this.emit('select', { option: 'a' });
      }
    }
    customElements.define(tag, El as unknown as CustomElementConstructor);
    const el = document.createElement(tag) as unknown as El & { onSelect: unknown };
    document.body.append(el as unknown as Node);
    el.onSelect = () => {
      throw new Error('boom');
    };
    const listener = vi.fn();
    el.addEventListener('select', listener);
    el.fire();
    expect(listener).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('reassigning replaces the previous listener; null removes it', () => {
    const tag = freshTag();
    class El extends BlissElement<{ select: undefined }> {
      protected static override events = ['select'];
      fire(): void {
        this.emit('select');
      }
    }
    customElements.define(tag, El as unknown as CustomElementConstructor);

    const el = document.createElement(tag) as unknown as El & { onSelect: ((e: Event) => void) | null };
    document.body.append(el as unknown as Node);

    const first = vi.fn();
    const second = vi.fn();
    el.onSelect = first;
    el.onSelect = second; // replaces first
    el.fire();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();

    el.onSelect = null; // removes
    el.fire();
    expect(second).toHaveBeenCalledOnce();
    expect(el.onSelect).toBeNull();
  });

  // Review I-13.
  it('assigning something that is not a function warns and keeps the handler', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tag = freshTag();
    class El extends BlissElement<{ select: undefined }> {
      protected static override events = ['select'];
    }
    customElements.define(tag, El as unknown as CustomElementConstructor);
    const el = document.createElement(tag) as unknown as El & { onSelect: unknown };
    const handler = vi.fn();
    el.onSelect = handler;
    el.onSelect = 'doSomething()';
    expect(el.onSelect).toBe(handler);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('property:false exposes the event with no managed property', () => {
    const tag = freshTag();
    class El extends BlissElement<{ internal: undefined }> {
      protected static override events = [{ name: 'internal', property: false as const }];
    }
    customElements.define(tag, El as unknown as CustomElementConstructor);
    const el = document.createElement(tag) as unknown as Record<string, unknown>;
    expect('onInternal' in el).toBe(false);
  });
});

describe('component context on event details', () => {
  interface Ctl {
    ping(): string;
  }
  class El extends BlissElement<{ select: { option: string }; ready: Record<string, never> }, Ctl> {
    protected static override events = ['select', 'ready'];
    presentation = 'floating';
    protected override createController(): Ctl {
      return { ping: () => 'pong' };
    }
    protected override eventContext(): object {
      return { presentation: this.presentation, isFullscreen: this.presentation === 'fullscreen' };
    }
    fire(detail?: { option: string; presentation?: string }): void {
      if (detail) this.emit('select', detail);
      else this.emit('ready');
    }
  }
  const tag = freshTag();
  customElements.define(tag, El as unknown as CustomElementConstructor);

  function make(): El {
    const el = document.createElement(tag) as unknown as El;
    document.body.append(el as unknown as Node);
    return el;
  }

  it('attaches controller + element non-enumerable, extras enumerable', () => {
    const el = make();
    const listener = vi.fn();
    el.addEventListener('select', listener);
    el.fire({ option: 'a' });
    const detail = (listener.mock.calls[0]![0] as CustomEvent).detail;
    expect(detail.controller.ping()).toBe('pong');
    expect(detail.controller).toBe(el.controller); // memoized facade
    expect(detail.element).toBe(el);
    const { controller, element } = detail; // destructuring works
    expect(controller).toBe(el.controller);
    expect(element).toBe(el);
    expect(Object.keys(detail)).toEqual(['option', 'presentation', 'isFullscreen']);
    expect(JSON.parse(JSON.stringify(detail))).toEqual({ option: 'a', presentation: 'floating', isFullscreen: false });
  });

  it('a field the detail already has wins over the component-wide extra', () => {
    const el = make();
    const listener = vi.fn();
    el.addEventListener('select', listener);
    el.fire({ option: 'a', presentation: 'fullscreen' });
    expect((listener.mock.calls[0]![0] as CustomEvent).detail.presentation).toBe('fullscreen');
  });

  it('an event without a detail still carries the context', () => {
    const el = make();
    const listener = vi.fn();
    el.addEventListener('ready', listener);
    el.fire();
    const detail = (listener.mock.calls[0]![0] as CustomEvent).detail;
    expect(detail.element).toBe(el);
    expect(detail.controller.ping()).toBe('pong');
  });

  it('the caller\'s plain-object detail is never mutated; a re-emit gets fresh extras', () => {
    const el = make();
    const listener = vi.fn();
    el.addEventListener('select', listener);
    const data = { option: 'a' };
    el.fire(data);
    expect(Object.keys(data)).toEqual(['option']);
    expect('element' in data).toBe(false);
    el.presentation = 'fullscreen';
    el.fire(data);
    const second = (listener.mock.calls[1]![0] as CustomEvent).detail;
    expect(second.presentation).toBe('fullscreen');
    expect(second.isFullscreen).toBe(true);
  });

  it('the copy keeps non-enumerable fields and getters the detail already had', () => {
    const el = make();
    const listener = vi.fn();
    el.addEventListener('select', listener);
    const own = {};
    const detail = { option: 'a' } as { option: string; element?: unknown; presentation?: string };
    Object.defineProperty(detail, 'element', { value: own, enumerable: false });
    Object.defineProperty(detail, 'presentation', { get: () => 'modal', enumerable: true });
    el.fire(detail as { option: string });
    const got = (listener.mock.calls[0]![0] as CustomEvent).detail;
    expect(got).not.toBe(detail);
    expect(got.element).toBe(own);
    expect(got.presentation).toBe('modal');
    expect(Object.keys(got)).toEqual(['option', 'presentation', 'isFullscreen']);
  });

  it('the on<Name> twin and the event get the same (copied) object', () => {
    const el = make() as El & { onSelect?: (d: unknown) => void };
    const seen: unknown[] = [];
    el.onSelect = (d) => seen.push(d);
    el.addEventListener('select', (e) => seen.push((e as CustomEvent).detail));
    el.fire({ option: 'a' });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it('a frozen detail is copied, not mutated', () => {
    const el = make();
    const listener = vi.fn();
    el.addEventListener('select', listener);
    const frozen = Object.freeze({ option: 'f' });
    el.fire(frozen);
    const detail = (listener.mock.calls[0]![0] as CustomEvent).detail;
    expect(detail).not.toBe(frozen);
    expect(detail.option).toBe('f');
    expect(detail.element).toBe(el);
  });

  it('controller is undefined for a component without createController', () => {
    const t = freshTag();
    class Plain extends BlissElement {}
    customElements.define(t, Plain as unknown as CustomElementConstructor);
    const el = document.createElement(t) as unknown as Plain;
    expect(el.controller).toBeUndefined();
  });
});

describe('on() typed subscription', () => {
  it('adds a listener and returns an unsubscribe', () => {
    const tag = freshTag();
    class El extends BlissElement<{ change: { n: number } }> {
      protected static override events = ['change'];
      fire(n: number): void {
        this.emit('change', { n });
      }
      listen(h: (e: CustomEvent<{ n: number }>) => void): () => void {
        return this.on('change', h);
      }
    }
    customElements.define(tag, El as unknown as CustomElementConstructor);

    const el = document.createElement(tag) as unknown as El;
    document.body.append(el as unknown as Node);
    const handler = vi.fn();
    const off = el.listen(handler);
    el.fire(1);
    off();
    el.fire(2);
    expect(handler).toHaveBeenCalledOnce();
    expect((handler.mock.calls[0]![0] as CustomEvent<{ n: number }>).detail.n).toBe(1);
  });
});

describe('runHook', () => {
  class Host extends BlissElement {
    protected static override inputs = [
      { configKey: 'beforeSelectCallback', on: 'none' as const },
    ];
    run<R>(ctx: unknown, opts: { whenUnset: R; errorCallback?: (e: unknown) => R }): Promise<R> {
      return this.runHook('beforeSelectCallback', ctx, opts);
    }
  }
  const hostTag = freshTag();
  customElements.define(hostTag, Host as unknown as CustomElementConstructor);

  function makeHost(): Host & { beforeSelectCallback?: unknown } {
    const el = document.createElement(hostTag) as unknown as Host & { beforeSelectCallback?: unknown };
    document.body.append(el as unknown as Node);
    return el;
  }

  it('returns whenUnset when no callback is set', async () => {
    const el = makeHost();
    await expect(el.run({}, { whenUnset: { action: 'accept' } })).resolves.toEqual({ action: 'accept' });
  });

  it('calls the callback with a single ctx and normalizes a sync result', async () => {
    const el = makeHost();
    el.beforeSelectCallback = (ctx: { date: number }) => ({ action: 'adjust', date: ctx.date + 1 });
    await expect(el.run({ date: 1 }, { whenUnset: { action: 'accept' } })).resolves.toEqual({ action: 'adjust', date: 2 });
  });

  it('awaits an async (Promise) result', async () => {
    const el = makeHost();
    el.beforeSelectCallback = async () => ({ action: 'block' });
    await expect(el.run({}, { whenUnset: { action: 'accept' } })).resolves.toEqual({ action: 'block' });
  });

  it('routes a throw to errorCallback when provided', async () => {
    const el = makeHost();
    el.beforeSelectCallback = () => {
      throw new Error('boom');
    };
    await expect(
      el.run({}, { whenUnset: { action: 'accept' }, errorCallback: () => ({ action: 'restore' }) }),
    ).resolves.toEqual({ action: 'restore' });
  });

  it('re-throws when no errorCallback is given (no silent swallow)', async () => {
    const el = makeHost();
    el.beforeSelectCallback = () => {
      throw new Error('boom');
    };
    await expect(el.run({}, { whenUnset: { action: 'accept' } })).rejects.toThrow('boom');
  });
});

describe('event-table lint (warn-only)', () => {
  it('warns on uppercase names, duplicates, and property/input collisions', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tag = freshTag();
    class El extends BlissElement {
      protected static override inputs = [{ configKey: 'onSelect', on: 'none' as const }];
      protected static override events = ['Select', 'change', 'change', 'select', 'copy', 'pointerdown'];
    }
    customElements.define(tag, El as unknown as CustomElementConstructor);
    document.body.append(document.createElement(tag)); // construct → validate once

    const messages = consoleLines(warn);
    expect(messages.join('\n')).toMatch(/event "Select" should be lowercase/);
    expect(messages.join('\n')).toMatch(/duplicate event "change"/);
    expect(messages.join('\n')).toMatch(/property "onSelect" collides with an input configKey/);
    expect(messages.join('\n')).toMatch(/event "copy" reuses a composed native event name/);
    expect(messages.join('\n')).toMatch(/event "pointerdown" reuses a composed native event name/);
    expect(messages.join('\n')).not.toMatch(/event "change" reuses/);
    warn.mockRestore();
  });
});

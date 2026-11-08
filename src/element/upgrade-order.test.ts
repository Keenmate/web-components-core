import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { toText } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';
import { consoleLines } from '../logging/console-line.test-util.js';

// Review 2026-11-03 (WP3): upgrade order and the core-declared properties.

let seq = 0;
const tagName = (): string => `upgrade-order-${seq++}`;

class Labelled extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'label', attribute: 'label', converter: toText({ default: '' }), on: 'update' },
  ];
  reinits = 0;
  updates: Array<Record<string, unknown>> = [];
  protected override reinit(): void {
    this.reinits += 1;
  }
  protected override update(partial: Record<string, unknown>): void {
    this.updates.push({ ...partial });
  }
}
type El = Labelled & Record<string, unknown>;

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('upgrade order', () => {
  it('motion and themeSource assigned before upgrade are applied (E-04)', () => {
    const tag = tagName();
    const el = document.createElement(tag) as unknown as El;
    el.motion = 'none';
    el.themeSource = '#theme-root';
    document.body.append(el as unknown as Node);
    customElements.define(tag, class extends Labelled {} as unknown as CustomElementConstructor);
    expect(el.motion).toBe('none');
    expect(el.getAttribute('motion')).toBe('none');
    expect(el.getAttribute('theme-source')).toBe('#theme-root');
  });

  it('a pre-upgrade property wins over the initial attribute, but a later setAttribute() still applies (E-11)', () => {
    const tag = tagName();
    const el = document.createElement(tag) as unknown as El;
    el.label = 'from-property';
    el.setAttribute('label', 'from-markup');
    customElements.define(tag, class extends Labelled {} as unknown as CustomElementConstructor);
    customElements.upgrade(el as unknown as Node); // detached: upgraded, not connected yet
    expect(el.label).toBe('from-property');
    el.setAttribute('label', 'later'); // a real write before the first connect
    expect(el.label).toBe('later');
  });

  it('setAttributes({ shouldDefer: false, … }) builds once, with every value (E-10)', () => {
    const tag = tagName();
    customElements.define(tag, class extends Labelled {} as unknown as CustomElementConstructor);
    const el = document.createElement(tag) as unknown as El;
    el.setAttribute('defer', '');
    document.body.append(el as unknown as Node);
    expect(el.reinits).toBe(0);
    el.setAttributes({ shouldDefer: false, label: 'x' });
    expect(el.reinits).toBe(1);
    expect(el.updates).toEqual([]);
    expect(el.label).toBe('x');
  });
});

describe('input table check (E-16)', () => {
  it('warns about an unknown `on` value and a configKey that hides a core member', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tag = tagName();
    class Bad extends BlissElement {
      protected static override inputs: readonly InputDef[] = [
        { configKey: 'label', attribute: 'label', converter: toText(), on: 'rebuild' as never },
        { configKey: 'controller', converter: toText() },
      ];
    }
    customElements.define(tag, Bad as unknown as CustomElementConstructor);
    document.createElement(tag);
    const lines = consoleLines(warn).join('\n');
    expect(lines).toContain(`"label" has on: "rebuild"`);
    expect(lines).toContain(`configKey "controller" hides BlissElement's own "controller"`);
  });

  it('warns when an input has the name of a getter / method, which it silently replaces (C-A3)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tag = tagName();
    class Shadowing extends BlissElement {
      protected static override inputs: readonly InputDef[] = [
        { configKey: 'items', converter: toText() },
        { configKey: 'refresh', converter: toText() },
        { configKey: 'label', attribute: 'label', converter: toText() },
      ];
      get items(): string {
        return 'never runs';
      }
      refresh(): void {}
    }
    customElements.define(tag, Shadowing as unknown as CustomElementConstructor);
    document.createElement(tag);
    const lines = consoleLines(warn).join('\n');
    expect(lines).toContain('"items" is also a getter/setter on Shadowing');
    expect(lines).toContain('"refresh" is also a method on Shadowing');
    expect(lines).not.toContain('"label" is also');
  });
});

// Sweep C-A1 (2026-11-08): the component's own accessors (not inputs) assigned before upgrade.
describe('own accessors assigned before upgrade (value, items, …)', () => {
  class WithValue extends BlissElement {
    #value: string[] = [];
    #setCalls = 0;
    built: string[] | null = null;
    get value(): string[] {
      return this.#value;
    }
    set value(v: string[]) {
      this.#setCalls += 1; // a private field: only works once the subclass is constructed
      this.#value = v;
    }
    get setCalls(): number {
      return this.#setCalls;
    }
    get version(): string {
      return '1';
    }
    protected override reinit(): void {
      this.built = [...this.#value];
    }
  }

  it('a connected element: replayed through the setter before the first build', () => {
    const tag = tagName();
    const el = document.createElement(tag) as unknown as WithValue;
    (el as unknown as Record<string, unknown>).value = ['cz', 'sk'];
    document.body.append(el);
    customElements.define(tag, class extends WithValue {});
    expect(Object.prototype.hasOwnProperty.call(el, 'value')).toBe(false); // no shadowing own property left
    expect(el.value).toEqual(['cz', 'sk']);
    expect(el.setCalls).toBe(1);
    expect(el.built).toEqual(['cz', 'sk']); // the first build saw it
    el.value = ['de'];
    expect(el.value).toEqual(['de']); // later writes reach the setter too
  });

  it('a detached element: replayed on the next microtask', async () => {
    const tag = tagName();
    const el = document.createElement(tag) as unknown as Record<string, unknown>;
    el.value = ['a'];
    customElements.define(tag, class extends WithValue {});
    customElements.upgrade(el as unknown as Element);
    expect(Object.prototype.hasOwnProperty.call(el, 'value')).toBe(false);
    await Promise.resolve();
    expect((el as unknown as WithValue).value).toEqual(['a']);
    expect((el as unknown as WithValue).setCalls).toBe(1);
  });

  it('a read-only accessor assigned early: dropped with a warning, the getter works again', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tag = tagName();
    const el = document.createElement(tag) as unknown as Record<string, unknown>;
    el.version = '9';
    customElements.define(tag, class extends WithValue {});
    customElements.upgrade(el as unknown as Element);
    expect(el.version).toBe('1');
    expect(warn.mock.calls.map((c) => c.join(' ')).some((m) => m.includes('read-only'))).toBe(true);
  });
});

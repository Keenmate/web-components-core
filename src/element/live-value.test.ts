import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { toInt } from '../inputs/converters.js';
import type { Converter, InputDef } from '../inputs/types.js';

let seq = 0;
const toArray: Converter<string[]> = { validate: (v): v is string[] => Array.isArray(v) };

/** A component that owns its `items` state after the build (like tree nodes / grid rows). */
class LiveElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    {
      configKey: 'items',
      converter: toArray,
      default: [],
      on: 'update',
      getLiveValue: (el: LiveElement) => el.liveItems,
    },
    { configKey: 'height', attribute: 'height', converter: toInt({ default: 10 }), on: 'reinit' },
  ];
  /** Live state; `undefined` = "no live value" (getter falls back to the stored one). */
  liveItems: string[] | undefined;
  failNextReinit = false;
  get cfg(): Readonly<Record<string, unknown>> {
    return this.config;
  }
  reinits = 0;
  protected override reinit(): void {
    this.reinits += 1;
    if (this.failNextReinit) {
      this.failNextReinit = false;
      throw new Error('boom');
    }
    this.liveItems = [...(this.config.items as string[])];
  }
  protected override update(partial: Record<string, unknown>): void {
    if ('items' in partial) this.liveItems = [...(partial.items as string[])];
  }
  addItem(item: string): void {
    this.liveItems?.push(item);
  }
}

type El = LiveElement & { items: string[]; height: number };

function makeEl(): El {
  const tag = `live-value-test-${seq++}`;
  class Sub extends LiveElement {}
  customElements.define(tag, Sub as unknown as CustomElementConstructor);
  return document.createElement(tag) as unknown as El;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('InputDef.getLiveValue', () => {
  it('returns the stored value before the first build', () => {
    const el = makeEl();
    el.items = ['a'];
    expect(el.items).toEqual(['a']); // not connected → never built
  });

  it('returns the live state once built; config keeps the assigned value', () => {
    const el = makeEl();
    const assigned = ['a'];
    el.items = assigned;
    document.body.append(el);
    el.addItem('b');
    expect(el.items).toEqual(['a', 'b']);
    expect(el.cfg.items).toBe(assigned);
    expect(el.cfg.items).toEqual(['a']);
  });

  it('read-after-write returns the assigned value until the flush applies it', async () => {
    const el = makeEl();
    document.body.append(el);
    el.addItem('x');
    const next = ['n'];
    el.items = next;
    expect(el.items).toBe(next); // staged, not applied — live state is stale
    await el.whenSettled();
    el.addItem('m');
    expect(el.items).toEqual(['n', 'm']); // live again after the update
  });

  it('falls back to the stored value when getLiveValue returns undefined', () => {
    const el = makeEl();
    el.items = ['a'];
    document.body.append(el);
    el.liveItems = undefined;
    expect(el.items).toEqual(['a']);
  });

  it('holds the stored value while defer holds the first build', () => {
    const el = makeEl();
    el.setAttribute('defer', '');
    el.items = ['a'];
    el.liveItems = ['stale'];
    document.body.append(el);
    expect(el.items).toEqual(['a']);
    el.release();
    el.addItem('b');
    expect(el.items).toEqual(['a', 'b']);
  });

  it('returns the stored value after a failed reinit, live again once a rebuild succeeds', () => {
    const el = makeEl();
    el.items = ['a'];
    document.body.append(el);
    el.addItem('b');
    el.failNextReinit = true;
    expect(() => el.setAttributes({ height: 20 })).toThrow('boom');
    expect(el.items).toEqual(['a']);
    el.setAttributes({ height: 30 }); // retry succeeds → rebuilt from config
    el.addItem('c');
    expect(el.items).toEqual(['a', 'c']);
  });

  it('keeps live reads across a DOM move (no rebuild)', () => {
    const el = makeEl();
    document.body.append(el);
    el.addItem('a');
    const other = document.createElement('div');
    document.body.append(other);
    other.append(el);
    expect(el.reinits).toBe(1);
    expect(el.items).toEqual(['a']);
  });

  it('warns once per class when getLiveValue is not a function, and reads the stored value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tag = `live-value-test-${seq++}`;
    class Bad extends BlissElement {
      protected static override inputs: readonly InputDef[] = [
        { configKey: 'items', converter: toArray, default: [], getLiveValue: 42 as never },
      ];
    }
    customElements.define(tag, Bad as unknown as CustomElementConstructor);
    const el = document.createElement(tag) as unknown as { items: string[] } & Node;
    document.body.append(el);
    el.items = ['a'];
    expect(el.items).toEqual(['a']);
    expect(warn.mock.calls.flat().join(' ')).toContain('getLiveValue that is not a function');
  });

  // Review E-15: the pair can only be a mistake — the write never reaches the live state.
  it("warns once per class when getLiveValue is combined with on: 'none'", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tag = `live-value-test-${seq++}`;
    class Mixed extends BlissElement {
      protected static override inputs: readonly InputDef[] = [
        { configKey: 'items', converter: toArray, default: [], on: 'none', getLiveValue: () => ['live'] },
        { configKey: 'other', converter: toArray, default: [], on: 'update', getLiveValue: () => ['live'] },
      ];
    }
    customElements.define(tag, Mixed as unknown as CustomElementConstructor);
    document.body.append(document.createElement(tag), document.createElement(tag));
    const lines = warn.mock.calls.flat().join(' ');
    expect(lines.match(/has getLiveValue but on: 'none'/g)).toHaveLength(1); // once per class, only "items"
    expect(lines).toContain('"items" has getLiveValue');
    expect(lines).not.toContain('"other" has getLiveValue');
  });
});

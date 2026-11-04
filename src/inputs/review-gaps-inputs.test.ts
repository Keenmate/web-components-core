// Review 2026-11-03 I-18 — the test gaps the inputs review listed, closed against the
// current contract (SPEC §5 / §6). Items already covered elsewhere are not repeated here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from '../element/bliss-element.js';
import { define } from '../element/define.js';
import { runBeforeCallbackEager } from '../element/before-callback.js';
import {
  toBool,
  toBytes,
  toCssLength,
  toEnum,
  toFloat,
  toFunction,
  toInt,
  toList,
  toObject,
  toText,
  toValue,
} from './converters.js';
import type { AttrReader, Converter, InputDef } from './types.js';
import { consoleLines } from '../logging/console-line.test-util.js';

const reader: AttrReader = { getAttribute: () => null, hasAttribute: () => false };

/** Parse `raw`; `'invalid'` when the converter reported it. */
const parse = (c: Converter<unknown>, raw: string): unknown => {
  let isInvalid = false;
  const value = c.fromAttribute!(raw, reader, 'x', () => {
    isInvalid = true;
  });
  return isInvalid ? 'invalid' : value;
};

let seq = 0;
const freshTag = (): string => `i18-gap-${seq++}`;

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

// I-18 #1 — the strict-number cases not already in converters.test.ts.
describe('toInt / toFloat — remaining strict cases', () => {
  it.each([
    ['Infinity', 'invalid'],
    ['-Infinity', 'invalid'],
    ['NaN', 'invalid'],
    ['\t7\n', 7],
  ])('toInt %j → %j', (raw, expected) => expect(parse(toInt() as Converter<unknown>, raw)).toBe(expected));

  it.each([
    ['0x10', 'invalid'],
    ['1e3', 1000],
    ['12px', 'invalid'],
    ['-Infinity', 'invalid'],
  ])('toFloat %j → %j', (raw, expected) => expect(parse(toFloat() as Converter<unknown>, raw)).toBe(expected));

  it('"-5" with min: 0 is out of range on the attribute path, -5 rejected on the property path', () => {
    const c = toInt({ min: 0, default: 1 });
    expect(parse(c as Converter<unknown>, '-5')).toBe('invalid');
    expect(c.fromAttribute!('-5', reader, 'x')).toBe(1); // the fallback
    expect(c.validate!(-5)).toBe(false);
    expect(c.validate!(Infinity)).toBe(false);
    expect(toFloat().validate!(Infinity)).toBe(false);
    expect(toFloat().validate!(Number.NaN)).toBe(false);
  });
});

// I-18 #5 — toList edge cases not already in converters.test.ts.
describe('toList — remaining edge cases', () => {
  it('a trailing separator keeps an empty last string item (and round-trips); an int list rejects it', () => {
    const c = toList();
    const value = c.fromAttribute!('a,b,', reader, 'x');
    expect(value).toEqual(['a', 'b', '']);
    expect(c.fromAttribute!(c.toAttribute!(value)!, reader, 'x')).toEqual(['a', 'b', '']);
    expect(parse(toList({ itemType: 'int' }) as Converter<unknown>, '1,2,')).toBe('invalid');
  });

  it('round-trips a custom separator, and an item starting with "[" through JSON', () => {
    const pipe = toList({ separator: '|' });
    expect(pipe.toAttribute!(['a,b', 'c'])).toBe('a,b|c'); // "," is not this list's separator
    expect(pipe.fromAttribute!('a,b|c', reader, 'x')).toEqual(['a,b', 'c']);
    const c = toList();
    const attr = c.toAttribute!(['[x]', 'y'])!;
    expect(attr).toBe('["[x]","y"]');
    expect(c.fromAttribute!(attr, reader, 'x')).toEqual(['[x]', 'y']);
  });

  it('[] with a non-empty default: the property path keeps [] (not the default)', () => {
    const c = toList({ default: ['x'] });
    expect(c.validate!([])).toBe(true);
  });
});

// I-18 #6 — toBytes whitespace / case / single-letter units.
describe('toBytes — whitespace and case', () => {
  it.each([
    [' 10 MB ', 10 * 1024 ** 2],
    ['1k', 1024],
    ['1K', 1024],
    ['2Gib', 2 * 1024 ** 3],
    ['1TB', 1024 ** 4],
    ['10 m b', 'invalid'],
    ['-1kb', 'invalid'],
  ])('%j → %j', (raw, expected) => expect(parse(toBytes() as Converter<unknown>, raw)).toBe(expected));
});

// I-18 #2 / #3 / #8 — element-level behaviour per converter family.
describe('element: enum null / nullable invalid-after-valid / undefined reset per family', () => {
  class FamilyElement extends BlissElement {
    protected static override inputs: readonly InputDef[] = [
      // a plain enum with only a ROW default: absent → null ("the engine decides", by design — I-01)
      { configKey: 'mode', attribute: 'mode', converter: toEnum(['a', 'b'] as const), default: 'a' },
      { configKey: 'tone', attribute: 'tone', converter: toEnum(['x', 'y'] as const, { default: 'x' }), shouldReflect: true },
      { configKey: 'theme', attribute: 'theme', converter: toEnum(['light', 'dark'] as const, { isNullable: true }), shouldReflect: true },
      { configKey: 'label', attribute: 'label', converter: toText({ default: 'Hi' }) },
      { configKey: 'hint', attribute: 'hint', converter: toText({ isNullable: true }) },
      { configKey: 'isOn', attribute: 'is-on', converter: toBool('default-true'), default: true },
      { configKey: 'isSorted', attribute: 'is-sorted', converter: toBool('tristate') },
      { configKey: 'ratio', attribute: 'ratio', converter: toFloat({ default: 0.5 }) },
      { configKey: 'maxSize', attribute: 'max-size', converter: toBytes({ default: 1024 }) },
      { configKey: 'gap', attribute: 'gap', converter: toCssLength({ default: '1rem' }) },
      { configKey: 'tags', attribute: 'tags', converter: toList({ default: ['t'] }) },
      { configKey: 'opts', converter: toObject({ default: { a: 1 } }) },
      { configKey: 'data', converter: toValue({ default: 42 }) },
      { configKey: 'formatCallback', converter: toFunction(), default: null },
    ];
  }
  const TAG = freshTag();
  define(TAG, FamilyElement as unknown as CustomElementConstructor);
  type F = FamilyElement & Record<string, unknown>;
  const make = (html = `<${TAG}></${TAG}>`): F => {
    const host = document.createElement('div');
    host.innerHTML = html;
    const el = host.firstElementChild as unknown as F;
    document.body.append(el as unknown as Node);
    return el;
  };

  it('#2 a plain enum with only a row default resolves a missing attribute to null (by design)', () => {
    const el = make();
    expect(el.mode).toBeNull();
    el.mode = 'b';
    expect(el.mode).toBe('b');
  });

  it('#2 el.x = null on a plain (non-nullable) enum warns and keeps the previous value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make(`<${TAG} tone="y"></${TAG}>`);
    el.tone = null;
    expect(el.tone).toBe('y');
    expect(el.getAttribute('tone')).toBe('y');
    expect(consoleLines(warn).join('\n')).toMatch(/rejected invalid value for property "tone"/);
  });

  it('#3 isNullable: an invalid attribute AFTER a valid one keeps the valid value (not null) and writes it back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make(`<${TAG} theme="dark"></${TAG}>`);
    expect(el.theme).toBe('dark');
    (el as unknown as HTMLElement).setAttribute('theme', 'purple');
    await el.whenSettled();
    expect(el.theme).toBe('dark');
    expect(el.getAttribute('theme')).toBe('dark');
    expect(consoleLines(warn).join('\n')).toMatch(/theme="purple"/);
    // a nullable enum still clears by property and by removal
    el.theme = null;
    expect(el.theme).toBeNull();
  });

  it('#3 isNullable: an invalid PROPERTY after a valid one keeps the valid value', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make();
    el.theme = 'light';
    el.theme = 'purple';
    expect(el.theme).toBe('light');
  });

  it('#8 el.x = undefined resets every converter family to its absent value', async () => {
    const el = make(
      `<${TAG} label="L" hint="h" is-on="false" is-sorted="true" ratio="2" max-size="2kb" gap="4px" tags="a,b" theme="dark"></${TAG}>`,
    );
    const fn = (): string => 'x';
    el.opts = { b: 2 };
    el.data = 'other';
    el.formatCallback = fn;
    expect(el).toMatchObject({ label: 'L', hint: 'h', isOn: false, isSorted: true, ratio: 2, maxSize: 2048, gap: '4px', tags: ['a', 'b'], theme: 'dark' });
    expect(el.formatCallback).toBe(fn);

    for (const key of ['label', 'hint', 'isOn', 'isSorted', 'ratio', 'maxSize', 'gap', 'tags', 'theme', 'opts', 'data', 'formatCallback']) {
      el[key] = undefined;
    }
    await el.whenSettled();
    expect({
      label: el.label,
      hint: el.hint,
      isOn: el.isOn,
      isSorted: el.isSorted,
      ratio: el.ratio,
      maxSize: el.maxSize,
      gap: el.gap,
      tags: el.tags,
      theme: el.theme,
      opts: el.opts,
      data: el.data,
      formatCallback: el.formatCallback,
    }).toEqual({
      label: 'Hi',
      hint: null,
      isOn: true,
      isSorted: null,
      ratio: 0.5,
      maxSize: 1024,
      gap: '1rem',
      tags: ['t'],
      theme: null,
      opts: { a: 1 },
      data: 42,
      formatCallback: null,
    });
    // the reflected nullable enum drops its attribute when reset to null
    expect(el.hasAttribute('theme')).toBe(false);
  });
});

// I-18 #11.
describe('runBeforeCallbackEager — a non-Promise thenable', () => {
  it('is treated as async: returns a Promise with the same contract', async () => {
    const thenable = (value: unknown): PromiseLike<unknown> => ({
      then: (resolve) => Promise.resolve(value).then(resolve),
    });
    const rejected = runBeforeCallbackEager(() => thenable(false), {});
    expect(rejected).toBeInstanceOf(Promise);
    await expect(rejected).resolves.toEqual({ isRejected: true });
    await expect(runBeforeCallbackEager(() => thenable('v'), {})).resolves.toEqual({ isRejected: false, hasValue: true, value: 'v' });
    await expect(runBeforeCallbackEager(() => thenable(undefined), {})).resolves.toEqual({ isRejected: false, hasValue: false });
  });

  it('a thenable that rejects rejects and is logged', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing: PromiseLike<unknown> = { then: (_ok, fail) => Promise.reject(new Error('nope')).then(undefined, fail) };
    await expect(runBeforeCallbackEager(() => failing, {})).resolves.toEqual({ isRejected: true });
    expect(error).toHaveBeenCalledOnce();
  });
});

// I-18 #12 (second half): two events declaring the same `on<Name>` property.
describe('event table — two events, one property', () => {
  class TwoEvents extends BlissElement<{ open: { n: number }; show: { n: number } }> {
    protected static override events = [{ name: 'open', property: 'onOpen' }, { name: 'show', property: 'onOpen' }];
    fire(name: 'open' | 'show'): void {
      this.emit(name, { n: 1 });
    }
  }
  const TAG = freshTag();
  customElements.define(TAG, TwoEvents as unknown as CustomElementConstructor);

  it('a shared property: the later event owns it, the earlier event has no reachable twin (the table check warns)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement(TAG) as unknown as TwoEvents & { onOpen: unknown };
    document.body.append(el as unknown as Node);
    const handler = vi.fn();
    el.onOpen = handler;
    el.fire('open');
    expect(handler).not.toHaveBeenCalled();
    el.fire('show');
    expect(handler).toHaveBeenCalledOnce();
  });

  // I-18 #12 (fixed): the table check now warns when two events share one property.
  it('warns when two events declare the same property', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tag = freshTag();
    class Dup extends BlissElement {
      protected static override events = [{ name: 'open', property: 'onOpen' }, { name: 'show', property: 'onOpen' }];
    }
    customElements.define(tag, Dup as unknown as CustomElementConstructor);
    document.body.append(document.createElement(tag));
    expect(consoleLines(warn).join('\n')).toMatch(/onOpen/);
  });
});

// I-18 #14.
describe('define() — a name taken by a different constructor', () => {
  it('is skipped silently: no throw, the first class stays registered', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tag = freshTag();
    class First extends BlissElement {}
    class Second extends BlissElement {}
    define(tag, First as unknown as CustomElementConstructor);
    expect(() => define(tag, Second as unknown as CustomElementConstructor)).not.toThrow();
    expect(customElements.get(tag)).toBe(First);
    expect(document.createElement(tag)).toBeInstanceOf(First);
    expect(warn).not.toHaveBeenCalled(); // deliberate: another bundle's copy of the same component
  });
});

// I-18 e2e list: "nullclear covers only one input type" — the other clearable families
// through engineConfig(). Pure input-table behaviour, so a unit test (no browser needed).
describe('engineConfig() — clearing a tristate bool, a nullable enum and a callback', () => {
  class ClearHost extends BlissElement {
    protected static override inputs: readonly InputDef[] = [
      { configKey: 'isSorted', attribute: 'is-sorted', converter: toBool('tristate') },
      { configKey: 'theme', attribute: 'theme', converter: toEnum(['light', 'dark'] as const, { isNullable: true }) },
      { configKey: 'formatCallback', converter: toFunction(), default: null },
    ];
    readonly sent: Record<string, unknown>[] = [];
    protected override reinit(): void {
      this.sent.push(this.engineConfig());
    }
    protected override update(partial: Record<string, unknown>): void {
      this.sent.push({ ...this.engineConfig(), ...partial });
    }
    clearable(): ReadonlySet<string> {
      return this.clearableConfigKeys;
    }
  }
  const TAG = freshTag();
  define(TAG, ClearHost as unknown as CustomElementConstructor);

  it('every family is clearable, and a clear reaches the engine as a present null', async () => {
    const host = document.createElement('div');
    host.innerHTML = `<${TAG} is-sorted="true" theme="dark"></${TAG}>`;
    const el = host.firstElementChild as unknown as ClearHost & Record<string, unknown>;
    el.formatCallback = () => 'x';
    document.body.append(el as unknown as Node);
    await el.whenSettled();
    expect([...el.clearable()].sort()).toEqual(['formatCallback', 'isSorted', 'theme']);
    expect(el.sent.at(-1)).toMatchObject({ isSorted: true, theme: 'dark' });

    (el as unknown as HTMLElement).removeAttribute('is-sorted');
    el.theme = null;
    el.formatCallback = null;
    await el.whenSettled();
    const last = el.sent.at(-1)!;
    for (const key of ['isSorted', 'theme', 'formatCallback']) {
      expect(key in last).toBe(true);
      expect(last[key]).toBeNull();
    }
  });
});

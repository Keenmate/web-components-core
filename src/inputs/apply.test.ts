import { describe, expect, it } from 'vitest';
import { BlissElement } from '../element/bliss-element.js';
import { getInputDefaults as fromIndex } from '../index.js';
import { getInputDefaults, resolveFromAttribute, resolveFromProperty } from './apply.js';
import { toBool, toEnum, toFunction, toInt, toObject, toText, toValue } from './converters.js';
import type { AttrReader, InputDef } from './types.js';

// Review 2026-11-03 (WP12): the public resolve helpers, tested directly.
const reader: AttrReader = { getAttribute: () => null, hasAttribute: () => false };

describe('resolveFromAttribute', () => {
  it('parses through the converter and carries the row reactivity', () => {
    const def: InputDef = { configKey: 'size', attribute: 'size', converter: toInt(), on: 'reinit' };
    expect(resolveFromAttribute(def, '5', reader)).toEqual({ configKey: 'size', field: undefined, value: 5, on: 'reinit' });
  });

  it('applies the row default when the converter has no answer for an absent attribute', () => {
    const def: InputDef = { configKey: 'size', attribute: 'size', converter: toInt(), default: 7 };
    expect(resolveFromAttribute(def, null, reader).value).toBe(7);
  });

  it('passes reportInvalid through and defaults reactivity to update', () => {
    const def: InputDef = { configKey: 'size', attribute: 'size', converter: toInt({ default: 1 }) };
    const reasons: (string | undefined)[] = [];
    const resolved = resolveFromAttribute(def, '12px', reader, (r) => reasons.push(r));
    expect(reasons).toEqual(['expected an integer']);
    expect(resolved.on).toBe('update');
  });

  it('a row without a converter takes the raw string, or the default when absent', () => {
    const def: InputDef = { configKey: 'x', attribute: 'x', default: 'd' };
    expect(resolveFromAttribute(def, 'raw', reader).value).toBe('raw');
    expect(resolveFromAttribute(def, null, reader).value).toBe('d');
  });
});

describe('resolveFromProperty', () => {
  it('accepts a value the converter validates, rejects one it does not', () => {
    const def: InputDef = { configKey: 'label', converter: toText() };
    expect(resolveFromProperty(def, 'hi')).toMatchObject({ value: 'hi' });
    expect(resolveFromProperty(def, 42)).toBeNull();
  });

  it('a converter without validate accepts anything; a throwing validate rejects', () => {
    expect(resolveFromProperty({ configKey: 'x', converter: {} }, { any: 1 })).toMatchObject({ value: { any: 1 } });
    const throwing: InputDef = { configKey: 'x', converter: { validate: (() => { throw new Error('x'); }) as never } };
    expect(resolveFromProperty(throwing, 1)).toBeNull();
  });
});

// Review I-09: the property path stores what the attribute path stores for the same input.
describe('resolveFromProperty — converter.normalize', () => {
  const absent: AttrReader = { getAttribute: () => null, hasAttribute: () => false };
  const both = (def: InputDef, raw: string) => ({
    attribute: resolveFromAttribute(def, raw, absent).value,
    property: resolveFromProperty(def, raw)?.value,
  });

  it("toText: '' and trimming agree on both paths", () => {
    const withDefault: InputDef = { configKey: 'label', attribute: 'label', converter: toText({ shouldTrim: true, default: 'Search...' }) };
    expect(both(withDefault, '')).toEqual({ attribute: 'Search...', property: 'Search...' });
    expect(both(withDefault, '   ')).toEqual({ attribute: 'Search...', property: 'Search...' });
    expect(both(withDefault, '  hi ')).toEqual({ attribute: 'hi', property: 'hi' });
    const plain: InputDef = { configKey: 'note', attribute: 'note', converter: toText() };
    expect(both(plain, '')).toEqual({ attribute: '', property: '' }); // used to be rejected on the property path
    const nullable: InputDef = { configKey: 'hint', attribute: 'hint', converter: toText({ isNullable: true }) };
    expect(both(nullable, '')).toEqual({ attribute: null, property: null });
    const keepsEmpty: InputDef = { configKey: 'sep', attribute: 'sep', converter: toText({ isEmptyAllowed: true, default: ',' }) };
    expect(both(keepsEmpty, '')).toEqual({ attribute: '', property: '' });
  });

  it('a throwing normalize is a rejection; non-strings still go through validate', () => {
    const def: InputDef = {
      configKey: 'x',
      converter: { normalize: () => { throw new Error('nope'); }, validate: (v): v is string => typeof v === 'string' },
    };
    expect(resolveFromProperty(def, 'a')).toBeNull();
    expect(resolveFromProperty({ configKey: 'y', converter: toText() }, 5)).toBeNull();
  });
});

// Audit G16c: getInputDefaults — the table's "absent attribute" values, the one source for engine defaults (C-CA-37).
describe('getInputDefaults', () => {
  const TABLE: readonly InputDef[] = [
    { configKey: 'mode', attribute: 'mode', converter: toEnum(['a', 'b'] as const), default: 'a' }, // enum answers null
    { configKey: 'tone', attribute: 'tone', converter: toEnum(['x', 'y'] as const, { default: 'x' }) },
    { configKey: 'label', attribute: 'label', converter: toText({ default: 'Hi' }) },
    { configKey: 'hint', attribute: 'hint', converter: toText({ isNullable: true }) },
    { configKey: 'size', attribute: 'size', converter: toInt(), default: 7 },
    { configKey: 'isDisabled', attribute: 'disabled', converter: toBool('presence') },
    { configKey: 'isOn', attribute: 'is-on', converter: toBool('default-true') },
    { configKey: 'isOff', attribute: 'is-off', converter: toBool('default-false') },
    { configKey: 'isSorted', attribute: 'is-sorted', converter: toBool('tristate') },
    { configKey: 'opts', converter: toObject({ default: { a: 1 } }) },
    { configKey: 'labels', converter: toObject() }, // absent → undefined → left out
    { configKey: 'formatCallback', converter: toFunction(), default: null },
    { configKey: 'nodes', converter: toValue({ default: [] as unknown[] }), getLiveValue: () => ['live'] },
    { configKey: 'raw', attribute: 'raw' }, // no converter, no default → undefined → left out
  ];

  it('answers each row with its absent value; undefined rows are left out', () => {
    expect(getInputDefaults(TABLE)).toEqual({
      mode: null,
      tone: 'x',
      label: 'Hi',
      hint: null,
      size: 7,
      isDisabled: false,
      isOn: true,
      isOff: false,
      isSorted: null,
      opts: { a: 1 },
      formatCallback: null,
      nodes: [],
    });
    expect('labels' in getInputDefaults(TABLE)).toBe(false);
  });

  it('keys limits the rows (unknown keys skipped); getLiveValue plays no part', () => {
    expect(getInputDefaults(TABLE, ['isOn', 'nodes', 'labels', 'nope'])).toEqual({ isOn: true, nodes: [] });
    expect(getInputDefaults(TABLE, [])).toEqual({});
  });

  it('a converter throwing for a missing attribute falls back to the row default, like the element', () => {
    const throwing: InputDef = { configKey: 'x', converter: { fromAttribute: () => { throw new Error('boom'); } }, default: 3 };
    expect(getInputDefaults([throwing])).toEqual({ x: 3 });
  });

  it('matches what a bare element seeds, row for row', () => {
    class Probe extends BlissElement {
      protected static override inputs = TABLE;
      seeded(): Record<string, unknown> {
        return { ...this.config };
      }
    }
    customElements.define('g16c-probe', Probe);
    const seeded = new Probe().seeded();
    const defaults = getInputDefaults(TABLE);
    for (const def of TABLE) expect(defaults[def.configKey], def.configKey).toEqual(seeded[def.configKey]);
  });

  it('is exported from the main index', () => {
    expect(fromIndex).toBe(getInputDefaults);
  });
});

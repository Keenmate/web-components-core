import { describe, expect, it } from 'vitest';
import { resolveFromAttribute, resolveFromProperty } from './apply.js';
import { toInt, toText } from './converters.js';
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

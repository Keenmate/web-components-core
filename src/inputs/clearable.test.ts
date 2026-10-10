import { describe, expect, it } from 'vitest';
import { deriveClearableKeys, isClearableConverter, isClearableInput } from './clearable.js';
import { toBool, toBytes, toEnum, toFunction, toInt, toList, toObject, toObjectArray, toText, toValue } from './converters.js';
import type { Converter, InputDef } from './types.js';

describe('isClearableConverter', () => {
  it('nullable toText (no default) is clearable — unset resolves to null', () => {
    expect(isClearableConverter(toText({ isNullable: true }))).toBe(true);
  });

  it('nullable toText WITH a non-null default is clearable — property-null is still accepted', () => {
    // validate(null) is true for a nullable converter regardless of default, and
    // assigning null must clear it even though an absent attribute falls to the default.
    expect(isClearableConverter(toText({ isNullable: true, default: 'x' }))).toBe(true);
  });

  it('plain toText is NOT clearable — unset is "", null is rejected', () => {
    expect(isClearableConverter(toText())).toBe(false);
    expect(isClearableConverter(toText({ default: 'hi' }))).toBe(false);
  });

  it('toEnum with shouldNullOnInvalid (no default) is clearable via the attribute path', () => {
    // validate(null) is false (enums require a string) — this case is caught only
    // by probing fromAttribute(null) === null, which is why both probes are needed.
    const conv = toEnum(['a', 'b'] as const, { shouldNullOnInvalid: true });
    expect(conv.validate?.(null)).toBe(false);
    expect(conv.fromAttribute?.(null, { getAttribute: () => null, hasAttribute: () => false }, '')).toBe(null);
    expect(isClearableConverter(conv)).toBe(true);
  });

  it('toEnum with a default is NOT clearable — unset falls to the default', () => {
    expect(isClearableConverter(toEnum(['a', 'b'] as const, { default: 'a' }))).toBe(false);
  });

  it('tristate toBool is clearable; the defaulted modes are not', () => {
    expect(isClearableConverter(toBool('tristate'))).toBe(true);
    expect(isClearableConverter(toBool('presence'))).toBe(false);
    expect(isClearableConverter(toBool('default-false'))).toBe(false);
    expect(isClearableConverter(toBool('default-true'))).toBe(false);
  });

  it('toFunction is clearable — a callback assigned null is cleared', () => {
    expect(isClearableConverter(toFunction())).toBe(true);
  });

  it('numeric / list / bytes converters are not clearable', () => {
    expect(isClearableConverter(toInt({ default: 0 }))).toBe(false);
    expect(isClearableConverter(toBytes({ default: 0 }))).toBe(false);
    expect(isClearableConverter(toList({ default: [] }))).toBe(false);
  });

  it('object converters whose unset is undefined are not clearable', () => {
    // fromAttribute(null) returns undefined (not null), validate(null) is false.
    expect(isClearableConverter(toObject())).toBe(false);
    expect(isClearableConverter(toObjectArray())).toBe(false);
    expect(isClearableConverter(toValue())).toBe(false);
  });

  it('returns false for a missing converter', () => {
    expect(isClearableConverter(undefined)).toBe(false);
  });

  it('treats a converter that throws while probing as NOT clearable (conservative)', () => {
    const hostile: Converter<unknown> = {
      validate(_value): _value is unknown {
        throw new Error('boom');
      },
    };
    expect(isClearableConverter(hostile)).toBe(false);
  });
});

describe('isClearableInput', () => {
  it('honors an explicit default: null on the row even without a signalling converter', () => {
    const def: InputDef = { configKey: 'onThing', converter: toFunction(), default: null };
    expect(isClearableInput(def)).toBe(true);
  });

  it('passes the attribute name through to the converter probe', () => {
    const def: InputDef = { configKey: 'focusedNodeClass', attribute: 'focused-node-class', converter: toText({ isNullable: true }) };
    expect(isClearableInput(def)).toBe(true);
  });
});

describe('deriveClearableKeys', () => {
  it('collects exactly the clearable configKeys from a mixed table', () => {
    const defs: readonly InputDef[] = [
      { configKey: 'focusedNodeClass', attribute: 'focused-node-class', converter: toText({ isNullable: true }) },
      { configKey: 'label', attribute: 'label', converter: toText() },
      { configKey: 'theme', attribute: 'theme', converter: toEnum(['light', 'dark'] as const, { shouldNullOnInvalid: true }) },
      { configKey: 'count', attribute: 'count', converter: toInt({ default: 0 }) },
      { configKey: 'onSelect', converter: toFunction() },
    ];
    expect(deriveClearableKeys(defs)).toEqual(new Set(['focusedNodeClass', 'theme', 'onSelect']));
  });
});

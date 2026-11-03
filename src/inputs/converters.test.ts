import { describe, expect, it } from 'vitest';
import { toBool, toBytes, toCssLength, toCustom, toEnum, toFloat, toFunction, toInt, toList, toObject, toObjectArray, toText, toValue } from './converters.js';

describe('toEnum', () => {
  const SELECTION = ['single', 'multiple', 'range'] as const;

  it('parses an exact match and falls back on invalid/absent', () => {
    const c = toEnum(SELECTION, { default: 'single' });
    expect(c.fromAttribute!('range', reader(), 'x')).toBe('range');
    expect(c.fromAttribute!('nope', reader(), 'x')).toBe('single');
    expect(c.fromAttribute!(null, reader(), 'x')).toBe('single');
  });

  it('validates property assignments against the same set', () => {
    const c = toEnum(SELECTION, { default: 'single' });
    expect(c.validate!('multiple')).toBe(true);
    expect(c.validate!('bogus')).toBe(false);
    expect(c.validate!(3)).toBe(false);
  });

  it('exposes its values and supports shouldNullOnInvalid', () => {
    const c = toEnum(SELECTION, { shouldNullOnInvalid: true });
    expect(c.values).toEqual(SELECTION);
    expect(c.fromAttribute!('nope', reader(), 'x')).toBeNull();
    // null is the unset value on the property path too; unknown strings are still rejected
    expect(c.validate!(null)).toBe(true);
    expect(c.validate!('nope')).toBe(false);
  });
});

describe('toInt / toFloat', () => {
  it('range-checks and falls back', () => {
    const c = toInt({ min: 1, default: 50 });
    expect(c.fromAttribute!('10', reader(), 'x')).toBe(10);
    expect(c.fromAttribute!('0', reader(), 'x')).toBe(50);
    expect(c.fromAttribute!('abc', reader(), 'x')).toBe(50);
    expect(c.validate!(10)).toBe(true);
    expect(c.validate!(0)).toBe(false);
    expect(c.validate!(1.5)).toBe(false);
  });

  it('parses floats without integer constraint', () => {
    const c = toFloat({ min: 0, max: 1, default: 0.5 });
    expect(c.fromAttribute!('0.25', reader(), 'x')).toBe(0.25);
    expect(c.fromAttribute!('2', reader(), 'x')).toBe(0.5);
    expect(c.validate!(0.9)).toBe(true);
  });

  it('range-checks the max bound', () => {
    const c = toInt({ max: 100, default: 0 });
    expect(c.fromAttribute!('100', reader(), 'x')).toBe(100);
    expect(c.fromAttribute!('101', reader(), 'x')).toBe(0);
    expect(c.validate!(101)).toBe(false);
  });
});

describe('toText', () => {
  it('trims, guards empties, and falls back', () => {
    const c = toText({ shouldTrim: true, default: 'Search...' });
    expect(c.fromAttribute!('  hi ', reader(), 'x')).toBe('hi');
    expect(c.fromAttribute!('   ', reader(), 'x')).toBe('Search...');
    expect(c.fromAttribute!(null, reader(), 'x')).toBe('Search...');
    expect(c.validate!('')).toBe(false);
    expect(c.validate!('ok')).toBe(true);
  });

  it('allows empty strings when told to', () => {
    const c = toText({ isEmptyAllowed: true });
    expect(c.fromAttribute!('', reader(), 'x')).toBe('');
    expect(c.validate!('')).toBe(true);
  });

  it('isNullable: absent/empty → null, distinguishing unset from empty', () => {
    const c = toText({ isNullable: true, shouldTrim: true });
    expect(c.fromAttribute!(null, reader(), 'x')).toBeNull();
    expect(c.fromAttribute!('', reader(), 'x')).toBeNull();
    expect(c.fromAttribute!('   ', reader(), 'x')).toBeNull();
    expect(c.fromAttribute!('hi', reader(), 'x')).toBe('hi');
    // property path: null clears, '' still rejected, real strings pass
    expect(c.validate!(null)).toBe(true);
    expect(c.validate!('')).toBe(false);
    expect(c.validate!('ok')).toBe(true);
    // reflection removes the attribute for the null sentinel
    expect(c.toAttribute!(null)).toBeNull();
    expect(c.toAttribute!('ok')).toBe('ok');
  });

  it('non-nullable still rejects null and seeds ""', () => {
    const c = toText();
    expect(c.fromAttribute!(null, reader(), 'x')).toBe('');
    expect(c.validate!(null)).toBe(false);
  });

  it('isNullable honours an explicit default', () => {
    const c = toText({ isNullable: true, default: 'fallback' });
    expect(c.fromAttribute!(null, reader(), 'x')).toBe('fallback');
    expect(c.fromAttribute!('', reader(), 'x')).toBe('fallback');
  });
});

describe('toBool', () => {
  it('presence mode', () => {
    const c = toBool('presence');
    expect(c.fromAttribute!('', reader(), 'x')).toBe(true);
    expect(c.fromAttribute!('anything', reader(), 'x')).toBe(true);
    expect(c.fromAttribute!(null, reader(), 'x')).toBe(false);
    expect(c.toAttribute!(true)).toBe('');
    expect(c.toAttribute!(false)).toBeNull();
  });

  it('default-true mode', () => {
    const c = toBool('default-true');
    expect(c.fromAttribute!(null, reader(), 'x')).toBe(true);
    expect(c.fromAttribute!('false', reader(), 'x')).toBe(false);
    expect(c.fromAttribute!('true', reader(), 'x')).toBe(true);
  });

  it('tristate mode', () => {
    const c = toBool('tristate');
    expect(c.fromAttribute!(null, reader(), 'x')).toBeNull();
    expect(c.fromAttribute!('true', reader(), 'x')).toBe(true);
    expect(c.fromAttribute!('false', reader(), 'x')).toBe(false);
    expect(c.validate!(null)).toBe(true);
    expect(c.validate!(true)).toBe(true);
  });
});

describe('toBytes', () => {
  it('parses human sizes', () => {
    const c = toBytes({ default: 0 });
    expect(c.fromAttribute!('10mb', reader(), 'x')).toBe(10485760);
    expect(c.fromAttribute!('1kb', reader(), 'x')).toBe(1024);
    expect(c.fromAttribute!('512', reader(), 'x')).toBe(512);
    expect(c.fromAttribute!('nonsense', reader(), 'x')).toBe(0);
  });

  it('parses fractional sizes', () => {
    const c = toBytes({ default: 0 });
    expect(c.fromAttribute!('1.5kb', reader(), 'x')).toBe(1536);
  });
});

describe('toList', () => {
  it('hands each resolve its own copy of the default array', () => {
    const c = toList<string>({ default: ['a'] });
    const first = c.fromAttribute!(null, reader(), 'x');
    first.push('mutated');
    expect(c.fromAttribute!(null, reader(), 'x')).toEqual(['a']);
  });

  it('parses pipe-delimited fixed-count string lists', () => {
    const c = toList({ itemType: 'string', separator: '|', requiredCount: 3 });
    expect(c.fromAttribute!('a|b|c', reader(), 'x')).toEqual(['a', 'b', 'c']);
    expect(c.fromAttribute!('a|b', reader(), 'x')).toEqual([]); // count mismatch → default
    expect(c.validate!(['a', 'b', 'c'])).toBe(true);
    expect(c.validate!(['a', 'b'])).toBe(false);
  });

  it('parses int lists and rejects NaN items', () => {
    const c = toList({ itemType: 'int' });
    expect(c.fromAttribute!('1,2,3', reader(), 'x')).toEqual([1, 2, 3]);
    expect(c.fromAttribute!('1,x,3', reader(), 'x')).toEqual([]);
    expect(c.validate!([1, 2])).toBe(true);
    expect(c.validate!([1, '2'])).toBe(false);
  });

  it('empty or absent → default', () => {
    const c = toList({ default: ['x'] });
    expect(c.fromAttribute!('', reader(), 'x')).toEqual(['x']);
    expect(c.fromAttribute!(null, reader(), 'x')).toEqual(['x']);
  });
});

describe('toCustom', () => {
  it('wraps a bespoke parser with optional validate', () => {
    const parseWeekStart = (raw: string | null): 'auto' | number =>
      raw === 'auto' || raw === null ? 'auto' : Number.parseInt(raw, 10);
    const c = toCustom(parseWeekStart, {
      validate: (v): v is 'auto' | number => v === 'auto' || (typeof v === 'number' && v >= 0 && v <= 6),
    });
    expect(c.fromAttribute!('auto', reader(), 'x')).toBe('auto');
    expect(c.fromAttribute!('3', reader(), 'x')).toBe(3);
    expect(c.validate!(6)).toBe(true);
    expect(c.validate!(9)).toBe(false);
  });
});

describe('toFunction', () => {
  it('is property-only and validates callables', () => {
    const c = toFunction();
    expect(c.fromAttribute).toBeUndefined();
    expect(c.validate!(() => {})).toBe(true);
    expect(c.validate!(42)).toBe(false);
  });

  it('accepts null / undefined so a callback can be cleared', () => {
    const c = toFunction();
    expect(c.validate!(null)).toBe(true);
    expect(c.validate!(undefined)).toBe(true);
  });
});

describe('toValue', () => {
  it('removes the attribute for a value JSON cannot represent', () => {
    expect(toValue().toAttribute!(() => 1)).toBeNull();
  });

  it('property path accepts anything without a validate', () => {
    const c = toValue();
    expect(c.validate).toBeUndefined();
  });

  it('property path enforces a supplied validate', () => {
    const c = toValue<number>({ validate: (v): v is number => typeof v === 'number' });
    expect(c.validate!(3)).toBe(true);
    expect(c.validate!('x')).toBe(false);
  });

  it('attribute path parses JSON, falling back on blank/malformed/invalid', () => {
    const c = toValue<{ a: number }>({ default: { a: 0 }, validate: (v): v is { a: number } => typeof v === 'object' && v !== null && 'a' in v });
    expect(c.fromAttribute!('{"a":5}', reader(), 'x')).toEqual({ a: 5 });
    expect(c.fromAttribute!(null, reader(), 'x')).toEqual({ a: 0 }); // absent → default
    expect(c.fromAttribute!('  ', reader(), 'x')).toEqual({ a: 0 }); // blank → default
    expect(c.fromAttribute!('{bad', reader(), 'x')).toEqual({ a: 0 }); // malformed → default
    expect(c.fromAttribute!('42', reader(), 'x')).toEqual({ a: 0 }); // fails validate → default
  });

  it('reflects as JSON', () => {
    const c = toValue();
    expect(c.toAttribute!({ a: 1 })).toBe('{"a":1}');
    expect(c.toAttribute!(null as never)).toBeNull();
  });
});

describe('toObjectArray', () => {
  it('hands each resolve its own copy of the default array', () => {
    const c = toObjectArray();
    expect(c.fromAttribute!(null, reader(), 'x')).not.toBe(c.fromAttribute!(null, reader(), 'x'));
  });

  it('property path requires an array; default is []', () => {
    const c = toObjectArray();
    expect(c.fromAttribute!(null, reader(), 'x')).toEqual([]);
    expect(c.validate!([{ id: 1 }])).toBe(true);
    expect(c.validate!('nope')).toBe(false);
    expect(c.validate!({ length: 0 })).toBe(false);
  });

  it('honors a per-item guard on both paths', () => {
    const c = toObjectArray<number>({ validateItem: (i): i is number => typeof i === 'number', default: [] });
    expect(c.fromAttribute!('[1,2,3]', reader(), 'x')).toEqual([1, 2, 3]);
    expect(c.fromAttribute!('[1,"x"]', reader(), 'x')).toEqual([]); // bad item → default
    expect(c.validate!([1, 2])).toBe(true);
    expect(c.validate!([1, 'x'])).toBe(false);
  });

  it('parses JSON on the attribute path and reflects as JSON', () => {
    const c = toObjectArray();
    expect(c.fromAttribute!('[{"id":1}]', reader(), 'x')).toEqual([{ id: 1 }]);
    expect(c.fromAttribute!('{bad', reader(), 'x')).toEqual([]);
    expect(c.toAttribute!([{ id: 1 }])).toBe('[{"id":1}]');
  });
});

describe('toObject', () => {
  it('requires a non-null, non-array object', () => {
    const c = toObject();
    expect(c.validate!({ a: 1 })).toBe(true);
    expect(c.validate!(null)).toBe(false);
    expect(c.validate!([1, 2])).toBe(false); // arrays rejected
    expect(c.validate!('x')).toBe(false);
  });

  it('attribute path parses JSON objects, else default (undefined by default)', () => {
    const c = toObject();
    expect(c.fromAttribute!('{"a":1}', reader(), 'x')).toEqual({ a: 1 });
    expect(c.fromAttribute!('[1]', reader(), 'x')).toBeUndefined(); // array → default
    expect(c.fromAttribute!(null, reader(), 'x')).toBeUndefined();
  });

  it('uses a supplied default and reflects as JSON', () => {
    const c = toObject({ default: { theme: 'light' } });
    expect(c.fromAttribute!('bad', reader(), 'x')).toEqual({ theme: 'light' });
    expect(c.toAttribute!({ theme: 'dark' })).toBe('{"theme":"dark"}');
  });
});

function reader(attrs: Record<string, string> = {}) {
  return {
    getAttribute: (n: string) => (n in attrs ? attrs[n]! : null),
    hasAttribute: (n: string) => n in attrs,
  };
}

describe('reportInvalid (attribute path)', () => {
  /** Parse `raw` and return the reason reported, or `undefined` when it wasn't. */
  const reported = (c: { fromAttribute?: (...a: never[]) => unknown }, raw: string | null): string | undefined => {
    let reason: string | undefined;
    let isInvalid = false;
    (c.fromAttribute as (r: string | null, el: unknown, a: string, rep: (s?: string) => void) => unknown)(raw, reader(), 'x', (s) => {
      isInvalid = true;
      reason = s;
    });
    return isInvalid ? reason ?? '' : undefined;
  };

  it('reports an unusable present value, with a reason', () => {
    expect(reported(toEnum(['a', 'b']), 'c')).toBe('expected one of a | b');
    expect(reported(toInt(), 'abc')).toBe('expected an integer');
    expect(reported(toInt({ min: 1, max: 5 }), '9')).toBe('out of range 1..5');
    expect(reported(toFloat(), 'x')).toBe('expected a number');
    expect(reported(toBool('default-true'), 'maybe')).toBe('expected true | false');
    expect(reported(toBool('tristate'), 'maybe')).toBe('expected true | false');
    expect(reported(toBytes(), '1.5 HB')).toBe('expected a size like "10mb" or "300 kB"');
    expect(reported(toList({ itemType: 'int' }), '1,x')).toBe('expected integers separated by ","');
    expect(reported(toList({ requiredCount: 2 }), 'a')).toBe('expected 2 items separated by ","');
    expect(reported(toValue(), '{bad')).toBe('malformed JSON');
    expect(reported(toObjectArray(), '{}')).toBe('expected a JSON array');
    expect(reported(toObject(), '[]')).toBe('expected a JSON object');
    expect(reported(toCustom((_raw, rep) => rep?.('nope')), 'z')).toBe('nope');
  });

  it('never reports absent, blank-as-unset or always-valid values', () => {
    expect(reported(toEnum(['a']), null)).toBeUndefined();
    expect(reported(toInt(), null)).toBeUndefined();
    expect(reported(toInt(), '010')).toBeUndefined();
    expect(reported(toBool('presence'), 'false')).toBeUndefined();
    expect(reported(toBool('default-true'), '')).toBeUndefined();
    expect(reported(toText(), '')).toBeUndefined();
    expect(reported(toList(), '')).toBeUndefined();
    expect(reported(toObject(), '  ')).toBeUndefined();
    expect(reported(toBytes(), '10mb')).toBeUndefined();
  });
});

// Review 2026-11-03 (WP4a): one parsing contract — the whole attribute must be the value.
describe('strict parsing (attribute path)', () => {
  /** [raw, value] for valid input; [raw, 'invalid'] for a value that must be reported. */
  const parse = (c: { fromAttribute?: (...a: never[]) => unknown }, raw: string): unknown => {
    let isInvalid = false;
    const value = (c.fromAttribute as (r: string | null, el: unknown, a: string, rep: () => void) => unknown)(raw, reader(), 'x', () => {
      isInvalid = true;
    });
    return isInvalid ? 'invalid' : value;
  };

  it.each([
    ['12', 12],
    [' 5 ', 5],
    ['-3', -3],
    ['+4', 4],
    ['12px', 'invalid'],
    ['1.9', 'invalid'],
    ['1e3', 'invalid'],
    ['0x10', 'invalid'],
    ['1,5', 'invalid'],
    ['', 'invalid'],
  ])('toInt %j → %j', (raw, expected) => expect(parse(toInt(), raw)).toBe(expected));

  it.each([
    ['1.5', 1.5],
    ['.5', 0.5],
    ['-2e3', -2000],
    [' 3 ', 3],
    ['1.5em', 'invalid'],
    ['1,5', 'invalid'],
    ['Infinity', 'invalid'],
    ['NaN', 'invalid'],
  ])('toFloat %j → %j', (raw, expected) => expect(parse(toFloat(), raw)).toBe(expected));

  it.each([
    ['1024', 1024],
    ['10mb', 10 * 1024 ** 2],
    ['300 kB', 300 * 1024],
    ['1.5G', 1.5 * 1024 ** 3],
    ['5MiB', 5 * 1024 ** 2],
    [' 2 k ', 2048],
    ['1.2.3mb', 'invalid'],
    ['1.5b', 'invalid'],
    ['10 parsecs', 'invalid'],
  ])('toBytes %j → %j', (raw, expected) => expect(parse(toBytes(), raw)).toBe(expected));

  it('toBytes rejects a fractional byte count on the property path', () => {
    expect(toBytes().validate!(1.5)).toBe(false);
    expect(toBytes().validate!(1024)).toBe(true);
  });

  it('toList int items are whole-string integers', () => {
    expect(parse(toList({ itemType: 'int' }), '1, 2,3')).toEqual([1, 2, 3]);
    expect(parse(toList({ itemType: 'int' }), '1,2px')).toBe('invalid');
    expect(parse(toList({ itemType: 'int' }), '1.5')).toBe('invalid');
  });

  it('toEnum trims the attribute', () => {
    expect(parse(toEnum(['sm', 'lg'] as const), ' lg ')).toBe('lg');
  });
});

describe('toCssLength', () => {
  const parse = (c: { fromAttribute?: (...a: never[]) => unknown }, raw: string): unknown => {
    let isInvalid = false;
    const value = (c.fromAttribute as (r: string | null, el: unknown, a: string, rep: () => void) => unknown)(raw, reader(), 'x', () => {
      isInvalid = true;
    });
    return isInvalid ? 'invalid' : value;
  };

  it.each([
    ['120', '120px'],
    ['12px', '12px'],
    ['2rem', '2rem'],
    ['50%', '50%'],
    ['0', '0px'],
    ['calc(100% - 2rem)', 'calc(100% - 2rem)'],
    ['var(--gap)', 'var(--gap)'],
    ['12 px', 'invalid'],
    ['wide', 'invalid'],
    ['-4px', 'invalid'],
    ['', 'invalid'],
  ])('%j → %j', (raw, expected) => expect(parse(toCssLength(), raw)).toBe(expected));

  it('keywords and negatives are opt-in', () => {
    expect(parse(toCssLength({ keywords: ['auto', 'none'] }), 'Auto')).toBe('auto');
    expect(parse(toCssLength({ allowNegative: true }), '-4px')).toBe('-4px');
  });

  it('the property path takes a length string, not a bare number', () => {
    const c = toCssLength();
    expect(c.validate!('20rem')).toBe(true);
    expect(c.validate!(120)).toBe(false);
    expect(c.validate!('20 rem')).toBe(false);
  });

  it('an absent attribute is the default', () => {
    expect(toCssLength({ default: '10rem' }).fromAttribute!(null, reader(), 'x')).toBe('10rem');
  });
});

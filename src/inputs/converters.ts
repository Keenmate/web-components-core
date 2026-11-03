/**
 * The `to*` converter factories. Each returns a {@link Converter} that wires
 * `fromAttribute` (parse) and `validate` (property guard) from the same inputs,
 * so both entry points enforce identical correctness. See docs/SPEC.md §5.
 *
 * A brand-new input type is just a new factory created anywhere (core or a
 * component) — there is no closed union and no central switch to edit.
 */
import type { Converter } from './types.js';

/** A {@link Converter} that also exposes its permitted values (optional docs autodetect, docs/SPEC.md §8). */
export interface EnumConverter<V extends string> extends Converter<V> {
  readonly values: readonly V[];
}

/** `toAttribute` for scalars: `null`/`undefined` remove the attribute, anything else is stringified. */
const scalarToAttribute = (value: unknown): string | null => (value == null ? null : String(value));

/**
 * The JSON attribute path shared by {@link toValue}, {@link toObjectArray} and
 * {@link toObject}: absent / blank → `fallback()`; malformed / failing `isValid`
 * → reported invalid, then `fallback()`.
 */
function parseJson<V>(
  raw: string | null,
  isValid: ((value: unknown) => boolean) | undefined,
  fallback: () => V,
  reportInvalid: ((reason?: string) => void) | undefined,
  shape: string,
): V {
  if (raw === null || raw.trim() === '') return fallback();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    reportInvalid?.('malformed JSON');
    return fallback();
  }
  if (!isValid || isValid(parsed)) return parsed as V;
  reportInvalid?.(`expected ${shape}`);
  return fallback();
}

/**
 * Exact-match against a fixed set of strings.
 *
 * Invalid or absent values fall back to `default` — or to `null` when
 * `shouldNullOnInvalid` is set. With `shouldNullOnInvalid` and no `default`,
 * `null` is the unset value on BOTH paths: removing the attribute and
 * assigning `el.x = null` clear the input alike (an unknown string is still
 * rejected on the property path).
 */
export function toEnum<const T extends readonly string[]>(
  values: T,
  opts: { default?: T[number]; shouldNullOnInvalid?: boolean } = {},
): EnumConverter<T[number]> {
  const set = new Set<string>(values);
  const fallback = (opts.shouldNullOnInvalid ? null : opts.default ?? null) as T[number];
  const isNullUnset = !!opts.shouldNullOnInvalid && opts.default === undefined;
  return {
    values,
    fromAttribute(raw, _el, _attr, reportInvalid) {
      if (raw === null) return (opts.default ?? fallback) as T[number];
      const value = raw.trim();
      if (set.has(value)) return value as T[number];
      reportInvalid?.(`expected one of ${values.join(' | ')}`);
      return fallback;
    },
    validate(value): value is T[number] {
      if (value === null) return isNullUnset;
      return typeof value === 'string' && set.has(value);
    },
    toAttribute: scalarToAttribute,
  };
}

/** A whole-string base-10 integer (surrounding whitespace allowed). */
const INTEGER = /^[+-]?\d+$/;
/** A whole-string decimal number, optional exponent (`1.5`, `.5`, `-2e3`); no `Infinity`, hex or `1,5`. */
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Parse a base-10 integer with optional range check. The WHOLE attribute must be the
 * number: `"12px"`, `"1.9"`, `"1e3"` and `"0x10"` are invalid (warn, keep the previous
 * value) instead of quietly becoming 12, 1, 1 and 0. Values with a CSS unit belong in
 * {@link toCssLength}.
 */
export function toInt(opts: { min?: number; max?: number; default?: number } = {}): Converter<number> {
  return toNumber((raw) => (INTEGER.test(raw) ? Number(raw) : Number.NaN), Number.isInteger, opts, 'an integer');
}

/**
 * Parse a finite floating-point number with optional range check. The whole attribute
 * must be the number (`"1.5"`, `"-2e3"`); `"1.5em"`, `"1,5"` and `"Infinity"` are invalid.
 */
export function toFloat(opts: { min?: number; max?: number; default?: number } = {}): Converter<number> {
  return toNumber((raw) => (DECIMAL.test(raw) ? Number(raw) : Number.NaN), Number.isFinite, opts, 'a number');
}

/** {@link toInt} / {@link toFloat}: the same range + fallback rules over a different parser and type check. */
function toNumber(
  parse: (raw: string) => number,
  isNumber: (n: number) => boolean,
  opts: { min?: number; max?: number; default?: number },
  expected: string,
): Converter<number> {
  const inRange = (n: number): boolean =>
    (opts.min == null || n >= opts.min) && (opts.max == null || n <= opts.max);
  const fallback = opts.default as number;
  return {
    fromAttribute(raw, _el, _attr, reportInvalid) {
      if (raw === null) return fallback;
      const n = parse(raw.trim());
      if (Number.isNaN(n) || !isNumber(n)) {
        reportInvalid?.(`expected ${expected}`);
        return fallback;
      }
      if (!inRange(n)) {
        reportInvalid?.(`out of range ${opts.min ?? '-∞'}..${opts.max ?? '∞'}`);
        return fallback;
      }
      return n;
    },
    validate(value): value is number {
      return typeof value === 'number' && isNumber(value) && inRange(value);
    },
    toAttribute: scalarToAttribute,
  };
}

/**
 * String input. Named `toText` — NOT `toString` — to avoid colliding with
 * `Object.prototype.toString`. Empty strings fall back to `default` unless
 * `isEmptyAllowed` is set.
 *
 * With `isNullable: true` the "unset" value is `null` instead of `''` — an
 * absent or empty attribute resolves to `null`, so callers can distinguish
 * "not set" from "set to empty" (an optional string). `null` is the same
 * absent-sentinel `toEnum`'s `shouldNullOnInvalid` uses. To clear a nullable
 * input via the property path, assign `null` (assigning `''` is still rejected,
 * like non-nullable). `isEmptyAllowed` and `isNullable` are orthogonal: the
 * former keeps `''` as a value; the latter sets the unset sentinel to `null`.
 */
export function toText(opts?: { shouldTrim?: boolean; isEmptyAllowed?: boolean; default?: string }): Converter<string>;
export function toText(opts: { shouldTrim?: boolean; isEmptyAllowed?: boolean; isNullable: true; default?: string | null }): Converter<string | null>;
export function toText(
  opts: { shouldTrim?: boolean; isEmptyAllowed?: boolean; isNullable?: boolean; default?: string | null } = {},
): Converter<string | null> {
  const isNullable = opts.isNullable === true;
  const fallback = opts.default ?? (isNullable ? null : '');
  const normalize = (s: string): string => (opts.shouldTrim ? s.trim() : s);
  return {
    fromAttribute(raw) {
      if (raw === null) return fallback;
      const s = normalize(raw);
      return !opts.isEmptyAllowed && s === '' ? fallback : s;
    },
    validate(value): value is string | null {
      if (value === null) return isNullable;
      return typeof value === 'string' && (opts.isEmptyAllowed === true || value !== '');
    },
    toAttribute: scalarToAttribute,
  };
}

const TRUEISH = new Set(['', 'true', '1', 'yes', 'on']);
const FALSEISH = new Set(['false', '0', 'no', 'off']);

/**
 * Boolean attribute. The mode is REQUIRED — "what does a missing attribute mean, and is
 * `x="false"` false?" has no obvious answer, so every row states it:
 *
 * - `default-false` — the usual flag: absent → `false`; `""` / `"true"` / `"1"` / `"yes"` / `"on"` →
 *   `true`; `"false"` / `"0"` / `"no"` / `"off"` → `false`; anything else → invalid (warn, keep).
 * - `default-true`  — a flag that is on unless switched off: absent → `true`, same values otherwise.
 * - `tristate`      — absent → `null` ("not set"); otherwise `true` / `false`.
 * - `presence`      — the native-HTML rule: present (ANY value, `"false"` included) → `true`,
 *   absent → `false`; reflects as a bare attribute. Meant for `disabled` / `readonly`, where the
 *   browser itself reads the attribute by presence and the value must agree with it.
 *
 * The mode's absent value replaces the row's `default` — declare a matching one or none
 * (BlissElement warns on a mismatch).
 */
export type BoolMode = 'presence' | 'default-true' | 'default-false' | 'tristate';

export function toBool(mode: BoolMode): Converter<boolean | null> {
  const parse = (raw: string): boolean | null => {
    const v = raw.trim().toLowerCase();
    if (TRUEISH.has(v)) return true;
    if (FALSEISH.has(v)) return false;
    return null;
  };
  return {
    fromAttribute(raw, _el, _attr, reportInvalid) {
      if (mode === 'presence') return raw !== null; // any value means "on" — never invalid
      const unset = mode === 'default-true' ? true : mode === 'default-false' ? false : null;
      if (raw === null) return unset;
      const parsed = parse(raw);
      if (parsed === null) reportInvalid?.('expected true | false');
      return parsed ?? unset;
    },
    validate(value): value is boolean | null {
      if (mode === 'tristate') return value === true || value === false || value === null;
      return typeof value === 'boolean';
    },
    toAttribute(value) {
      if (mode === 'presence') return value ? '' : null;
      return scalarToAttribute(value);
    },
  };
}

/** Binary (1024-based) multipliers — the same units file sizes are displayed in. */
const BYTE_UNITS: Record<string, number> = {
  b: 1,
  k: 1024,
  kb: 1024,
  kib: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  mib: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  gib: 1024 ** 3,
  t: 1024 ** 4,
  tb: 1024 ** 4,
  tib: 1024 ** 4,
};

/**
 * Parse a human byte size: a number plus an optional case-insensitive unit, binary
 * (1024-based): `"10mb"`, `"300 kB"`, `"1.5G"`, `"5MiB"`, `"1024"` (bytes). `5MB` is always
 * 5 × 1024 × 1024. A malformed number (`"1.2.3mb"`) or a fractional byte count is invalid.
 */
export function toBytes(opts: { default?: number } = {}): Converter<number> {
  const fallback = opts.default as number;
  const parse = (raw: string): number | null => {
    const m = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*([a-z]+)?\s*$/i.exec(raw);
    if (!m) return null;
    const multiplier = BYTE_UNITS[(m[2] ?? 'b').toLowerCase()];
    if (multiplier === undefined) return null;
    const bytes = Number(m[1]) * multiplier;
    if (multiplier === 1 && !Number.isInteger(bytes)) return null; // "1.5b"
    return Math.round(bytes);
  };
  return {
    fromAttribute(raw, _el, _attr, reportInvalid) {
      if (raw === null) return fallback;
      const bytes = parse(raw);
      if (bytes !== null) return bytes;
      reportInvalid?.('expected a size like "10mb" or "300 kB"');
      return fallback;
    },
    validate(value): value is number {
      return typeof value === 'number' && Number.isInteger(value) && value >= 0;
    },
    toAttribute: scalarToAttribute,
  };
}

/** CSS length units the offline check (no `CSS.supports`: SSR, jsdom) accepts. */
const CSS_LENGTH_UNITS =
  'px|em|rem|ex|rex|ch|rch|ic|ric|cap|rcap|lh|rlh|%|vw|vh|vi|vb|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|svi|svb|lvi|lvb|dvi|dvb|svmin|svmax|lvmin|lvmax|dvmin|dvmax|cqw|cqh|cqi|cqb|cqmin|cqmax|cm|mm|q|in|pt|pc';
const CSS_LENGTH = new RegExp(String.raw`^[+-]?(?:\d+\.?\d*|\.\d+)(?:${CSS_LENGTH_UNITS})$`, 'i');
const CSS_MATH = /^(?:calc|min|max|clamp|var|env)\(.*\)$/i;

/**
 * `CSS.supports`, when it actually works: some environments (jsdom) ship a stub that
 * answers `false` for everything, so it must recognise `1px` before it is trusted.
 */
function cssSupports(): ((property: string, value: string) => boolean) | null {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return null;
  try {
    return CSS.supports('width', '1px') ? CSS.supports.bind(CSS) : null;
  } catch {
    return null;
  }
}

/** Whether `value` is a CSS length (`"12px"`, `"2rem"`, `"50%"`, `"0"`, `calc(…)`, `var(…)`). */
function isCssLength(value: string, allowNegative: boolean): boolean {
  const v = value.trim();
  if (v === '') return false;
  if (!allowNegative && v.startsWith('-')) return false;
  if (v === '0' || v === '+0' || v === '-0') return true;
  const supports = cssSupports();
  // `width` takes every length / percentage / math function; keywords (`auto`) are handled by the caller.
  if (supports) return supports('width', v) && !/^[a-z-]+$/i.test(v);
  return CSS_LENGTH.test(v) || CSS_MATH.test(v);
}

/**
 * A CSS length for inputs that only end up in a style or a CSS variable (a max width,
 * a gap): `"12px"`, `"2rem"`, `"50%"`, `calc(100% - 2rem)`, `var(--x)`. A bare number
 * attribute means pixels (`max-width="120"` → `"120px"`). Validated with
 * `CSS.supports('width', …)` in the browser, a unit check elsewhere. `keywords` lists
 * extra accepted words (`['auto', 'none']`); negatives need `allowNegative`.
 *
 * Inputs the component does arithmetic with (row heights, offsets for positioning)
 * stay {@link toInt} — a `"2rem"` can't be added to a pixel count.
 *
 * Property path: a valid length string (`el.maxWidth = '20rem'`). A bare number is not
 * a length there — assign `'120px'`.
 */
export function toCssLength(
  opts: { default?: string; allowNegative?: boolean; keywords?: readonly string[] } = {},
): Converter<string> {
  const fallback = opts.default as string;
  const keywords = new Set((opts.keywords ?? []).map((k) => k.toLowerCase()));
  const allowNegative = opts.allowNegative === true;
  const isValid = (v: string): boolean => keywords.has(v.trim().toLowerCase()) || isCssLength(v, allowNegative);
  return {
    fromAttribute(raw, _el, _attr, reportInvalid) {
      if (raw === null) return fallback;
      const v = raw.trim();
      if (DECIMAL.test(v) && !/[eE]/.test(v)) {
        const n = Number(v);
        if (allowNegative || n >= 0) return `${n}px`;
      }
      if (isValid(v)) return keywords.has(v.toLowerCase()) ? v.toLowerCase() : v;
      reportInvalid?.(`expected a CSS length like "12px", "2rem" or "50%"${keywords.size ? ` or ${[...keywords].join(' | ')}` : ''}`);
      return fallback;
    },
    validate(value): value is string {
      return typeof value === 'string' && isValid(value);
    },
    toAttribute: scalarToAttribute,
  };
}

/**
 * Delimited list (CSV / pipe-list) of strings or ints, with optional exact
 * `requiredCount` validation. A malformed item, or a length mismatch, falls
 * back to `default`.
 */
export function toList<E extends string | number = string>(opts: {
  itemType?: 'string' | 'int';
  separator?: string;
  requiredCount?: number;
  shouldTrim?: boolean;
  default?: E[];
} = {}): Converter<E[]> {
  const separator = opts.separator ?? ',';
  const itemType = opts.itemType ?? 'string';
  // A fresh copy per resolve — instances must not share (and mutate) one default array.
  const fallback = (): E[] => (opts.default ? [...opts.default] : []);
  const parse = (raw: string): E[] | null => {
    const parts = raw.split(separator).map((p) => (opts.shouldTrim === false ? p : p.trim()));
    let items: (string | number)[] = parts;
    if (itemType === 'int') {
      items = parts.map((p) => (INTEGER.test(p.trim()) ? Number(p) : Number.NaN));
      if (items.some((n) => Number.isNaN(n as number))) return null;
    }
    if (opts.requiredCount != null && items.length !== opts.requiredCount) return null;
    return items as E[];
  };
  return {
    fromAttribute(raw, _el, _attr, reportInvalid) {
      if (raw === null || raw === '') return fallback();
      const items = parse(raw);
      if (items !== null) return items;
      reportInvalid?.(
        opts.requiredCount != null
          ? `expected ${opts.requiredCount} ${itemType === 'int' ? 'integers' : 'items'} separated by "${separator}"`
          : `expected integers separated by "${separator}"`,
      );
      return fallback();
    },
    validate(value): value is E[] {
      if (!Array.isArray(value)) return false;
      if (opts.requiredCount != null && value.length !== opts.requiredCount) return false;
      const ok = itemType === 'int' ? (v: unknown) => typeof v === 'number' && Number.isInteger(v) : (v: unknown) => typeof v === 'string';
      return value.every(ok);
    },
    toAttribute(value) {
      return Array.isArray(value) ? value.join(separator) : null;
    },
  };
}

/**
 * Rich value of arbitrary shape — the property-first analogue of {@link toText}
 * /{@link toInt} for data too complex for a plain scalar. The PROPERTY path
 * accepts any value (or one that passes `validate`); the ATTRIBUTE path (only if
 * the input declares an `attribute`) parses the raw string as JSON, falling back
 * to `default` on malformed JSON or a value that fails `validate`. Reflects back
 * as JSON. For arrays/objects specifically, prefer {@link toObjectArray} /
 * {@link toObject}, which bake in the shape check.
 */
export function toValue<V = unknown>(
  opts: { validate?: (value: unknown) => value is V; default?: V } = {},
): Converter<V> {
  return {
    fromAttribute(raw, _el, _attr, reportInvalid) {
      return parseJson(raw, opts.validate, () => opts.default as V, reportInvalid, 'a valid value');
    },
    validate: opts.validate,
    toAttribute(value) {
      // JSON.stringify gives `undefined` for a function / symbol — remove rather than reflect "undefined".
      return value == null ? null : JSON.stringify(value) ?? null;
    },
  };
}

/**
 * Array of rich items (e.g. an `options` data array). The property path requires
 * an array — each item optionally checked by `validateItem`; the attribute path
 * parses JSON. Absent / blank / malformed / wrong-shape → `default` (default
 * `[]`). Reflects as JSON. This is the core home for the property-only rich-array
 * pattern components used to hand-write.
 */
export function toObjectArray<E = unknown>(
  opts: { validateItem?: (item: unknown) => item is E; default?: E[] } = {},
): Converter<E[]> {
  // A fresh copy per resolve — instances must not share (and mutate) one default array.
  const fallback = (): E[] => (opts.default ? [...opts.default] : []);
  const isValid = (value: unknown): value is E[] =>
    Array.isArray(value) && (!opts.validateItem || value.every(opts.validateItem));
  return {
    fromAttribute(raw, _el, _attr, reportInvalid) {
      return parseJson(raw, isValid, fallback, reportInvalid, 'a JSON array');
    },
    validate: isValid,
    toAttribute(value) {
      return Array.isArray(value) ? JSON.stringify(value) : null;
    },
  };
}

/**
 * Plain object (a config map, etc.). The property path requires a non-null,
 * NON-array object (optionally checked by `validate`); the attribute path parses
 * JSON. Absent / blank / malformed / wrong-shape → `default` (default
 * `undefined` — objects rarely have a natural empty sentinel; pass `{}` if you
 * want one). Reflects as JSON. A `default` object is shared by every instance
 * — treat `config` values as read-only, never mutate them in place.
 */
export function toObject<V extends object = Record<string, unknown>>(
  opts: { validate?: (value: unknown) => value is V; default?: V } = {},
): Converter<V> {
  const isValid = (value: unknown): value is V =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && (!opts.validate || opts.validate(value));
  return {
    fromAttribute(raw, _el, _attr, reportInvalid) {
      return parseJson(raw, isValid, () => opts.default as V, reportInvalid, 'a JSON object');
    },
    validate: isValid,
    toAttribute(value) {
      return value == null ? null : JSON.stringify(value);
    },
  };
}

/**
 * Wrap a bespoke parser (month-names, `'auto' | 0..6`, …). Supply an optional
 * `validate` / `toAttribute` when the input also travels the property or
 * reflection paths; without `validate`, property assignments pass through.
 * The parser may call `reportInvalid(reason)` for an unusable present value
 * (see {@link Converter.fromAttribute}).
 */
export function toCustom<V>(
  parse: (raw: string | null, reportInvalid?: (reason?: string) => void) => V,
  opts: { validate?: (value: unknown) => value is V; toAttribute?: (value: V) => string | null } = {},
): Converter<V> {
  return {
    fromAttribute(raw, _el, _attr, reportInvalid) {
      return parse(raw, reportInvalid);
    },
    validate: opts.validate,
    toAttribute: opts.toAttribute,
  };
}

/**
 * Callback input: property-only (no attribute), accepts any function — or `null`
 * / `undefined` to CLEAR it. Callbacks are inherently optional, and clearing one
 * by assignment (`el.onThing = null`, exactly like a DOM event-handler property)
 * must be accepted, not rejected. So the value type is `F | null`; give the row a
 * `default` of `null` if you want an explicit unset sentinel.
 */
export function toFunction<F extends (...args: never[]) => unknown = (...args: never[]) => unknown>(): Converter<F | null> {
  return {
    validate(value): value is F | null {
      return value === null || value === undefined || typeof value === 'function';
    },
  };
}

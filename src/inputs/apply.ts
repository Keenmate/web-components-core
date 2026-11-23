/**
 * The parse + validate + stage pipeline shared by BOTH entry points. Attributes
 * go through {@link resolveFromAttribute}, JS-assigned properties through
 * {@link resolveFromProperty}, and both produce the same {@link Resolved} shape
 * — so everything is reactive by construction. See docs/SPEC.md §6.
 */
import type { AttrReader, InputDef, Reactivity } from './types.js';

/** A single input resolved from either entry point, ready to stage. */
export interface Resolved {
  configKey: string;
  field?: string;
  value: unknown;
  on: Reactivity;
}

/**
 * Attribute path: `converter.fromAttribute(raw)` → resolved value. The converter
 * supplies its own fallback; when it has none (returns `undefined`), the row's
 * `default` applies — so `{ converter: toInt(), default: 5 }` resolves to 5 for
 * an absent or removed attribute. `reportInvalid` is passed through to the
 * converter; the caller decides what an invalid value does (BlissElement keeps
 * the current value).
 *
 * @internal BlissElement plumbing — exported, but not part of the stable API.
 */
export function resolveFromAttribute(
  def: InputDef,
  raw: string | null,
  reader: AttrReader,
  reportInvalid?: (reason?: string) => void,
): Resolved {
  const conv = def.converter;
  let value: unknown = conv?.fromAttribute
    ? conv.fromAttribute(raw, reader, def.attribute ?? def.configKey, reportInvalid)
    : raw ?? def.default;
  if (value === undefined) value = def.default;
  return { configKey: def.configKey, field: def.field, value, on: def.on ?? 'update' };
}

/** A reader standing in for "no attribute present" while probing `fromAttribute(null)`. */
const ABSENT_READER: AttrReader = { getAttribute: () => null, hasAttribute: () => false };

/**
 * `null` as "unset" is admitted only when the input has NO default (SPEC §6.1). A converter
 * (with a `validate`) that admits `null` but leaves the absent value to the row (`fromAttribute(null)` →
 * `undefined`, e.g. `toObject()`) can't see the row's `default`; when that row default is a
 * real value, the `null` is refused here — `el.x = undefined` resets to the default instead.
 *
 * @internal BlissElement plumbing — exported, but not part of the stable API.
 */
export function isNullRefusedByRowDefault(def: InputDef): boolean {
  const conv = def.converter;
  if (def.default === undefined || def.default === null || !conv?.validate || !conv.fromAttribute) return false;
  return conv.fromAttribute(null, ABSENT_READER, def.attribute ?? def.configKey) === undefined;
}

/**
 * Property path: `converter.normalize(value)` (when the converter has one) →
 * `converter.validate(…)` → resolved value, or `null` when the value is rejected. A
 * converter without `validate` accepts any value. A `normalize` or `validate` that throws
 * counts as a rejection (the caller warns and keeps the previous value), the same rule the
 * attribute path applies to a throwing parse.
 *
 * @internal BlissElement plumbing — exported, but not part of the stable API.
 */
export function resolveFromProperty(def: InputDef, assigned: unknown): Resolved | null {
  const conv = def.converter;
  let value = assigned;
  if (conv?.normalize) {
    try {
      value = conv.normalize(assigned);
    } catch {
      return null;
    }
  }
  if (conv?.validate) {
    let isValid: boolean;
    try {
      isValid = conv.validate(value) && !(value === null && isNullRefusedByRowDefault(def));
    } catch {
      isValid = false;
    }
    if (!isValid) return null;
  }
  return { configKey: def.configKey, field: def.field, value, on: def.on ?? 'update' };
}

/**
 * Every row's "absent attribute" value — what the element holds for the input when nothing is set
 * (the same resolution the element seeds with and that removing the attribute resets to: the
 * converter's answer for a missing attribute, else the row `default`). `configKey` → value; a row
 * whose absent value is `undefined` is left out. `keys` limits the result to those `configKey`s
 * (unknown keys are skipped). A converter that throws for a missing attribute falls back to the
 * row `default`, as the element does. `getLiveValue` plays no part — this reads the table, not an
 * element.
 *
 * The one source for a public engine's defaults (rule C-CA-37: the engine's defaults = the
 * element's): `const ENGINE_DEFAULTS = Object.freeze(getInputDefaults(INPUTS, ENGINE_KEYS))`.
 */
export function getInputDefaults(inputs: readonly InputDef[], keys?: readonly string[]): Record<string, unknown> {
  const wanted = keys ? new Set(keys) : null;
  const out: Record<string, unknown> = {};
  for (const def of inputs) {
    if (wanted && !wanted.has(def.configKey)) continue;
    let value: unknown;
    try {
      value = resolveFromAttribute(def, null, ABSENT_READER).value;
    } catch {
      value = def.default;
    }
    if (value !== undefined) out[def.configKey] = value;
  }
  return out;
}

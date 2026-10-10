/**
 * Derive which inputs are *clearable* — i.e. ones for which `null` is a
 * meaningful, author-intended value rather than an accident. This is the
 * table-derived mechanism behind SPEC §11-amendment "null-clear" semantics:
 * when a component assembles its engine config, a `null` on a clearable key
 * must be FORWARDED (it means "reset to default / clear"), while a `null` on a
 * non-clearable key can be safely dropped.
 *
 * The key design point: clearability is NOT new metadata on the converter — it
 * is already fully determined by the converter's existing contract, so we probe
 * that contract instead of adding a parallel `isClearable` flag that could drift
 * from the real parse/validate logic (the exact drift this package exists to
 * eliminate):
 *
 * - PROPERTY path — `validate(null) === true` means an assigned `null` is an
 *   accepted value: nullable `toText`, tristate `toBool`, `toFunction` (a
 *   cleared callback).
 * - ATTRIBUTE path — `fromAttribute(null) === null` means an absent/removed
 *   attribute resolves to `null`: `toEnum({ shouldNullOnInvalid })` with no
 *   default, nullable `toText`. (`fromAttribute` is contractually called with
 *   `null` whenever an attribute is absent, so probing it with `null` is always
 *   safe — every converter must already handle it.)
 *
 * A converter whose unset value is `''`/`0`/`false`/`[]`/`undefined` is NOT
 * clearable: `null` can never legitimately appear in `#config` for it, so
 * dropping a stray `null` is correct.
 */
import type { AttrReader, Converter, InputDef } from './types.js';

/** A reader standing in for "no attribute present" while probing `fromAttribute(null)`. */
const ABSENT_READER: AttrReader = {
  getAttribute: () => null,
  hasAttribute: () => false,
};

/**
 * Does this converter admit `null` as a legitimate value? `true` when either
 * entry point accepts/produces `null` (see module doc). A converter that throws
 * while probing is treated as NOT clearable — the conservative choice, since the
 * caller then drops the `null` (today's behavior) rather than forwarding a value
 * it can't prove was intended.
 */
export function isClearableConverter(converter?: Converter<unknown>, attribute?: string): boolean {
  if (!converter) return false;
  try {
    if (converter.validate?.(null) === true) return true;
    if (converter.fromAttribute && converter.fromAttribute(null, ABSENT_READER, attribute ?? '') === null) return true;
  } catch {
    return false;
  }
  return false;
}

/** Is a change to this input's value legitimately clearable via `null`? */
export function isClearableInput(def: InputDef): boolean {
  // An explicit `default: null` on the row is also an author declaring null the
  // unset sentinel (e.g. a property-only callback with no converter-level signal).
  if (def.default === null) return true;
  return isClearableConverter(def.converter, def.attribute);
}

/** The set of `configKey`s whose `null` means "clear/reset" and must survive engine-config assembly. */
export function deriveClearableKeys(defs: readonly InputDef[]): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const def of defs) if (isClearableInput(def)) keys.add(def.configKey);
  return keys;
}

# Core review 2026-11-03 — slice 02: inputs / responsive / events / before-callback

Scope: `src/inputs/*`, `src/element/{responsive,context,events,dispatch,before-callback,define}.ts`
(+ the BlissElement call sites they feed), their unit tests, `e2e/{inputs,responsive,events,nullclear}.spec.ts`.
Probes were written as `__probe-inputs-{1,2,3}.test.ts`, run with vitest, and deleted.

**Cross-bundle globals:** none found in this slice. Responsive page state is on
`globalThis[Symbol.for('@keenmate/web-components-core:responsive')]`; the per-tag rule closures
live on the shared `window.components[tag]` object, and a second copy re-installing them adopts the
previous values. `VALIDATED` (a WeakSet keyed by class) and `define()` are safe per copy.

## Summary

| ID | Sev | Category | Where | One-liner | Status |
|---|---|---|---|---|---|
| I-01 | Medium | bug | converters.ts:58-71, bliss-element.ts:1458-1470 | Plain `toEnum(values)` turns an absent attribute into `null`, so a row `default` is silently dead (the sanity check skips `null`), and `el.x = null` is rejected | CONFIRMED |
| I-02 | Medium | bug | converters.ts:77-114 | `toInt`/`toFloat` use `parseInt`/`parseFloat`: `"12px"`→12, `"1.9"`→1, `"1e3"`→1, `"0x10"`→0, `"1,5"`→1 are accepted silently; `toFloat` accepts `"Infinity"` from an attribute but `validate(Infinity)` rejects it | CONFIRMED |
| I-03 | Medium | bug | context.ts:28-46, bliss-element.ts:1293-1317 | `emit()` writes into the caller's detail object in place: `eventContext()` extras are added as ENUMERABLE keys on user data, and when an object is reused the stale extras win over the current ones | CONFIRMED |
| I-04 | Medium | bug/design | before-callback.ts:59-77 | `runBeforeCallbackSync`: an `async` guard returning `false` counts as "continue" (the veto is bypassed), and a rejected Promise becomes an unhandled rejection | CONFIRMED |
| I-05 | Medium | design | bliss-element.ts:1855-1890 (refresh), 1631-1660 | Responsive overrides never run `getBatchValuesCallback`, so a rule that sets a preset input (`mode`) does not set the inputs that preset controls | CONFIRMED |
| I-06 | Low | bug | converters.ts:300,349; bliss-element.ts:1607-1627 | `toObject`/`toValue` `toAttribute` throws on circular data or a BigInt; on a reflected input the setter throws AFTER the value is staged, so the value is applied and the caller also gets an exception | CONFIRMED |
| I-07 | Low | docs-drift/naming | converters.ts:44-52, SPEC.md:170, 365-367, clearable.ts:69-71 | `shouldNullOnInvalid` no longer nulls anything: an invalid attribute reports invalid, so core keeps the previous value. It only means "the unset value is null" | CONFIRMED |
| I-08 | Low | design | apply.ts:47-51, bliss-element.ts:1595-1606 | `el.x = undefined` is handled differently per converter (rejected by most; STORED as `undefined` by `toValue`/`toCustom` without `validate`/`toFunction`). No property-path "reset to default", so a property-only input stays explicit for good and page responsive rules can never reach it again | CONFIRMED |
| I-09 | Low | bug | converters.ts:131-149 | `toText`: attribute `""` resets to the default, but property `""` is rejected and keeps the old value. `shouldTrim` only trims attributes; the property path stores `"  x "` as-is | CONFIRMED |
| I-10 | Low | bug | converters.ts:236-279 | `toList`: no escaping (`['a,b']` reflects and re-parses as `['a','b']`); `[]` reflects `""`, which re-parses to a non-empty `default` (seen on a clone); `"   "`→`['']`, `"a,b,"`→trailing `''`; int items use lenient `parseInt` (`"1.5,2abc"`→`[1,2]`) | CONFIRMED |
| I-11 | Low | bug/duplication | converters.ts:198-229; web-dropzone web-component.ts:94-140 | `toBytes` accepts `"1.2.3mb"` (as 1.2 MB), has no `k/m/g/t` aliases (so dropzone forked its own `parseBytes`, which also never reports invalid), and `validate` accepts fractional bytes | CONFIRMED |
| I-12 | Low | naming/consistency | converters.ts:64, 173, 136, 248 | `toEnum` neither trims nor ignores case; `toBool` does both. `toText` `shouldTrim` defaults to false, `toList` `shouldTrim` defaults to true | CONFIRMED (code) |
| I-13 | Low | bug | bliss-element.ts:1566-1574 | Assigning a non-function to an `on<Name>` twin quietly removes the handler with no warning (inputs warn and keep the old value) | CONFIRMED |
| I-14 | Low | design | bliss-element.ts:807, clearable.ts | `clearableConfigKeys` / `deriveClearableKeys` has no consumer in any component. It is also inaccurate: `toValue()` without `validate` accepts `null` but is reported as not clearable | CONFIRMED (grep + code) |
| I-15 | Low | design (speculative) | bliss-element.ts:1735-1760 | A responsive rule can set `isDisabled`, but overrides never reflect, so a form-associated host is not natively disabled (`disabled` attribute missing, still submits) | speculative |
| I-16 | Nit | duplication/docs-drift | responsive.ts:15-20, 125-159; bliss-element.ts:634-664, 1711-1728 | Map/callback validation exists twice with near-identical messages; `#setResponsiveFromAttribute` re-implements `parseJson`; the responsive.ts header says it holds "the pure layer merge", but `#mergeMap`/`#mergeRule` live in bliss-element | code |
| I-17 | Nit | design | bliss-element.ts:1703-1708, 1781 | A malformed GLOBAL map warns "once per element", which means N identical warnings for N instances | code |
| I-18 | — | test-gap | see list | Uncovered scenarios for the items above plus layering edge cases | — |

---

## Findings

### I-01 — Medium — bug — plain `toEnum` makes a row `default` dead without a warning; `null` works on the attribute path only
`src/inputs/converters.ts:58-71`; sanity check `src/element/bliss-element.ts:1458-1470`; `apply.ts:37`.

`fallback = opts.default ?? null`, and `fromAttribute(null)` returns it. With no converter default,
an absent attribute therefore resolves to `null`, not `undefined`. `resolveFromAttribute` applies the
row `default` only for `undefined`, so in
`{ converter: toEnum(['a','b']), default: 'a' }` the `'a'` never applies. The dead-default check
deliberately skips `null` answers, so nothing warns. The CEM / docs will still advertise `'a'`.
On top of that, `validate(null)` is `false` unless `shouldNullOnInvalid`: the attribute path produces
`null`, but the property path cannot set it.

- **Probe:** a fresh element with that row reads `el.mode === null`, with zero warnings.
- **Failure:** an author writes the "obvious" row-level default (the same pattern works for
  `toInt`/`toObject`, whose unset value is `undefined`) and ships `null` into the engine. A framework
  that clears a property with `el.monthLayout = null` (drp's `toEnum(MONTH_LAYOUTS)` rows) is
  rejected and the old value is kept.
- **Fix:** make plain `toEnum` return `undefined` when absent and there is no default, so the row
  default applies and `null` stays opt-in. Alternatively, have the sanity check warn whenever
  `default !== undefined && absent === null && !converter.validate?.(null)`.

### I-02 — Medium — bug — numeric parsing is lenient and disagrees with `validate`
`converters.ts:77-114`.

`toInt` uses `Number.parseInt(raw, 10)`; `toFloat` uses `Number.parseFloat`. Both read a numeric
prefix and ignore the rest. Probe results (none reported invalid):

| Input | Converter | Result |
|---|---|---|
| `"12px"` | `toInt` | 12 |
| `"1.9"` | `toInt` | 1 |
| `"1e3"` | `toInt` | 1 |
| `"0x10"` | `toInt` | 0 |
| `"1,5"` | `toFloat` | 1 (locale decimal comma) |
| `"Infinity"` | `toFloat` | `Infinity` |

The two paths disagree: `el.n = 1.9` is rejected (`Number.isInteger`), but `n="1.9"` gives 1.
`toFloat` stores `Infinity` from an attribute, but `validate(Infinity)` is false. `fromAttribute`
never applies `isNumber`, only `isNaN`.

- **Failure:** `page-size="1.5"` silently becomes 1. `max-height="300px"` (a typical author mistake)
  is taken as 300 with no warning, the opposite of the "warn + keep" rule.
- **Fix:** trim, then require a full match. Use `Number(s)`, with `s !== ''`, plus `isNumber(n)`
  (`Number.isInteger` / `Number.isFinite`) before the range check; anything else calls
  `reportInvalid`.

### I-03 — Medium — bug — `emit()` mutates caller-owned detail objects
`context.ts:28-46`, `bliss-element.ts:1293-1317`.

`withComponentContext` attaches the context to the object passed in, and `eventContext()` extras are
copied in as enumerable own properties. Keys the object already has win.

- **Probe:** `emit('change', data)` with `eventContext() → { tick }` leaves `Object.keys(data)` as
  `['a','tick']`. A second `emit` of the same object while the `tick` extra is 2 delivers `tick === 1`
  (stale). The non-enumerable `controller` / `element` stay on the user's object too, which pins the
  element in memory.
- **Failure:** `emit('select', option)` / `emit('change', this.#value)`, where `option` is the
  consumer's data row. The consumer's data gets `presentation` / `isFullscreen` keys, and they appear
  in `JSON.stringify` and in LiveView `pushEvent` payloads. A component that re-emits a cached detail
  sends stale presentation flags, breaking the doc promise "Called per emit, so it reflects the
  current state".
- **Fix:** always shallow-copy plain objects in `emit` (`{ ...detail }`; this already happens for
  frozen objects), or define the extras non-enumerable and overwrite them on every emit. At minimum,
  document "the detail must be a fresh literal" and add a dev warning when the detail's prototype is
  not `Object.prototype`.

### I-04 — Medium — bug/design — `runBeforeCallbackSync` lets an async veto through
`before-callback.ts:59-77`.

When the hook returns a thenable, the code warns and returns `CONTINUE`.

- **Probe:** `runBeforeCallbackSync(async () => false)` gives `{isRejected:false}`.
  `() => Promise.reject(..)` produces one unhandled rejection.
- **Failure:** a consumer writes `beforeDragCallback: async (ctx) => !(await isLocked(ctx))`. The
  drag (or keydown-delete) always proceeds, even though the module contract says "a crashed guard
  must not let a delete through". The thrown error surfaces only as an unhandled rejection.
- **Fix:** treat a returned Promise in the sync variant as **reject** (the safe answer; still warn),
  and attach `.catch(() => {})` (or a `report`) to it so the rejection is handled.

### I-05 — Medium — design — responsive overrides skip `getBatchValuesCallback`
`bliss-element.ts:1879-1890` (refresh stages through `#stageEffective`), `1631-1660`.

- **Probe:** an instance `responsiveCallback` returning `{ preset: 'p2' }` sets `preset` to `'p2'`,
  but the `label` that `p2`'s batch callback returns is never applied (it stays `'L'`).
- **Failure:** `window.components['web-grid'].responsive = { device: { mobile: { mode: 'excel' } } }`
  sets `mode`, but not the `editTrigger` / `isEditable` the `excel` mode implies, so the grid ends up
  in a half-configured state. SPEC §6.2 / §6.7 never say this; users will assume a responsive `mode`
  behaves like `el.mode = …`.
- **Fix:** in `#refreshResponsive`, for each changed rule key whose def has
  `getBatchValuesCallback`, merge its returned values into the same rule layer (the rule's own keys
  win, mirroring "explicit wins"). Otherwise, document the limitation in SPEC §6.7.

### I-06 — Low — bug — a throwing `toAttribute` escapes the setter after staging
`converters.ts:300,349`; `bliss-element.ts:1607-1627`.

`JSON.stringify` throws on circular data or a BigInt. `#stageExplicit` stages first and then calls
`#reflect`, so the exception leaves the setter after the value has already been applied.

- **Probe:** `el.obj = circular` on a reflected `toObject` row: the setter throws, yet
  `config.obj === circular`.
- **Fix:** wrap `converter.toAttribute` in `#reflect` with a try/catch: warn and leave the attribute
  unchanged (or remove it). Alternatively, make `toValue`/`toObject` `toAttribute` catch and return
  `null`. Applies to both the property and batch-value reflect paths.

### I-07 — Low — docs-drift/naming — `shouldNullOnInvalid` no longer does what its name says
`converters.ts:44-52, 58, 65`; SPEC §5 line 170 ("invalid → default (or null …)"); SPEC §6.1 /
`clearable.ts` / `engine-config.ts` list "a `shouldNullOnInvalid` enum" as a null producer.

Since `reportInvalid` was added, an invalid attribute keeps the previous value.

- **Probe:** `nmode="a"` then `nmode="zz"` reads `'a'` (the log shows "keeping previous value a").
  The returned `fallback` (`null`) is discarded.
- **What the flag still does:** only "the unset value is `null`, and property `null` is accepted"
  (when there is no default). With a `default` it does nothing on the attribute path and keeps
  property `null` rejected.
- **Fix:** rename it to `isNullable` (matching `toText`'s option, house boolean style, v2
  no-compat). Update the docstring, SPEC §5 line 170 and §6.1, and the clearable / engine-config
  docs.

### I-08 — Low — design — no property-path reset; `undefined` is inconsistent; explicit is permanent for property-only inputs
`apply.ts:47-51`, `bliss-element.ts:1595-1606`, SPEC §6.7 "Explicit tracking".

Assigning `undefined` behaves differently per converter:
- rejected with a warning by `toEnum` / `toInt` / `toText` / `toBool` / `toList` / `toObject` /
  `toObjectArray`;
- stored as `undefined` (not the default) by `toValue` without `validate`, `toCustom` without
  `validate`, and `toFunction`.

**Probe:** `el.val = undefined` with `default: 5` reads `undefined`.

Every accepted property write adds the key to `#explicit` for good. Only attribute removal clears it,
which a property-only input (no `attribute`) can never do. After one `el.labels = …`, page responsive
rules can never reach that input again on that element.

**Fix:** define `undefined` on the property path as "unset": reset to `def.default` (the same value
as `resolveFromAttribute(def, null)`) and remove the key from `#explicit`, mirroring
`removeAttribute`. Document it in SPEC §6 / §6.7.

### I-09 — Low — bug — `toText`: attribute and property disagree on `''` and on trimming
`converters.ts:131-149`.

- **Empty string:** `label=""` falls back to the default, but `el.label = ''` is rejected
  ("keeping previous value"). Framework bindings (Vue/Svelte property binding of a cleared input)
  therefore cannot clear a text input; it sticks at the previous text.
- **Trimming:** with `shouldTrim`, the attribute `"  "` becomes `''` (then the default), but
  `validate('   ')` is `true` and the property stores `'   '` untrimmed (probe). `validate` is a
  predicate, so the converter has no way to normalize property values.
- **Fix:** have property `''` (without `isEmptyAllowed`) resolve like the attribute `''` (reset to
  the fallback, not a rejection). Longer term, add an optional `Converter.normalize(value)` for the
  property path, so `shouldTrim` / `toList` trimming apply to both paths.

### I-10 — Low — bug — `toList` round-trip and edge cases
`converters.ts:236-279`.

Probe results:
- `toAttribute(['a,b'])` is `"a,b"`, which re-parses as `['a','b']`. There is no escaping or quoting.
- `toAttribute([])` is `""`, which re-parses to `default` (`['x']`). A reflected
  `el.list = []` therefore reads `['x']` on a `cloneNode` / SSR rehydrate.
- `"   "` gives `['']`, and `"a,b,"` keeps a trailing `''` (neither treated as blank nor reported).
- int lists use `parseInt`: `"1.5,2abc"` gives `[1,2]` silently (same root cause as I-02).
- The `reportInvalid` reason says "integers" for string lists too (only reachable with
  `requiredCount`).

**Fix:**
- Trim `raw` before the blank check.
- Drop empty items, or report them.
- Use strict integer parsing.
- Either document "items cannot contain the separator" and have `validate` reject such items, or
  support `\`-escaping.
- Reflect `[]` as the attribute's absence only when `default` is empty.

### I-11 — Low — bug/duplication — `toBytes` is too strict and too lax at once
`converters.ts:198-229`; fork in `web-dropzone/packages/web-dropzone/src/web-component.ts:94-140`.

- **Too lax:** the regex `[\d.]+` accepts `"1.2.3mb"`, which parses as 1.2 MB (1258291) without a
  report.
- **Too strict:** `"1k"`, `"5M"`, `"1KiB"` and `"1e3"` are rejected. Dropzone forked its own
  `parseBytes` with `k/m/g/t` aliases (and that fork's wrapper never calls `reportInvalid`, so
  dropzone silently falls back).
- **Property path:** `validate` accepts `1.5` bytes and has no `min`/`max`, unlike `toInt`.
- **Fix:** regex `^\s*(\d+(?:\.\d+)?)\s*([kmgt]i?b?|b)?\s*$`i, plus `{ min?, max? }` and an integer
  `validate`. Then delete dropzone's `parseBytes`.

### I-12 — Low — naming/consistency — parsing conventions differ per converter
- `toEnum` (`:64`) is exact-match with no trim, so `mode=" a"` and `mode="A"` are invalid.
  `toBool` (`:173`) trims and lowercases.
- `toText` `shouldTrim` defaults to **false** (`:136`); `toList` `shouldTrim` defaults to **true**
  (`:248`, `=== false`).
- **Fix:** pick one rule (suggested: trim attribute strings everywhere, which is safe for
  enums/numbers) and an explicit `isCaseInsensitive` option for `toEnum`. Make `shouldTrim`'s default
  the same everywhere, or rename the list option.

### I-13 — Low — bug — event twin setter silently clears on a non-function
`bliss-element.ts:1566-1574`.

- **Probe:** `el.onChange = 'alert(1)'` reads back `null` with 0 warnings, and any previously set
  handler is dropped.
- Inputs use "warn + keep previous"; `toFunction` accepts only function / `null` / `undefined`.
- **Fix:** accept `null` / `undefined` as clear; anything else warns through `#warn` and keeps the
  previous handler.

### I-14 — Low — design — `clearableConfigKeys` is dead API and imprecise
`bliss-element.ts:797-809`, `clearable.ts`.

- No component in `C:\Git\KM\web-*` reads `clearableConfigKeys` or `deriveClearableKeys`. Since
  `engineConfig()` preserves every `null` regardless, the set has no runtime effect.
- The probe misses converters that accept `null` without saying so: `toValue()` / `toCustom()` with
  no `validate` accept `null` on the property path (so `null` can appear in `config`), but
  `isClearableConverter` returns false.
- The `isClearableConverter` probe also calls `fromAttribute` without `reportInvalid`, which is fine.
- **Fix:** either drop the protected getter (keep the helper for tests), or document that it is
  advisory and treat "`validate` absent" as clearable.

### I-15 — Low — design (speculative) — responsive `isDisabled` bypasses native disabling
`bliss-element.ts:1735-1760` (`#mergeRule`); SPEC §6.4 "`isDisabled` must reflect".

`RESPONSIVE_RESERVED_KEYS` is only `responsive` / `responsiveCallback` / `shouldDefer`. A rule
returning `{ isDisabled: true }` changes the effective config, but overrides never reflect. The
host's own `disabled` attribute therefore stays absent: the browser does not treat the element as
disabled (`:disabled`, form submission), while the component may render as disabled. Not probed
(needs a form-associated fixture and `#syncDisabled` behaviour, which is in the other reviewer's
slice).

**Fix:** reserve `isDisabled` (and other `attribute: 'disabled'` rows), or reflect effective values
for inputs the platform reads by attribute.

### I-16 — Nit — duplication/docs-drift
- Responsive map/callback validation exists twice with near-identical messages:
  `defineRuleAccessors` setMap/setCallback (`responsive.ts:139-154`) and the BlissElement
  `responsive` / `responsiveCallback` setters (`bliss-element.ts:638-664`).
- `#setResponsiveFromAttribute` (`:1711-1728`) re-implements `parseJson` (blank → unset, malformed →
  invalid). It could be `toObject({ validate: isResponsiveMap })` plus `null`.
- The `responsive.ts` header (`:17-19`) says the module holds "the pure layer merge", but the merge
  lives in BlissElement private methods. Moving `#mergeMap` / `#mergeRule` (with a `def` lookup
  callback) into `responsive.ts` would make them unit-testable without DOM.

### I-17 — Nit — design — global-map warnings repeat per instance
`#warnResponsiveOnce` keys its dedupe set per element. A malformed
`window.components.responsive` (e.g. the old `{ mobile: … }` shape) logs the same warning once per
instance: 200 grid cells means 200 warnings. A page-level warning should be deduped on the shared
page state (`globalThis` symbol).

### I-18 — test-gaps (concrete uncovered scenarios)

**Unit tests (converters.test.ts / element tests):**
1. `toInt` / `toFloat` with trailing garbage (`"12px"`), fractions (`"1.9"`), exponent (`"1e3"`),
   hex, `"Infinity"`, `"-5"` with `min: 0`, whitespace-padded `" 5 "`. Only NaN and range are tested
   today.
2. `toEnum(values)` with no converter default plus a row `default` (I-01); `el.x = null` on a plain
   enum.
3. `shouldNullOnInvalid`: invalid AFTER a valid value (keeps the previous value; I-07). The current
   test asserts the converter's raw return only.
4. `toText` property `''` vs attribute `''`; `shouldTrim` on the property path.
5. `toList` round-trip: `toAttribute` then `fromAttribute` for items containing the separator; `[]`
   with a non-empty default; whitespace-only raw; trailing separator; `"1.5"` int item.
6. `toBytes` `"1.2.3mb"`, `"1k"`, whitespace/case (`" 10 MB "`), `validate(1.5)`.
7. Reflection of an unserialisable `toObject` / `toValue` value (I-06).
8. Property `undefined` per converter family (I-08).
9. `emit` with a reused / caller-owned object: no enumerable keys added, extras current (I-03).
10. `runBeforeCallbackSync` with an `async` hook returning `false`, and with a rejecting Promise
    (I-04). The existing test only checks "warn + continue".
11. `runBeforeCallbackEager` with a non-Promise thenable.
12. Twin property assigned a non-function (I-13); two events declaring the same `property`.
13. Responsive:
    - a rule key with `getBatchValuesCallback` (I-05);
    - a rule on an `on:'none'` input;
    - a rule on a `field`-backed input;
    - `responsive="null"` / `"[]"` attribute;
    - page rules changed while the element is detached, then reconnected;
    - property-only input explicit forever (I-08);
    - a second core copy (`vi.resetModules()` + re-import) sharing the page state and re-installing
      per-tag hooks.
14. `define()` when the name is taken by a different constructor (silently skipped; deliberate for
    cross-bundle, but untested).

**e2e:**
- `nullclear.spec.ts` covers only one input type (2 tests). It has nothing for a tristate `toBool`,
  a `toFunction` clear, or a nullable enum through `engineConfig()`.
- `inputs.spec.ts` has no numeric / list / bytes attribute cases at all.
- `events.spec.ts` doesn't cover `runBeforeCallbackSync`.
- `responsive.spec.ts` has no per-tag-callback or reserved-key cases.

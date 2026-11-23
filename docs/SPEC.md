# `@keenmate/web-components-core` — design spec

**Status:** v1 implemented under `src/` (TypeScript + Vitest, 35 tests). This
file remains the design source of truth; the §11 decisions below are resolved
and reflected in the code.
**Repo:** `C:\Git\KM\web-components-core` → npm `@keenmate/web-components-core`.
**v1 scope (agreed):** the **reactive input model** (converter-driven
attribute/property/callback definitions) and the **`BlissElement` base
class** (observed-attributes / `attributeChangedCallback` / property
reactivity / batching / SSR stub / `define` / typed event dispatch).
Additional shared functionality (logger, positioning, …) is tracked in
§12 for discussion, not part of v1.

Grounded in a survey of five shipping components (§1) — but the design
is chosen on merit, not on what the repos happen to do today.

---

## 1. Why — the divergence we're consolidating

Every `web-*` component re-implements the same element plumbing, and has
drifted into **four different dialects of the attribute table** plus
private copies of the same base wiring:

| Component | Layout | Attribute model | Base-element wiring |
|---|---|---|---|
| **web-multiselect** | single-pkg | string-tag: `parser:'enum', enumValues:[…]` + central switch | local SSR stub; `setProperties()` batching |
| **web-daterangepicker** | single-pkg | **functions**: `parseEnum(CONST)`, `parsePipeDelimitedList(12)`, … | local SSR stub |
| **web-treeview** | single-pkg | **`{ kind:'string'\|'number'\|'boolean'\|'enum' }`** union + `field` | local SSR stub |
| **web-dropzone** | monorepo + `web-dropzone-core` | string-tag, extended with a `'bytes'` tag | **`SatelliteElement` base** + `resolveEnumAttribute()` + scheduler; **5 elements** |
| **web-grid** | monorepo | **none** — config-object / property driven | `GridElement extends HTMLElement` (no SSR stub) |

Requirements this surfaces (not a design):

- Cover **enums (exact match), numbers, strings, custom parsers
  (month-names, `'auto'\|0..6`), and callbacks** — each input **reactive**.
- The attribute table must be **opt-in** (web-grid has none).
- Multi-element packages exist (dropzone's 5); the base must serve N
  elements per package.
- The string-tag menu keeps needing extension (dropzone `'bytes'`,
  treeview `field`) — a closed set is a maintenance tax.

---

## 2. Design priorities (the decision that drove this design)

Two separable concerns, **not** equal weight:

1. **PRIMARY — definition ergonomics + parsing/validation correctness +
   reactivity.** One unified, very solid way to declare every input and
   guarantee incoming values are validated and correctly parsed.
2. **SECONDARY — docs / IntelliSense.** Fed from **JSDoc comments** (the
   BlissFramework C-CEM-13 canonical format). Autodetection of enum
   values is a nice-to-have, **not** something the structure stands on.

Because introspection is *not* load-bearing, the parser does **not** need
to be a closed, machine-readable `{ kind }` union (that form hits a wall
the moment a component needs something new). Behavior is expressed as
**functions**; correctness is enforced by **converters**; docs come from
**comments**. That is the model below.

---

## 3. Package layout (v1)

```
web-components-core/                 (@keenmate/web-components-core)
├── src/
│   ├── inputs/
│   │   ├── types.ts        ← Converter, InputDef
│   │   ├── converters.ts   ← toEnum, toInt, toFloat, toBool, toText, toList, toBytes, toCustom, toFunction
│   │   └── apply.ts        ← the parse+validate+stage pipeline
│   ├── element/
│   │   ├── bliss-element.ts ← base: SSR stub, observedAttributes, attr+property reactivity, batching
│   │   ├── dispatch.ts      ← typed CustomEvent helper
│   │   └── define.ts        ← idempotent customElements.define wrapper
│   ├── dom/
│   │   └── microtask-scheduler.ts      (lifted from dropzone)
│   └── index.ts
```

Consumed as a normal runtime `dependency`, bundled into each component's
`dist` (they already bundle `@floating-ui/dom`).

---

## 4. The model — one reactive input table

Every public input — attribute, complex property, or callback — is one
row. Each row names it, says how to turn an incoming value into a correct
typed value, its default, and what a change triggers. There is **no
central switch**: dispatch is `def.converter.fromAttribute(raw)`.

```ts
export type AttrReader = { getAttribute(n: string): string | null; hasAttribute(n: string): boolean };

export type Reactivity = 'update' | 'reinit' | 'none';   // apply in place / full rebuild / store only

export interface Converter<V> {
  /** attribute path: raw string (null when absent/removed) → validated V (or fallback).
   *  Call reportInvalid for an unusable present value (§6: warn + keep previous). */
  fromAttribute?(raw: string | null, el: AttrReader, attr: string,
                 reportInvalid?: (reason?: string) => void): V;
  /** property path, before validate: adjust an assigned value the way fromAttribute
   *  adjusts a string (trim, '' → fallback), so both paths store the same value (rc19). */
  normalize?(value: unknown): unknown;
  /** property path: is this JS-assigned value acceptable? (callbacks, arrays, objects). */
  validate?(value: unknown): value is V;
  /** optional reflect V → attribute string. */
  toAttribute?(value: V): string | null;
}

export interface InputDef<V = unknown> {
  /** config option key, e.g. 'selectionMode' / 'getBadgeDisplayCallback'. */
  configKey: string;
  /** kebab attribute name; OMIT for property-only inputs (callbacks, rich objects). */
  attribute?: string;
  /** optional private backing field to also set, e.g. '_treeId' (treeview pattern). */
  field?: string;
  /** how to parse (attribute) and validate (property). */
  converter?: Converter<V>;
  default?: V;
  /** what a change triggers. Default 'update'. */
  on?: Reactivity;
  /** reflect property → attribute? */
  shouldReflect?: boolean;
  /** other inputs this value also sets, in the same batch (§6.2). */
  getBatchValuesCallback?: (value: V, config: Readonly<Record<string, unknown>>) =>
    Record<string, unknown> | null | undefined;
  /** live read-back for the property getter (§4.1). */
  getLiveValue?(el: HTMLElement): V | undefined;
}
```

One converter per input owns **both** parsing (from an attribute string)
and validation (of a JS-assigned value) — correctness lives in one place
and can't drift across the three spots it used to.

### 4.1 Live read-back (`getLiveValue`)

Some inputs seed state the component then owns and changes: tree `nodes` the
user edits, grid `items` after `addRow()`, multiselect `options` with added-new
entries. Without help the generated getter returns the *assigned* snapshot, so
`el.nodes` would be stale. An optional `getLiveValue(el)` on the row makes the
**getter** return the live state:

- Consulted only after the element's first successful `reinit()`; before that
  (detached, `defer` holding, never connected) the getter returns the stored value.
- Not while a write to that input is staged but not yet applied (`el.nodes = x;
  el.nodes` returns `x` until the flush), nor after a `reinit()` threw (the
  structure may be half-built) until a rebuild succeeds.
- Returning `undefined` falls back to the stored value.
- Read side only: the setter path (parse / validate / stage / batch /
  `reinit()` / `update()`) is unchanged and `this.config[configKey]` keeps the
  **assigned** value — a rebuild reads `config`, never the live getter.
  Reflection (`shouldReflect`) reflects the assigned value too.
- Not with `on: 'none'` (rc19, review E-15): such a write is never staged and never reaches
  the component, so its live state can't follow it and the getter would ignore every
  assignment. The table sanity check warns. Read-only state is a plain getter on the class
  (no row); `getLiveValue` is for settable inputs whose writes reach the component.
- Declared with method syntax, so a row may type `el` as its own class
  (`getLiveValue: (el: MyTree) => el.tree?.nodes`). A non-function value is
  flagged by the table sanity check and ignored.

---

## 5. Converter library (`to*` factories)

Common cases stay one-liners; the converter is where "ensure the value is
correct" is enforced. Naming: `to<Type>` — "convert the raw value to a …".

```ts
toEnum(values, { default?, isNullable? })  // match (attribute trimmed, case-insensitive → declared spelling) against the set; invalid → default (or null; with no default, el.x = null clears it too)
toInt({ min?, max?, default?, isNullable? }) // isNullable: absent / empty → null (like toText); the WHOLE (trimmed) attribute is a base-10 integer + range-check; "12px" / "1.9" / "1e3" / "0x10" are invalid
toFloat({ min?, max?, default? })              // the whole attribute is a finite decimal ("1.5", "-2e3"); "1.5em" / "1,5" / "Infinity" are invalid
toCssLength({ default?, allowNegative?, keywords? })  // a CSS length for style-only inputs: "12px" | "2rem" | "50%" | calc(…) | var(…); a bare number (attribute or property) → px
toText({ shouldTrim?, isEmptyAllowed?, isNullable?, default? })  // string (NOT toString). isNullable:true → absent/empty is null (optional string), not ''
toBool('default-false' | 'default-true' | 'tristate' | 'presence')  // mode REQUIRED; presence = native rule (any value, "false" too → true) — for disabled/readonly only; reflecting the mode's absent value (false / true / null / false) REMOVES the attribute (absent == default), any other value writes "true" / "false" (presence: bare)
toBytes({ default? })                          // binary units, case-insensitive: "10mb" → 10485760, "300 kB", "1.5G", "5MiB"; "1.2.3mb" / "1.5b" invalid
toList({ itemType: 'string' | 'int', separator?, requiredCount? }) // CSV / pipe-list or a JSON array (int items: whole-string integers; an empty item — "a,b," / "a,,b" — is invalid, write ["a",""] for one), optional fixed length; reflects JSON when an item holds the separator or is empty, [] as "[]"
toCustom(parseFn)                              // wrap any bespoke parser  (month-names, 'auto'|0..6)
toFunction()                                   // callback: property-only, validates typeof === 'function'
toValue({ validate?, default? })               // rich value; property = validate, attribute = JSON, reflects JSON
toObjectArray({ validateItem?, default? })     // array of rich items (e.g. `options`); property = array, attribute = JSON; default []
toObject({ validate?, default? })              // plain (non-array) object; property = object, attribute = JSON; with NO default (converter or row) el.x = null clears it, with one null is refused
```

**Numbers vs CSS lengths.** An input the component does arithmetic with (a row
height, an offset fed to positioning) is a number of pixels — `toInt` / `toFloat`,
documented as "pixels"; a unit there is invalid instead of silently truncated. An
input that only ends up in a style or a CSS variable is a `toCssLength`, so `2rem`
and `50%` are legitimate. The attribute shorthand `max-width="120"` means `120px`;
the property path takes a length string (`el.maxWidth = '20rem'`) or a number, also pixels (`el.maxWidth = 120` → `"120px"`).

`toValue`/`toObjectArray`/`toObject` are the rich-data family: property-first
(the shape check IS the `validate`), with a JSON attribute path when the input
declares an `attribute`. They are the core home for the "property-only array /
object" pattern components used to hand-write (SPEC gap #2, resolved).

Each factory returns a `Converter<V>`; `toEnum`/`toList`/… set both
`fromAttribute` and `validate` from the same inputs, so a property
assignment is validated against the same rules an attribute is parsed by.
A brand-new input type is just a **new converter created anywhere** (in
core or a component) — no core edit, no closed union.

Every factory calls `reportInvalid(reason)` when a *present* attribute value
can't be used (`page-size="abc"`, `mode="exel"`, malformed JSON, …), so core can
warn and keep the previous value (§6). Never reported: an absent/removed
attribute, `toText` (any string is text; `''` without `isEmptyAllowed` is
"unset" — on the property path too: `el.label = ''` stores the fallback like `label=""`, and
`shouldTrim` trims assigned strings, through `normalize`, review I-09), `toBool('presence')` (any value means on), a blank list/JSON. A custom
converter that doesn't call it keeps the old behaviour — its fallback applies
silently. `toCustom(parse)` passes `reportInvalid` to `parse` as a 2nd argument.

### Mapping the requirements

```ts
// exact-match enum
{ configKey:'selectionMode', attribute:'selection-mode', converter: toEnum(SELECTION_MODES, {default:'single'}), on:'update' }
// number
{ configKey:'optionHeight', attribute:'option-height', converter: toInt({ min:1, default:50 }) }
// string
{ configKey:'searchPlaceholder', attribute:'search-placeholder', converter: toText({ default:'Search...' }) }
// custom parser (month-names → 12-item array)
{ configKey:'monthNames', attribute:'month-names', converter: toCustom(parseMonthNames), on:'reinit' }
// the 'auto' | 0..6 case
{ configKey:'weekStartDay', attribute:'week-start-day', converter: toCustom(parseWeekStartDay) }
// callback (property-only, reactive)
{ configKey:'getBadgeDisplayCallback', converter: toFunction(), on:'update' }
```

---

## 6. Reactive engine — `BlissElement`

SSR-safe (the `typeof HTMLElement` stub every repo copies). Wires inputs
**only if the subclass provides a table** — web-grid can extend it for
the SSR base + `dispatch` and skip the table.

```ts
const Base = (typeof HTMLElement !== 'undefined' ? HTMLElement : class {}) as typeof HTMLElement;

export abstract class BlissElement extends Base {
  protected static inputs?: readonly InputDef[];

  static get observedAttributes(): string[] {
    return (this.inputs ?? []).filter(d => d.attribute).map(d => d.attribute!);
  }

  // ATTRIBUTE path → converter.fromAttribute → stage → dispatch per `on`
  attributeChangedCallback(name: string, _old: string | null, raw: string | null): void { /* … */ }

  // PROPERTY path: base generates get/set per configKey → converter.validate → stage → dispatch per `on`
  //   el.selectionMode = 'range'          → reactive
  //   el.getBadgeDisplayCallback = fn     → reactive (callbacks too)

  // BATCHING: setProperties({...}) / batch(fn) coalesce many changes into ONE reinit()/update()
  //   setProperties keys = configKey or attribute name, plus the core-declared shouldDefer/defer,
  //   themeSource/theme-source, responsive, responsiveCallback; any other key WARNS and is skipped
  //   (a renamed/misspelled key must never vanish silently).
  setProperties(values: Record<string, unknown>): void { /* … */ }
  batch(fn: () => void): void { /* … */ }

  // Every hook below stays `protected` in a subclass (rulebook C-CA-14): a public override
  // (`el.update(props)`) would skip parse/validation and this.config — writing many inputs at
  // once is setProperties() / batch() above.
  /** Full rebuild (reads this.config). Called on first connect and on any `on:'reinit'` change. */
  protected reinit(): void { /* opt-in, no-op by default */ }
  /** In-place patch of the changed `on:'update'` keys. Called only when no reinit key changed. */
  protected update(partial: Record<string, unknown>): void { /* opt-in, no-op by default */ }

  // LIFECYCLE: build-once + activate/deactivate (Lit's model). connect()/disconnect()
  // fire on EVERY connect/disconnect; a plain DOM move re-activates, never rebuilds.
  /** Start live resources (listeners, observers, floating-ui autoUpdate). Every connect, after reinit/update. */
  protected connect(): void { /* opt-in, no-op by default */ }
  /** Stop what connect() started. Every disconnect. Shadow DOM persists — don't tear down structure. */
  protected disconnect(): void { /* opt-in, no-op by default */ }
  /** Really removed (still detached one animation frame after disconnect). Opt-in by overriding. */
  protected removedCallback(): void { /* opt-in, no-op by default */ }
  /** Final teardown (§6.5): disconnect() if active, cancel timers, then destroyCallback(). Idempotent. */
  destroy(): void;
  readonly isDestroyed: boolean;
  /** The component's own cleanup, called once by destroy(). */
  protected destroyCallback(): void { /* opt-in, no-op by default */ }

  // DEFER / READY (§6.3): `defer` attribute / `shouldDefer` property holds the first build until release().
  shouldDefer: boolean;
  release(): void;
  readonly isReady: boolean;            // + `ready` attribute, :state(ready), `ready` event / onReady
  whenReady(): Promise<void>;

  // DIRECTION: `dir` is always observed (a global attribute, never an input).
  /** Effective writing direction is RTL (resolves CSS `direction`: element, ancestor, <html>, or a rule). */
  protected get isRtl(): boolean { /* … */ }
  /** Runtime `dir` change on the element (post-connect only). Re-mirror live DOM without a rebuild. */
  protected directionChanged(isRtl: boolean): void { /* opt-in, no-op by default */ }
}
```

The **same pipeline serves both entry points** — attributes *and*
properties/callbacks — so everything is reactive by construction:

- **Attribute change** → `converter.fromAttribute(raw)` → stage → dispatch.
- **Property assignment** → `converter.validate(value)` → stage → dispatch.
- **Dual-path** (month-names as a pipe-string *or* an array): same row,
  `fromAttribute` handles the string, `validate` guards the array.
- **Batching** coalesces bursts, then dispatches to exactly one hook:
  `reinit()` if the batch touched any `on:'reinit'` input (it reads the
  already-merged `this.config`, so it absorbs any `update` keys in the same
  batch), otherwise `update(partial)` with just the changed `update` keys.
  A change is always staged into `config` before either hook fires, and
  `on:'none'` inputs are stored without firing either hook.
- **An equal write still dispatches** (review E-13, by design). `el.x = el.x`, or an attribute
  set to the value it already has, runs the pipeline like any other accepted write: `reinit()`
  for an `on:'reinit'` input, `update()` with the key for an `on:'update'` one. Re-setting a value
  is the way to re-trigger it (`el.initialDate = sameDate` jumps back after the user navigated
  away; a mutated array re-assigned refreshes). Frameworks already skip unchanged props, so this
  costs nothing in practice. A component that wants to skip an equal value compares in `update()`.
- **Reactivity contract** declared per input (`on`) and enforced
  centrally — no input can be added that forgets to parse, validate, or
  react.
- **Lifecycle** is build-once + activate/deactivate (Lit's model). `reinit()`
  builds structure; `connect()`/`disconnect()` start/stop live resources on
  every connect/disconnect. Connect order is `reinit()`/`update()` (for any
  pending config) then `connect()`. A DOM move (reorder, re-parent) fires
  `disconnect()`→`connect()` and re-activates **without** rebuilding, so
  transient UI state (scroll, focus, open panels) survives. Config changed while
  detached is held and applied on reconnect, before `connect()`. A throwing
  `reinit()`/`update()` is rethrown but doesn't wedge the element: settle
  waiters resolve, a failed `reinit()` is retried on the next flush, and
  `connect()` waits for a successful build (`disconnect()` runs only after
  `connect()` did). **No nesting (rc25):** a DOM write to an observed attribute
  flushes the browser's custom-element reaction queue, so during a move a
  `disconnect()` that removes such an attribute would get the already-queued
  `connectedCallback` run INSIDE it (and a `disconnectedCallback` queued behind a
  `connectedCallback` would arrive inside `connect()`). Core defers a lifecycle
  callback that arrives while another runs and replays it, in arrival order, right
  after — `connect()` / `disconnect()` always alternate and never nest; a move whose
  `disconnect()` writes attributes still ends active, still without a rebuild, and
  the pending removal check is cancelled as for any move.
- **Removal vs move** — `removedCallback()` (opt-in: the base schedules the
  check only when a subclass overrides it) fires after `disconnect()` once the
  element is still detached at the next animation frame (a macrotask where rAF
  is unavailable or the document is hidden). A synchronous move never fires it.
  Use it for teardown that must survive a move but not a removal (cancel uploads,
  `destroy()`). Re-adding the element after it fired is a fresh activation:
  `connect()` runs as usual (no forced `reinit()`); a subclass that tore its
  structure down in the hook rebuilds it in `connect()`.

Plus a typed `dispatch(el, name, detail, {bubbles=true, composed=true})`
and the generic DOM util `createMicrotaskScheduler` lifted from dropzone
(dropzone's `resolveEnumAttribute` was dropped: `toEnum` covers it). The store/satellite topology stays dropzone-local.

The `static inputs` table is sanity-checked once per class at construction
(warn-only, never throws): duplicate `configKey`/`attribute`, `shouldReflect:true`
without an `attribute` / without `converter.toAttribute`, or a **dead `default`** — the
converter answers a missing attribute with a concrete value other than the row's `default`
(`toBool('default-false')` + `default: true`, `toText()` + `default: 'Hello'`), which then
never applies, because the converter's answer wins and `default` fills in only for
`undefined`. A `null` answer is exempt — the null-clear "unset, the engine decides" sentinel,
where `default` documents the engine's value. Also a `configKey` that names the component's
OWN getter / setter / method (rc20, sweep C-A3): the input accessor is installed on the
instance and silently replaces it, so that member is dead code that looks live (web-grid had
64) — live state goes in the row's `getLiveValue`. Removing an attribute is reactive — it resets
that input to its `default` (absent == default). Assigning `el.x = undefined` does the same
on the property path (since rc19): the absent value, and the input is no longer explicit.

**Invalid values — one rule for both paths: warn and keep the previous value.**
A property value `validate` rejects, and an attribute value the converter reports
invalid (or whose converter throws), both warn and stage nothing — no
`reinit()`/`update()`, and the write isn't explicit for §6.2. Before any valid
value the previous value is the default, so `<x page-size="abc">` in markup ends
at the default. After a rejected attribute, an input with `shouldReflect` writes
its current value back (before the first connect: at that connect's flush), so
the DOM shows what the element uses; a non-reflected input leaves the markup
alone. The write-back runs inside the reflect guard, so it can't re-enter. "Writes back"
follows the converter's `toAttribute`, so a value at the default may mean REMOVING the
attribute (`toBool('default-false')` keeping `false` → `open="maybe"` is removed, never
`open="false"`) — absent == default holds for reflection too (rc25).

The warning goes through the element's instance logger (`INIT` category, else the
bundle's first; `[CORE:ELEMENT] tag#id` when the tag has no logging bundle) — it is
visible at the default `warn` level and silenced by `disableLogging()` like any
other line. *(Amended: these warnings used to bypass the loggers via a direct
`console.warn`; that exception was revoked — core has no direct `console` calls,
§12.1.)*

**The page is told: `input-rejected`.** `setAttribute()` and a property assignment
can't return anything (the browser's API), so every refused write also fires the
core event **`input-rejected`** (twin `onInputRejected`; bubbles, not composed),
synchronously — it has fired when the write returns — with an `InputRejection`
detail `{ configKey, attribute?, value, reason?, kept, source: 'attribute' |
'property' }`: `value` is the raw string on the attribute path, `kept` what the
getter now returns, `reason` the converter's `reportInvalid` text (attribute path;
`validate()` only answers yes / no). It covers table inputs, the core-declared
`motion` / `responsive` / `responsiveCallback`, and unknown `setProperties()` keys
(`kept: undefined`). **`setProperties()` returns the rejections of its call**
(`[]` when everything applied). A rejection during the constructor (a value assigned
before upgrade) fires on the next microtask. Not reported here: a bad value from a
responsive rule or a `getBatchValuesCallback` (page / component configuration, not
a write — they keep their warning only).

**Values assigned before upgrade ("lazy properties").** `el.x = v` on a not-yet-defined
element stores an own data property that would hide the class accessor forever. Core lifts
every such property at construction and routes it through the real accessor: input rows and
`on*` twins and the core-declared properties at once, in the constructor; the component's OWN
accessors (a getter / setter on the subclass prototype chain that is not an input — `value`,
`items`, `columns`) are taken off in the constructor and replayed through their setter once the
subclass is constructed (its private fields exist): at the first `connectedCallback`, before
the first build, or a microtask later for an element that isn't attached. A getter-only accessor
assigned early is dropped with a warning; a throwing setter is logged. Plain fields and methods
are not touched. Components write no rescue code of their own (sweep C-A1, rc20).

### 6.1 The null-clear contract (`BlissElement` ↔ engine)

The `partial` handed to `update()`, and the config an engine receives, carry
**two distinct absent-sentinels — do not conflate them:**

- **`undefined` = "not in this batch, leave it alone."** A key the batch did not
  change is simply absent from the partial, so it reads back as `undefined`.
  This is what lets a partial resend omit untouched keys.
- **`null` = "explicitly cleared — reset it."** A real value, produced when a
  nullable input is emptied (`removeAttribute`, or `el.prop = null`). It is the
  input's declared *unset* state and is seeded as the value at construction, so
  a set→clear round-trip returns the field to how it was born.

A value is only ever `null` in `config` when the input's descriptor admits
`null` (nullable `toText`, tristate `toBool`, `toFunction`, a
`isNullable` enum, a `toObject()` with no default, or a `default: null` row — see
`clearableConfigKeys`). The rule for `null` as "unset" is the same everywhere: admitted
only when the input has NO default. A converter that leaves its absent value to the row
(`fromAttribute(null)` → `undefined`, e.g. `toObject()`) can't see the row's `default`,
so core refuses the `null` for a row with a real `default` (`isNullRefusedByRowDefault`,
`resolveFromProperty`) and that row is not clearable; `el.x = undefined` resets it. So **null is always intentional; never drop it.**

**Component side.** Assemble the engine config with
`this.getEngineConfig(excludeKeys)` (→ `collectEngineConfig`): a shallow copy of
`config`, `exclude` keys removed, **every `null` preserved**. Never hand-roll a
`if (value === null) delete cfg[key]` loop — dropping the clear is the bug this
replaces (it made clearing a nullable input a silent no-op across every
component).

```ts
protected override update(partial = {}) {
  const cfg = this.getEngineConfig(NON_ENGINE_KEYS); // nulls intact
  Object.assign(cfg, partial);                    // partial already carries null
  this.#engine.update(cfg);
}
```

**Engine side.** The merge must treat `null` as a real value, per field:

- **Clearable field** (`focusedNodeClass`, …): `this._x = updates.x` — `null`
  clears it.
- **Defaulted field** (icon classes, `isSorted`, …): `this._x = updates.x ?? DEFAULT`
  — `null` resolves to the default.
- The `if (updates.x !== undefined)` guard **stays** — it is what skips untouched
  keys. Because a cleared key arrives *present with `null`* (not absent), it
  passes the guard and lands. A field that is neither clearable nor
  `?? DEFAULT`-guarded (a raw `this._x = updates.x` later dereferenced) will now
  receive `null` where it used to receive nothing — that is a latent bug the old
  drop-the-null behavior hid; fix the merge, don't re-drop the null.

### 6.2 Batch values — one input that also sets others (`getBatchValuesCallback`)

Some inputs are presets: `<web-grid mode="excel">` also sets `editTrigger`,
`isEditable`, … An input row declares that with `getBatchValuesCallback(value,
config)`, which returns `{ configKey: value }` for the other inputs to set.
Core applies them in the **same batch** as the triggering input, so the whole
change is one `reinit()`/`update()` and `el.editTrigger` reads the new value
right after `el.mode = 'excel'` (config is staged synchronously).

```ts
{ configKey: 'mode', attribute: 'mode', converter: toEnum(MODES, { default: 'none' }),
  getBatchValuesCallback: (mode) =>
    mode === 'excel' ? { editTrigger: 'navigate', isEditable: true } : null }
```

Rules:

- **When it runs:** whenever the input is set — property, attribute, attribute
  removal (with the default) — including a re-set to the same value. Not at
  construction: defaults are seeded as-is, so keep them consistent.
- **Each value goes through its own input's converter** (`validate`, the property
  path) and reflects like a property write (before the first connect, at that
  connect's flush — reflecting mid-upgrade would swallow the initial attribute
  replay). An invalid value or unknown key warns
  and is skipped; the rest still apply, and the triggering input is set
  regardless. A throwing callback warns and sets nothing else.
- **Explicit wins within a batch.** An input set explicitly (property or
  attribute) in the same batch is never overridden by a returned value, whatever
  the order — `<web-grid mode="excel" edit-trigger="click">` keeps `click`, as do
  `el.editTrigger = 'click'; el.mode = 'excel'` in one tick. A *rejected*
  property write isn't explicit (it never happened), so the returned value
  applies. The batch ends at the flush (microtask, `flush()`, `batch()`,
  `setProperties()`, or connect while detached).
- **Across batches the last write wins:** a later `el.mode = 'excel'` overwrites
  an `editTrigger` set in an earlier batch.
- **One level only:** returned values don't run their own
  `getBatchValuesCallback` (no cascades, no cycles).
- **A rejected attribute isn't explicit either** (§6): `<web-grid mode="excel"
  edit-trigger="bogus">` warns and ends with the batch value `navigate`, in
  either attribute order.

### 6.3 Defer / release / ready — the first build, for every component

Complex setups (options, callbacks like `getCustomStylesCallback`, listeners)
should land in ONE first build instead of build-then-restyle. Core provides the
gate and the readiness signal for every `BlissElement`; no component re-implements
them.

- **`defer`** — a global attribute (always observed, like `dir`) with a reflecting
  boolean property `el.shouldDefer` (the `shouldX` → `x` attribute rule). When it is present at the first connect, the build
  is **held**: no `reinit()`/`update()`, no `connect()`, no environment/theme
  subscriptions. Inputs keep staging into `config` (a held element flushes nothing —
  like a detached one), so `whenSettled()` waits for the release — **intended**:
  resolving while held would report "settled" with nothing built, breaking the
  read-after-write contract (§12.7); release first, then await; `flush()`,
  `setProperties()` and `batch()` stage but don't build. A pre-upgrade
  `el.shouldDefer = true` is applied as the `defer` attribute at the first connect.
- **`release()`** — or removing `defer` — runs the first build now: one
  `reinit()` with everything set so far, then `connect()`, then `ready`. Detached →
  the build runs at the next connect. **Latched**: once released (or once the first
  build started) re-adding `defer` has no effect, and `release()` is a no-op.
- **`ready`** — after the first successful build is live (`reinit()` + `connect()`
  ran), **on the next microtask**, once per element lifetime: the host gets the `ready` attribute and the
  `:state(ready)` custom state (`ElementInternals.states` via the shared
  `internals`; skipped where unavailable), the `ready` event fires (bubbles, not
  composed; detail = component context only) with its `onReady` twin, `isReady`
  turns `true` and `whenReady()` resolves. A rebuild or a DOM move never
  re-announces. A throwing first build keeps `ready` pending until a later flush
  succeeds. **Asynchronous by design**: an element built during upgrade
  (`document.createElement` of a defined tag, `define()` over parsed markup, the
  component's import) would otherwise announce before the caller's next line could
  `addEventListener('ready', …)`. A microtask — not `requestAnimationFrame` ("after
  first paint", the old multiselect/daterangepicker timing) — because rAF never
  fires in a hidden tab (a background-tab `whenReady()` would hang) and isn't
  available in SSR/jsdom; `ready` means "the build is live", not "painted" (a
  consumer that needs paint awaits a frame itself). Until the microtask runs
  `isReady` is still `false` — everything flips together. A `destroy()` before it
  suppresses the announcement. Core declares `ready`/`onReady` itself; a subclass may list `ready` in
  its `static events` (for docs) without a duplicate.

Lifecycle: `defer` → `release()` → `reinit()` → `connect()` → `ready`. A subclass
that declares its own `defer` attribute input takes the attribute over (the core
gate is then off), the same dedup rule as `dir`; one with a `shouldDefer` configKey
owns the property.

### 6.4 Disabled state — the `isDisabled` input + `<fieldset disabled>`

**Every data-input component has the pair `isDisabled` + `isReadonly`** (attributes
`disabled` / `readonly`, both `toBool('presence')`, both reflect): a component through
which the user enters or changes data — a value or selection, files, text, cells, a
tree's checks / edits / moves — whether or not it is form-associated (rule set
2026-11-08). A component that only shows or launches things (a command palette) has
neither. On a store / satellite component (§11.4, decided 2026-11-10, Q26) only a
satellite that is itself a data-input surface (web-dropzone's picker) gets the pair; the
other satellites (summary, queue) have neither and follow the bound store's state. Both
follow native form-control semantics:
- **disabled** — no interaction at all, not focusable, styled as disabled, a
  form-associated value is not submitted;
- **readonly** — the data can't be changed, but the component stays focusable and
  navigable (keyboard, scroll, expand / collapse, copy), the value shows normally and
  a form-associated value IS submitted. For a text surface (an editor, a code view) the
  minimum is focusable + select (mouse and select-all) + copy; a caret that moves with the
  arrow keys is optional, not required (decided 2026-11-10 — keeping a surface editable
  and blocking every edit is fragile).
Calls from code (`setSelected()`, `expandAll()`, …) still work under both. Apply
disabled from `isEffectivelyDisabled` in `reinit()` and `disabledChanged()`; readonly
is a plain `update` input. A form-associated element (`static formAssociated = true`) can also
be disabled by an ancestor `<fieldset disabled>`, reported by the browser through
`formDisabledCallback` — which **core implements once** (components don't):

- **`isDisabled` must reflect** (`shouldReflect: true`). The browser treats a
  form-associated element's OWN `disabled` attribute as disabling it — it calls
  `formDisabledCallback(true)` for it too, matches `:disabled`, skips it on submit —
  so a non-reflecting input set to `false` by property would leave the attribute,
  and the element, disabled. The input-table sanity check warns (`INIT` /
  `CORE:ELEMENT`) when a form-associated class declares a non-reflecting
  `disabled` input.
- `isFormDisabled` (protected) — the **fieldset side only**, never written into
  `isDisabled`. The callback reports the combined state (own attribute OR
  fieldset); without the own attribute that IS the fieldset state, with it core
  reads the ancestors (a `<fieldset disabled>` outside its first `<legend>`), since
  no callback fires for a fieldset flip while the own attribute keeps it disabled.
- `isEffectivelyDisabled` (protected) — `config.isDisabled === true ||
  isFormDisabled`: the state the component must apply. Read it in `reinit()`.
- `disabledChanged(isDisabled)` (protected hook, no-op default) — fires when the
  effective state flips on a built element: after an `update` batch that changed
  `isDisabled`, or a fieldset change (pending writes flush first). Not for a
  rebuild (`reinit()` read it) nor before the first build; a change while detached
  is reported at the reconnect flush. Apply disabled-ness here and leave
  `isDisabled` out of `update()`.

The native `:disabled` pseudo-class already matches a form-associated host
disabled either way, so CSS needs nothing from core.

### 6.5 Destroy — `destroy()` / `destroyCallback()` / `isDestroyed`

Every component gets a public **`destroy()`** from the base (components no longer
write their own). In order it: marks the element destroyed (`isDestroyed` →
`true`; a second call is a no-op), cancels the pending microtask flush and the
post-disconnect `removedCallback` check (a destroy supersedes it), drops pending
input writes, resolves `whenSettled()` waiters, untracks the instance, stops the
environment / viewport / size / theme subscriptions and runs **`disconnect()`**
if the element is active, then calls the protected **`destroyCallback()`** hook —
the component's own cleanup (engine / store / picker, in-flight work), run once
even if `disconnect()` throws (a throw from either is rethrown).

A destroyed element is **inert**: input writes still validate and store into
`config`, but nothing reaches `reinit()`/`update()`; `flush()`, `whenSettled()`
and `release()` are no-ops; `dir` changes don't reach `directionChanged()`.
**Re-inserting it** logs a warning (`INIT` / `CORE:ELEMENT`) and stays inert — no
rebuild, no `connect()`, no `ready`. Create a new element instead. The `ready`
state is left as it was. `ElementInternals` can't be detached — a subclass that
set a form value or custom states clears them in `destroyCallback()`.

### 6.6 Form validity — `validity` / `checkValidity()` / `setFormatError()`

A form-associated element (`static formAssociated = true`) gets the standard
constraint-validation API from the base, read through `internals` — like `el.form`,
the browser gives a form-associated custom element none of it for free:

- `validity` (`ValidityState`), `validationMessage`, `willValidate`,
  `checkValidity()`, `reportValidity()` — straight from `ElementInternals`
  (`checkValidity()` fires the cancelable `invalid` event when invalid).
- On a class that is NOT form-associated (or where `attachInternals` is
  unavailable — SSR, older jsdom) they answer "no constraint": `validity`
  `undefined`, `validationMessage` `''`, `willValidate` `false`,
  `checkValidity()` / `reportValidity()` `true`. Internals are not attached for
  them (`ElementInternals`' validity members throw `NotSupportedError` there).

**`setFormatError(error, message?, anchor?)`** (protected) — the pattern for a
value the component could not produce (e.g. a throwing `getValueFormatCallback`):

- `error` non-null → `internals.setValidity({ customError: true }, message, anchor)`.
  The message is `message`, else the error's own message (an `Error`'s `message`
  or a string error), else `"The value is invalid."` — the platform rejects an
  empty message for an invalid state. `anchor` (a shadow-including descendant,
  e.g. the visible input) positions the browser's validation bubble; an anchor
  the browser rejects is dropped with a warning (`UI` / `CORE:ELEMENT`).
- `error` `null` → clears `customError` only — other flags stay.
- No-op on a non-form-associated class.

**`setValidityFlag(flag, message | null, anchor?)`** (protected) — one validity flag at a time
(`'valueMissing'` for the required rule, `'rangeUnderflow'` / `'rangeOverflow'` for a min / max count, `'tooLong'`, …): set with a message,
clear with `null`; the others are kept, so independent constraints never clear each other (a raw
`internals.setValidity({})` would). The shown message is the earliest flag still set. `setFormatError` is
its `customError` case. Components don't call `internals.setValidity` themselves.

While invalid, the form refuses to submit (`invalid` fires instead of `submit`)
unless `<form novalidate>`, and `:invalid` matches the host. Typical component
flow: catch the callback's throw → log it at `error` → submit `''` →
`setFormatError(err, label)` → emit a `*-error` event; the next successful
format calls `setFormatError(null)`.

**Required (decided 2026-11-22).** Every form-associated data-input component has `isRequired` (attribute
`required`, `toBool('presence')`, reflects — like native). Core owns the rest, keyed on the `isRequired` row (like
`isDisabled`): the component implements `isValueEmpty()` (nothing selected / no complete range / an empty document),
optionally `getRequiredMessage()` (its `errors.required` label) and `getValidityAnchor()` (the visible input), and calls
`refreshRequired()` from its value-change path; core also runs it after every flush. `valueMissing` is set while
required AND empty AND not readonly AND not effectively disabled (native: a readonly / disabled control is never
"missing"); `internals.ariaRequired` and `:state(required)` follow `isRequired` (the native `:required` doesn't match a
custom element), and so does `aria-required` on the validity anchor — focus sits on that inner input, where the host's
value is never announced (only a native field or a role that allows it: combobox, textbox, listbox, …; never a button). A class without an `isRequired` row is untouched. Count rules are separate flags: a minimum not met →
`rangeUnderflow`, above a maximum → `rangeOverflow` (web-multiselect `min/maxSelectedCount`, web-dropzone
`min/maxFileCount`), so `validity` tells "empty" from "too few", as an app's custom message needs.

**Form reset / restore.** Components implement the platform `formResetCallback()` themselves
(core has nothing generic to reset — "the value" is a different input per component):
multiselect resets to the markup's `selected` options, daterangepicker to its `value`
attribute, dropzone clears its files. `formStateRestoreCallback` is intentionally absent:
components submit through light-DOM hidden inputs (no `setFormValue` state to restore).

### 6.7 Responsive rules — partial configs per device class / breakpoint / container (page / tag / instance)

Components decide behaviour from the environment, but apps want to tune those
decisions page-wide and per instance (e.g. "on a tablet, every multiselect opens
as a modal"). Core provides ONE generic mechanism for every `BlissElement` with an
input table — core-declared like `defer`, not a per-component table row. Components
never detect the page shell; the shared link is the base-css-variables tokens
(`--base-breakpoint-*`, §12.9).

```js
window.components.responsive          = { device: { mobile: { … } }, breakpoint: { mobile: { … } } };  // page-wide map
window.components.responsiveCallback  = (ctx) => ({ … });                  // page-wide computed rule
window.components['web-multiselect'].responsive         = { … };           // per tag
window.components['web-multiselect'].responsiveCallback = (ctx) => ({ … });
el.responsive = { device: { tablet: { presentation: 'modal' } } };   // also <x responsive='{"breakpoint":{"mobile":{…}}}'>
el.responsiveCallback = (ctx) => ({ … });
```

Types (main entry): `ResponsiveMap<C>`, `ResponsiveMapAxis` (`'device' | 'breakpoint' | 'container'`),
`ResponsiveContext<C>` (`{ env, deviceClass, breakpoint, container, width, element, component, config }` —
`config` is the frozen **base** config), `ResponsiveCallback<C>`
(`(ctx) => Partial<C> | null | undefined`).

**A map has three explicit axes:**

```ts
type ResponsiveMap<C> = {
  device?:     Partial<Record<DeviceClass, Partial<C> | null>>;  // classifyDevice: capability first, then short side
  breakpoint?: Partial<Record<string, Partial<C> | null>>;       // env.breakpoint: window-width buckets (768 / 1024 lines)
  container?:  Partial<Record<ContainerSize, Partial<C> | null>>; // the component's OWN width: narrow | medium | wide
};
```

- `device` is keyed by `classifyDevice(env)` (capability + short side, §12.9): a
  mouse / trackpad device is `desktop` at **any** width; only a touch-primary device
  is `mobile` (short side < 600) or `tablet`.
- `breakpoint` is keyed by the width bucket (`env.breakpoint`, the
  `--base-breakpoint-*` lines / `configureBreakpoints()`): a narrowed desktop window
  is `mobile` below 768 px.
- `container` (decided 2026-11-16) is keyed by the component's own border-box width: `narrow` <
  `--base-container-narrow` (480px) ≤ `medium` < `--base-container-medium` (768px) ≤ `wide`. The lines are
  CSS custom properties read AT the element (`readCssLengthPx`), so they inherit — `:root` for the page, a
  section, one element; no JS configuration. The element watches its own size (`observeElementSize`, shared
  observer) only while a rule uses the axis or a callback layer applies; a map re-runs when the bucket
  changes, a callback on every (throttled) width change (`ctx.width`). Structural changes only — restyling
  stays in CSS `@container`. Replaces per-component width thresholds (web-daterangepicker `compact-below`).
- Within one map the **breakpoint entry applies first, then container, then the device entry** —
  a later axis wins on the same key. Then that level's callback over the map (the
  precedence order below is unchanged).
- Any other top-level key (e.g. the pre-rc15 device-keyed `{ mobile: … }`) warns
  once per element (`INIT` logger) and is ignored; a non-object axis likewise.

```js
window.components['web-treeview'].responsive = {
  device:     { mobile: { shouldAlignNodeIcons: false }, tablet: { shouldAlignNodeIcons: true } },
  breakpoint: { mobile: { shouldAlignNodeIcons: false } },
};
// own widths / combinations → callback
window.components['web-treeview'].responsiveCallback = ({ deviceClass, env }) =>
  deviceClass === 'desktop' && env.viewportWidth < 600 ? { shouldAlignNodeIcons: false } : undefined;
```

| Situation | deviceClass | breakpoint | Result |
|---|---|---|---|
| Phone (390 × 844, touch) | `mobile` | `mobile` | `device.mobile` → `false` |
| Desktop window narrowed to 700 px | `desktop` | `mobile` | no `device.desktop` → `breakpoint.mobile` → `false` |
| iPad portrait (768 × 1024, touch) | `tablet` | `mobile` | `breakpoint.mobile` says `false`, `device.tablet` beats it → `true` |
| Desktop narrowed to 550 px | `desktop` | `mobile` | map → `false`; the callback also says `false` |

Rules on your own widths or combinations (`ctx.env.viewportWidth`, orientation,
device class AND width, …) belong in a **callback**.

**Precedence** (later wins, key by key):
global map → global callback → per-tag map → per-tag callback → **instance
attributes / properties** → instance map → instance callback. Page rules lose to
anything set explicitly on the element; the element's own rules beat everything.
An attribute written on one element is never overridden by a page rule.

- `undefined` from a callback = nothing to add. `null` from an **instance** rule
  (callback result, or the instance map's current entry on either axis) = ignore every
  page rule (the instance's own values still apply). A page-level `null` = `undefined`.
- **Base vs effective.** `this.config` and the generated getters report the
  EFFECTIVE config (what the component applies); `ctx.config` is the base (defaults
  + attributes + properties + batch values). Responsive overrides **never reflect**
  to attributes and never count as explicit. Assigning a property while a rule
  overrides it updates the base — it becomes instance-explicit (beats page rules,
  loses to instance rules). A key a rule stops returning goes back to its base value.
- **Explicit tracking** is persistent per instance: attribute present or property
  assigned (incl. `setProperties()`); removing the attribute clears it (and resets
  the input to its default, §6), handing the key back to the page rules. Batch
  values (§6.2) are base but not explicit.
- **Validation.** Every value goes through that input's converter (`validate`):
  invalid → warn + skip that key. Unknown keys warn + skip in per-tag and instance
  rules; in the page-wide (global) rules they are skipped silently (a page rule names
  inputs only some components have). `responsive` / `responsiveCallback` /
  `shouldDefer` are reserved (warn + skip). Warnings go through the element's `INIT`
  logger, once per message per element. A throwing callback is logged (`error`) and
  treated as `undefined`.
- **Re-run** on a discrete environment change (the `environmentChanged` channel:
  breakpoint / orientation / pointer / device class), on every continuous viewport-size
  change (the `observeViewport` channel, throttled ≈30 ms) **while any callback layer
  (global / per-tag / instance) applies** to the element — so `env.viewportWidth <= 600`
  re-evaluates between breakpoint lines; maps stay on the discrete channel only (device
  class and breakpoint are both discrete — a breakpoint-only map flips when a desktop
  window is resized across a line), on any layer changing (page
  setters notify every connected element across bundled core copies; instance
  setters re-run that element) and at every flush (callbacks see base changes). The
  result is diffed (structural equality for plain objects / arrays); only changed keys
  are staged — ONE batch through the normal pipeline (`update(partial)` /
  `reinit()` per `on`; the partial carries effective values). Unchanged → nothing.
- **First build** gets the rules: they are evaluated inside the first flush, before
  `reinit()` (no flash of the desktop layout); a `defer`-held element gets them at
  `release()`.
- **Cost.** The environment is observed only while connected AND some layer is set;
  the continuous viewport channel only while a callback layer is set (subscribed /
  unsubscribed as callback layers come and go, and on disconnect).
  Elements without an input table (web-grid's config-object API) skip the feature.
- **Page entries.** `window.components.responsive` / `.responsiveCallback` are
  non-enumerable accessors (like `logging` / `renderLoadingCallback`; tag enumeration
  unaffected), their state shared across core copies via `Symbol.for`. Values the
  page assigned as plain properties before any component loaded are adopted.
  `registerComponent()` ADOPTS a pre-existing `window.components[tag]` object (keeps
  the object, adds the registry members) and its `responsive` / `responsiveCallback`,
  which become accessors that re-evaluate that tag's instances.
- **Attribute.** `responsive` is always observed (JSON object; invalid JSON warns
  and keeps the previous map; removing it clears the map). `responsiveCallback` is
  property-only. A pre-upgrade assignment of either is kept. A subclass declaring its
  own `responsive` attribute / configKey takes it over (same dedup as `dir` / `defer`).
- SSR-safe: without `window` the page layers are empty unless set on the shared state.

**Not defaults.** Responsive rules ≠ defaults: per-user preferences (e.g. from a DB)
are a separate, later feature (`window.components.defaults`, with `/locale`) that
will feed the BASE config (instance > per-tag defaults > global defaults > built-in);
the rules above layer on top of whatever the base resolves to.

Components export typed aliases over their config type, e.g.
`type MultiselectResponsiveMap = ResponsiveMap<MultiselectConfig>`.

---

## 7. Fit check — all five components

- **multiselect** — `{parser:'enum', enumValues}` → `toEnum(...)`;
  `bool-default-true` → `toBool('default-true')`; `setProperties` batching
  → `BlissElement`.
- **daterangepicker** — `parseEnum(CONST)` → `toEnum(CONST)`;
  `parsePipeDelimitedList(12)` → `toList({itemType:'string', separator:'|', requiredCount:12})`;
  `parseWeekStartDay` → `toCustom(parseWeekStartDay)`; tri-state →
  `toBool('tristate')`.
- **treeview** — `{kind}` union → converters; its `field` column is why
  `InputDef.field?` exists; near-mechanical.
- **dropzone** — `'bytes'` tag → `toBytes()`. Store element extends
  `BlissElement`; satellites keep the dropzone topology but swap their SSR
  stub for `BlissElement` and use core's `dispatch` /
  `toEnum` / scheduler.
- **web-grid** — **no table.** Extends `BlissElement` for the SSR base +
  `dispatch()` only; keeps its property/config-object API. Proves the
  table is opt-in; grid gains an SSR stub it currently lacks.

---

## 8. Docs / IntelliSense (secondary)

Enum values and descriptions are authored as **JSDoc on the config
member**, in the C-CEM-13 canonical format (intro line → blank line →
bullet-per-value). Independent of the parser structure. *Optionally* a
converter like `toEnum(VALUES)` may expose `.values` for future
autodetect — but nothing depends on it.

**Amendment (source-of-truth split, §12.4 CEM tooling).** With the CEM
plugin built, this splits cleanly: the input/event **table owns the
STRUCTURE** (attribute↔property mapping, type, default, `shouldReflect`, enum
members — all derivable from the row + its converter), and **prose stays
authored by a human** — now as an optional `description` / `deprecated`
field *on the row itself* (`InputDef.description`, `EventDef.description`),
or a leading comment on the row. So JSDoc-style structural re-declaration
(`@attr {single|multiple} selection-mode`) is gone — it can't drift from
the converter — and authors write only the "extra help text." This
*tightens* the original rule (JSDoc-only) rather than contradicting it:
descriptions are still hand-authored, they just live in the one table.

---

## 9. Migration plan (per repo, low-risk, ordered)

1. **Build core v1** + unit tests for every converter (incl. the
   daterangepicker `toCustom` cases) and the reactive pipeline.
2. **treeview first** — closest existing shape; validates the API.
3. **multiselect + dropzone** — string-tag → converter translation; fold
   batching into `BlissElement`; `'bytes'` → `toBytes`.
4. **daterangepicker** — function parsers → converters; the 3–4 bespoke
   ones become `toCustom`.
5. **web-grid** — adopt `BlissElement` for base + `dispatch` only.

One PR per repo, behind each component's existing tests; no
consumer-facing attribute/event changes.

---

## 10. BlissFramework guideline changes this implies (later)

- **CLAUDE.md** — new invariant: web-components build on
  `@keenmate/web-components-core`; don't re-implement observed-attribute /
  parse / dispatch plumbing.
- **component-structure.md** — Element layer extends `BlissElement`;
  document the opt-in input table.
- **naming-conventions.md / C-NC-7** — the single `ATTRIBUTE_TABLE`
  becomes a single table of core `InputDef` rows with `to*` converters.
- **custom-elements-manifest.md** — cross-ref: values authored in JSDoc
  (C-CEM-13); autodetect from converters optional.

---

## 11. Decisions (formerly open questions)

1. **String converter → `toText`.** RESOLVED: `toText` (not `toStr`), avoiding
   the `Object.prototype.toString` collision.
2. **Config-key field → `configKey`.** RESOLVED: kept the explicit `configKey`
   (not shortened to `key`).
3. **Reactivity dispatch → `reinit()` / `update(partial)`.** RESOLVED: the base
   splits the single hook into two. `reinit` means rebuild the whole component;
   `update` means patch a part in place. A batch that touches any `on:'reinit'`
   input calls `reinit()` only — since the rebuild reads full `this.config`, the
   `update` partial would be redundant, so it is suppressed. First connect always
   calls `reinit()`. Both hooks are no-op by default, so the table stays opt-in
   (web-grid overrides neither). See §6.

   Also settled here: `toBool` accepts a permissive true/false vocabulary
   (`true/1/yes/on` · `false/0/no/off`, case-insensitive); an unrecognized
   explicit value falls back to the mode default, exactly like an absent
   attribute — consistent with every other converter.
4. **Store/satellite pattern** — DEFERRED: stays dropzone-local until a second
   component needs it (recommended). The topology stays local; these rules for it are
   decided (2026-11-10):
   - **Disabled / readonly (Q26):** only a satellite that is itself a data-input surface
     (dropzone's picker) gets the `isDisabled` + `isReadonly` pair (§6.4); the other
     satellites have neither and follow the bound store's state.
   - **Events (Q25):** a satellite declares its events in its own `static events` and sends
     them through `emit()` (§12.5), so the `on<Name>` twin and the CEM entry come free; the
     event's `controller` is the bound store's.
   - **Custom CSS (Q24):** a managed satellite takes its owner's custom-style layers through
     `createCustomStyles({ getOwner })` (§12.8).
5. **Derived / fallback defaults → stay in `reinit()`.** RESOLVED (by design):
   `InputDef.default` is a static literal on purpose. A value whose "when absent"
   is *computed from other inputs* (e.g. `searchValueMember` falling back to
   `displayValueMember`) is NOT a declarable input concern — it is derived in
   `reinit()`/`update()` from the already-merged `this.config`. Rationale: the
   real cases are either **use-site / per-item** (the multiselect's search
   fallback is `() => getItemDisplayValue(item)` — depends on the option object,
   so it can never be an input default) or **config→config**, which would require
   a computed-property dependency graph (which keys does it read? when does it
   recompute? track "was it explicitly set"?) that contradicts core's flat,
   independently-resolved input model. Surfaced as gap #3 by the multiselect
   pseudo-migration; closed without new machinery.

---

## 12. Common functionality roadmap (to discuss — beyond v1)

Candidates already duplicated across components, in rough priority order.
Each becomes its own core module once we agree the shape.

**Entry points (naming review 2026-11-23 §1).** Every symbol has exactly ONE entry point. The main index
(`src/index.ts`) is in 13 commented sections — 1 inputs & converters, 2 element / events / registration,
3 logging, 4 environment, 5 theme / motion / CSS timing, 6 styles & rendering, 7 overlays (non-floating),
8 shadow-DOM tree & screen reader, 9 keyboard & text / clipboard, 10 forms / async / persistence,
11 scrolling / virtual lists / selection, 12 pointer & page drag, 13 scheduling & ids — each value followed by
its types. Subpaths: `/positioning` (the only `@floating-ui/dom` importer — nothing that imports `anchor` /
`createPopover` / `createTooltip` may be exported from the main index), `/menu`, `/dialog`, `/actions`,
`/search`, `/locale`, `/a11y`, `/testing`, `/cem`. No subpath imports the main index (leaf modules only).
Plumbing that `BlissElement` / `registerComponent()` call internally (event-def normalisation, the
`window.components.*` hook installers, the log-level parser, the scroll-lock state type) is not exported.

### 12.1 Logger — IMPLEMENTED (`src/logging/`)

**Status:** built. Amended from the original decision: core depends on
**`loglevel` only** — `loglevel-plugin-prefix` was dropped. Its browser `%c`
handling is precisely the "ordering bug" noted below, so core does the colored
`NAMESPACE:CATEGORY` prefix directly in a `loglevel` `methodFactory`
(ordering-safe by construction: `%c[label]`, the CSS string, then the raw
message args — messages stay uncoloured and structured-loggable). `createLoggers`
is idempotent per logger name (won't double-wrap), assigns each category a stable
palette colour by index, and `enableLogging()` defaults to `debug`. *(Amended
again in rc04: the `loglevel` npm dependency was replaced by a vendored native-ESM
port, `src/logging/log-core.ts` — the CJS package broke `log.levels` under Node's
ESM loader in consumers' vitest runs. Core has no logging dependency.)* **No timestamp
prefix, on purpose:** every pre-core component logger printed `[HH:MM:SS.mmm]`; core doesn't —
the browser console shows a time per message (Chrome / Edge "Show timestamps", Firefox likewise),
and a prefix would only duplicate it. Components don't add one either (sweep A6, 2026-11-08). Original
context and decision retained below.

Context: all five components already use **loglevel +
loglevel-plugin-prefix** with the same shape — categorized named loggers
(`NAMESPACE:CATEGORY`), a color-coded `%c` prefix, and an
`enableLogging` / `disableLogging` / `setLogLevel` / `setCategoryLevel`
API over a `LOGGING_CATEGORIES` list. The differences (three repos
**vendor** loglevel under `src/vendor/`, daterangepicker uses the npm
packages; slightly different category names; multiselect carries a
method-factory that fixes a `%c` ordering bug) are historical accretion,
not design choices.

**Decision:** logging moves into core.

- Core takes **`loglevel` as its own npm dependency** (bundled into each
  component's dist; **no more vendoring**). *(Amended: `loglevel-plugin-prefix`
  dropped — see status note above.)*
- Core owns the color `%c` prefix, with multiselect's ordering fix baked
  in so every component gets it.
- **Default categories, overridable.** Core ships a baseline set; a
  component uses it as-is, redefines it, or extends it.

```ts
export const DEFAULT_LOG_CATEGORIES = ['INIT', 'DATA', 'UI'] as const;

export function createLoggers<C extends string>(
  namespace: string,
  categories: readonly C[] = DEFAULT_LOG_CATEGORIES,
): {
  loggers: Record<C, Logger>;
  enableLogging(level?: LogLevel): void;   // the type's own level (default debug)
  disableLogging(): void;                  // own level = silent
  setLogLevel(level: LogLevel): void;
  resetLogging(): void;                    // clear: follow the page level
  setCategoryLevel(category: C | `${string}:${C}`, level: LogLevel | null): void; // 'DATA' or 'GRID:DATA'; null clears
  LOGGING_CATEGORIES: readonly C[];
};
```

Usage — defaults, redefine, or extend:
```ts
const { loggers } = createLoggers('MULTISELECT');                                   // defaults: INIT/DATA/UI
const { loggers } = createLoggers('TREEVIEW', ['INIT','DATA','INDEX','UI','DRAG']); // redefine
const { loggers } = createLoggers('DROPZONE', [...DEFAULT_LOG_CATEGORIES, 'FILE']);     // extend
export const { INIT: initLogger, DATA: dataLogger, UI: uiLogger } = loggers;
```

Optional companion module: `createPerfLogger(namespace)` (treeview's
`perfStart` / `perfEnd` / `perfMeasure` / `perfSummary`), opt-in per
component. Spans for `summary()` are capped (`maxSpans`, default 1000, oldest dropped and counted) so a long-running page with perf logging on stays bounded.

**Default level, core's own messages, page-wide switch** *(added after rc14)*:

- **Levels coalesce, closest first** *(rc19, was "last call wins")*: an element's own level
  (`el.enableLogging()`) → its component type's own level per category
  (`window.components[tag].logging` / the bundle controls) → the page level
  (`window.components.logging`) → `warn` (`DEFAULT_LOG_LEVEL`). Nothing is set by default, so
  errors and warnings are visible out of the box. A level means "that level and above". At
  every layer `enableLogging(level = 'debug')` / `setLogLevel(level)` set it,
  `disableLogging()` sets it to `silent`, and `resetLogging()` clears it (the next layer out
  applies); `setCategoryLevel(cat, null)` clears one category. Layers are stored separately, so
  the order of calls never matters: a page call never overwrites a type's own level. A level
  persisted in `localStorage` (`km-log:NS:CAT`, only written by an explicit
  `logger.setLevel(x)` — the bundle controls never persist) is that category's own level;
  `resetLogging()` removes it. A second `createLoggers()` for the same namespace keeps the
  current levels. Engine: the type level is the loglevel logger's own level, the page level
  its default level (`setDefaultLevel()` in the vendored port never writes the own level).
- **No direct `console.*` in core.** A core message with an element behind it is
  logged through that element's instance logger (§12.3), so it carries the
  component's namespace + instance: input validation under `INIT`, actions / menus /
  `on<Name>` twins / `before*Callback`s under `UI`, falling back to the bundle's
  first category when the component redefined its categories without that name.
  A tag with no registered bundle (e.g. web-grid, which keeps its own logger) falls
  back to core's own bundle `createLoggers('CORE', ['ELEMENT','ACTIONS','MENU','THEME'])`
  with the tag kept in the label (`[CORE:ELEMENT] web-grid#main`). A message with no
  element (`setThemeMode('sepia')`) uses the CORE bundle with no instance part.
  Element resolution (`src/logging/element-logger.ts`): a custom element, a plain
  element inside one's shadow root, a shadow root's host, or a ctx's `element`
  (the component context). `resolveActionItem` / `resolveMenuEntries` /
  `loadMenuChildren` / `runBeforeCallback*` take an optional trailing `logSource`
  (default: the ctx); `openMenu` passes its `host`, `runAction` its detail.
- **Page-wide switch — `window.components.logging`** (non-enumerable; tag names
  always contain a hyphen, so no clash, and enumerating `window.components` /
  `getConnectedTags()` still yields components only): `enableLogging(level?)`,
  `disableLogging()`, `setLogLevel(level)`, `resetLogging()`, `getCategories()` — the
  per-component method names. Sets the page level of every bundle created so far AND later
  (a late `createLoggers()` adopts it). Components bundle their own core copy, so the state
  (bundle list, page level, the controls object) lives on
  `globalThis[Symbol.for('@keenmate/web-components-core:logging')]` and is shared by every
  copy. A copy that finds controls from core rc17 or older (no `resetLogging`) takes them over
  and republishes; a bundle from such a copy (no `setPageLevel`) still gets the page level
  pushed as its own level, the old way.
  `getPageLogging()` is the code-side handle. SSR-safe: no `window` → nothing
  published.

### 12.2 Positioning — IMPLEMENTED (`src/positioning/`)

**Status:** built as the `@keenmate/web-components-core/positioning` subpath over
a single pinned `@floating-ui/dom` (`^1.8`) — the one added runtime dependency,
kept out of the base import graph so components that don't position pay nothing.
Ships the proposed shape below: `anchor()` + `createTooltip()` +
`createPopover()`. Resolutions of the survey's open points:

- **follow-cursor** → a `shouldFollowCursor?: boolean` option on `createTooltip` (it
  anchors to a `VirtualElement` tracking the pointer), NOT a third preset.
- **Custom shadow-DOM platform** → NOT ported. floating-ui 1.8's built-in shadow
  handling covers it; `anchor` exposes an optional `platform` escape hatch for
  any residual edge case rather than baking in multiselect's bespoke (and
  unverifiable-here) platform.
- **`data-theme` inheritance (C-CS-10)** → `anchor` copies the nearest
  `data-theme` (via `closest('[data-theme]')`) from `inheritThemeFrom` onto the
  floating element; the presets default `inheritThemeFrom` to the trigger /
  reference, so portaled layers keep the theme automatically. Since rc20 it also carries what core
  itself mirrors onto a component host — the EFFECTIVE scheme `data-context-theme` (a Tailwind
  `.dark` class, `setThemeMode()`, `theme-source`; §12.10) and the motion level `data-motion`
  (§12.16) — so a panel moved to `<body>` styles like the component (`[data-context-theme="dark"]`)
  and animates by its level; all four restored on `destroy()` (sweep A5).
- **Width-matching** → one `matchWidth: 'min' | 'exact' | 'max' | false` (via
  `size()`), replacing the three per-component hacks. `'min'` floors the panel to
  the reference width (grows for wider content), `'exact'` pins it, `'max'` caps
  it (shrinks for narrower content).
- **`lockPlacement`** (`PlacementLock`: `'initial' | 'freeze' | false`) → `'initial'` feeds
  `flip({ fallbackStrategy: 'initialPlacement' })`, so the initial placement is preferred over
  reordering; `'freeze'` flips once on the first computation, then pins the resolved placement.
  A three-way mode, not a flag (C-NC-3), like `matchWidth`.

Tests mock `@floating-ui/dom` (jsdom has no layout / `ResizeObserver`) and cover
the wrapper contract: middleware order/selection, `matchWidth`→`size`,
`lockPlacement`→flip fallback, theme inheritance, tooltip show/hide + delay +
follow-cursor + listener teardown, popover open/close idempotency. The original
survey follows.

---

### 12.2 (survey) Positioning — `@floating-ui/dom`

Context: **all five** depend on `@floating-ui/dom`, on **three drifted
versions** (`1.5.3` / `1.7.4` / `1.7.6`), and re-wrap it in ~15 call
sites. Two shapes recur:

- **Tooltip** (`tooltip.ts` in multiselect / daterangepicker / grid):
  `strategy: 'fixed'`, middleware `[offset(d), flip(), shift({padding:8})]`,
  hover-in/out with a delay, mounted to the shadow root **or**
  `document.body`, `autoUpdate` while visible. multiselect already has a
  clean `TooltipOptions` interface to lift.
- **Dropdown / popover / panel** (multiselect dropdown, daterangepicker
  calendar, grid contextmenu/datepicker/dropdown/toolbar, dropzone
  popover): default `placement: 'bottom-start'`, middleware
  `[offset(n), flip() (often conditional on a placement lock),
  shift({padding:8})]`, optional `size()` for **width-matching**
  (three different hacks today: a `--ms-input-current-width` CSS var,
  `size()`, and raw `minWidth`/`maxWidth`), `autoUpdate` while open,
  usually portaled to `document.body`.

Notable divergences to unify:
- `strategy` is `'fixed'` in ms/drp/dz but `'absolute'` in grid. Core
  default `'fixed'` (portal-friendly, avoids ancestor clipping); caller
  can override.
- multiselect passes a **custom `platform`** to correct offsets inside
  shadow DOM — that fix belongs in core so everyone gets it.
- Portaling to `document.body` is where guideline **C-TC-8**
  (fixed-floating-UI exception) and **C-CS-10** (portaled layer must
  receive `data-theme` for dark mode) live — core should carry
  `data-theme` onto the floating element at open time, solving C-CS-10
  once instead of per component.

Proposed core shape — one low-level anchor + two presets, each returning
a teardown that stops `autoUpdate`:

```ts
// low-level: place `floating` against `reference`, keep it placed
anchor(floating: HTMLElement, reference: HTMLElement | VirtualElement, opts: {
  placement?: Placement;              // default 'bottom-start'
  strategy?: 'fixed' | 'absolute';    // default 'fixed'
  offset?: number;                    // default: --base-dropdown-offset on the reference (4 when unset)
  shouldFlip?: boolean;               // default true (skipped when lockPlacement holds)
  shift?: number | false;             // padding; default 8
  matchWidth?: 'min' | 'exact' | 'max' | false;   // via size(); default false
  lockPlacement?: 'initial' | 'freeze' | false;  // PlacementLock; default false
  shouldAutoUpdate?: boolean;         // default true
  inheritThemeFrom?: HTMLElement;     // copy data-theme / data-bs-theme / data-context-theme / data-motion onto `floating`
  placedCallback?(placement: Placement): void;
}): { update(): void; destroy(): void };

createTooltip(opts: { trigger; selector?; container; content; placement?; offset?; delay?; cssClass?; visibleClass?;
                      arrow?; shouldToggleOnTap?; beforeShowCallback?(target): boolean | void }): TooltipHandle;
// content: string | HTMLElement | (target) => string | HTMLElement | null — resolved at every show; empty = no tooltip.
// selector (delegated mode): `trigger` is the ROOT (an element or a shadow root); ONE tooltip serves every
// `closest(selector)` target inside it — hover (show delay once, then it switches at once), keyboard focus,
// Escape; handle.target / show(target) / refresh(). shouldToggleOnTap: a tap toggles, emulated hover ignored.
// Escape (window capture — before the overlay router and component handlers): a tooltip shown by KEYBOARD FOCUS
// (handle.isFocusShown) takes the first press on its own — hides + preventDefault(), so an open routed panel
// stays open and focus stays (WCAG 1.4.13); the next Escape closes the panel. Shown by hover / tap / show():
// hides and lets the press through (it closes whatever else Escape closes). Components skip a defaultPrevented
// Escape rather than checking `isVisible`.
// Exit fade: hide() removes visibleClass and adds `km-tooltip--hiding` (inline pointer-events: none); the element
// stays mounted and anchored until its own `opacity` transitionend, or a timeout of its computed transition
// (duration + delay) — a hidden tab / display:none ancestor never sticks; 0s (data-motion="none", OS reduced
// motion) = removed at once; a show during the fade cancels it (same element, same anchor; a delegated target
// switch re-anchors without the show delay). destroy() / a removed target = at once. TOOLTIP_CSS (adopted into
// the container's root, `@layer component` + `:where()` so component rules win): fade + a 4px slide toward the
// anchor, entry via @starting-style, timed only by --base-duration-fast. Every tooltip has class `km-tooltip`.
// data-placement on the tooltip = the RESOLVED placement after flip / shift (the requested one until the first
// computation), updated on every reposition — component CSS draws arrows / direction-aware motion from it.
createPopover(opts: { reference: Reference | (() => Reference); panel; shouldKeepMounted?; isAnchored?;
  container?: HTMLElement | ShadowRoot; inheritThemeFrom?: HTMLElement | false;
  visibleClass?; shouldCloseOnEscape?; shouldCloseOnOutsideClick?; getInsideElements?; returnFocusTo?;
  shouldCloseOnScroll?; shouldCloseOnResize?; overlayGroup?; closeCallback?(reason: PopoverCloseReason);
  ...AnchorOptions }): PopoverHandle;   // shouldCloseOn*: boolean | (() => boolean), asked each time
// PopoverHandle: { isOpen, isAnchored, open(), close(), update(), reanchor(), setAnchored(bool), destroy() }
// open (state + overlay tree + visibleClass), mounted (shouldKeepMounted) and anchored (setAnchored) are separate.
// closeCallback fires for every close; reason adds 'scroll' | 'resize' | 'reference-removed' | 'api' to OverlayDismissReason.
// Scroll close (shared watchScrollClose, also /menu): the first two frames after open only re-baseline
// (WebKit scrolls a focused input into view AFTER the focus that opened the layer) — rc21.
// 'reference-removed' (rc20): the reference was in the page when anchored and left it while open
// (a virtualised row re-rendered) — the panel goes with it, like createTooltip(); seen at the next
// position update (autoUpdate's observers fire on the removal).
// anchor() also takes fallbackPlacements; its destroy() puts back the inline sizes it wrote.
// Fit study (who uses it, what the big panels still need): docs/review/2026-11-06-createpopover-fit.md
```

Pin one `@floating-ui/dom` version in core (ends the 1.5/1.7 drift).
Open: is the tooltip preset rich enough to also cover
`follow-cursor` (multiselect `option-tooltip-follow-cursor`) via a
`VirtualElement`, or is that a third preset?

### 12.3 Global registration (`window.components`) — IMPLEMENTED (`src/global/`)

**Status:** built. Every shipping component copy-pasted a
`window.components[tag] = { version, config, logging, register, getInstances }`
block, and it drifted five ways: instance tracking was a `Set` in three, a
`querySelectorAll` in daterangepicker, and absent in grid; grid also dropped
`register()`/`getInstances()`; treeview dropped `logging`; daterangepicker
auto-registered while the rest did not. Core consolidates it:

- **`registerComponent(tag, elementClass, { config, logging?, shouldAutoDefine? })`**
  — publishes the entry to `window.components[tag]`, defines the element via the
  idempotent `define()` (auto by default; `shouldAutoDefine: false` defers to the
  exposed `register()`), and flattens a `createLoggers()` `LoggerBundle` into the
  `logging` controls (`enableLogging`/`disableLogging`/`setLogLevel`/
  `setCategoryLevel`/`getCategories`). Returns the entry (generic on the element
  type). SSR-safe: the global write is skipped without `window`, `define()`
  no-ops without `customElements`.
- **Global logging switch** — `window.components.logging` (non-enumerable) drives
  every bundle on the page incl. `CORE` and later registrations; see §12.1.
- **Page-wide loader hook** — `window.components.renderLoadingCallback`
  (non-enumerable accessor) draws every component's loading states unless an
  instance `renderLoadingCallback` is set; see §12.14.
- **Live-instance registry** — `BlissElement` adds itself to a per-tag `Set` on
  connect and removes itself on disconnect (a DOM move re-tracks the same
  element, no duplicate). `getInstances(tag)` returns the live elements; the
  registry entry's `getInstances()` is wired to it. No per-component tracker.
  The elements ARE the per-instance handles: a devtools overlay
  (Ctrl-Alt-C → list a tag's instances → act on one) enumerates tags via
  `window.components` + `getConnectedTags()` and each tag's instances via
  `getInstances()`.
- **Per-instance logging** — `BlissElement` exposes `this.log` (an instance
  logger per category of the tag's `createLoggers` bundle, wired by
  `registerComponent`'s `logging` option). Each line reads
  `[NAMESPACE:CATEGORY] #id` (the element's own `id` when set, read per line, else
  a running number — the tag is not repeated; a tag with no bundle falls back to
  `CORE:ELEMENT` labelled `tag#id`, §12.1) and is gated by the element's own level when
  set, else the category's effective level (type → page → `warn`), emitting via `console`
  directly so one element can log more — or less — than its type.
  `element.enableLogging(level?)` (an invalid level warns, nothing changes) /
  `disableLogging()` (silent) / `resetLogging()` (clear) / `isLoggingEnabled` (has its own,
  non-silent level) are the overlay's per-instance switch: pick one instance from
  `getInstances()`, flip it loud, leave the rest quiet.
  Components should prefer `this.log.<CATEGORY>` over the shared type-level
  loggers so this scoping works. `bundle.forInstance(id, getOverride)` is the
  underlying factory; a tag→bundle map (`logger-registry.ts`) lets the element
  base find its bundle by `localName`.

### 12.4 Other candidates (later modules)
- **Callbacks & events model** — IMPLEMENTED, see §12.5 (`static events` +
  `emit()` + managed `on<Name>` properties, and `runCallback()` for `*Callback`s).
- **Theming / CSS cascade-layer helpers** — the RUNTIME step (adopt a
  stylesheet into a shadow root) is IMPLEMENTED, see §12.8 (`adoptStyles`
  + `createStyleElement`). The authoring conventions (`@layer` order, `?inline`
  import) stay pure CSS-guideline, no code.
- **CEM tooling preset** — IMPLEMENTED, see §12.6 (`/cem`: analyzer config
  preset + a plugin that reads the `static inputs` / `static events` tables).
- **Testing utilities** — IMPLEMENTED, see §12.7 (`/testing`: runner-agnostic
  mount/upgrade/event fixtures) + `whenSettled()` on `BlissElement`. The
  Playwright/a11y-contrast layer is deferred (out of the input-model core).
```

### 12.6 CEM tooling preset — IMPLEMENTED (`src/cem/`)

**Status:** built as the `@keenmate/web-components-core/cem` subpath (build-time
only — no runtime dependency; the analyzer injects the `typescript` API). The
stock `@custom-elements-manifest/analyzer` can't see our public surface — it
lives in `static inputs` / `static events` tables, not the Lit-style patterns it
recognizes — so without help the manifest would be empty.

- **`blissInputsPlugin()`** — an analyzer plugin. In `analyzePhase` it extracts
  each table-driven class; in `moduleLinkPhase` it merges the results into the
  manifest's class declaration (augments, never replaces, the analyzer's own
  analysis). It also adds the **core-declared** surface every `BlissElement` has
  but no table row describes (`withCoreDeclared`, `CORE_DECLARED_INPUTS` /
  `CORE_DECLARED_EVENTS`): attribute `defer` ↔ `shouldDefer`, `theme-source` ↔
  `themeSource` and the `ready` event on every table-driven class, plus attribute
  `responsive` ↔ `responsive` and the property `responsiveCallback` on classes with
  an input table (§6.7) — attribute + property + type + description, so
  custom-elements.json / web-types / VS Code data list them. A class that declares
  the same name itself keeps its own entry.
- **`extractBlissClass(ts, classNode, sourceFile)`** — the pure, unit-tested
  core. From each `InputDef` row it derives an `attribute` (kebab, with
  `fieldName` back-link) and a `field` member: **type** from the converter
  (`toEnum([...])` → union, `toInt` → `number`, `toText({isNullable})` →
  `string | null`, `toBool('tristate')` → `boolean | null`, …), **default** from
  the row's `default` or the converter's, **reflects** from `shouldReflect`, and
  **description/deprecated** from the row (or a leading comment). It follows an
  identifier to a `const TABLE = [...] as const` and unwraps `as const` /
  parentheses, so both inline and hoisted tables work. Events come from bare
  names or `EventDef` objects.
- **`blissAnalyzerConfig(options?)`** — the shared config preset (globs,
  excludes, `outdir`, plugins) every component's `custom-elements-manifest.config.js`
  extends, with the plugin pre-wired. It also runs `stableOutputPlugin()` (LF strings, modules by path) and
  `publicApiPlugin()` — the manifest is the PUBLIC API: no private / protected / `#` / `_` members, no module,
  declaration or export the entries (`publicApiEntries`, default `src/index.ts`) don't re-export; custom-element
  modules always kept; `isPublicApiOnly: false` opts out.

The source-of-truth split (§8 amendment): structure from the table, prose from
the optional `description` / `deprecated` fields on each row.

### 12.7 Testing utilities — IMPLEMENTED (`src/testing/` + `whenSettled()`)

**Status:** built. Two parts.

- **`BlissElement.whenSettled(): Promise<void>`** — a first-class "await the
  pipeline" signal, in **core** (not just tests). Resolves once every staged
  change has flushed and its `reinit()`/`update()` has run; resolves immediately
  when nothing is pending. `setProperties()`/`batch()` flush synchronously (so
  the element is already settled after them); loose property assignment coalesces
  on a microtask (so `el.x = …; await el.whenSettled()` awaits it). While
  detached, pending changes are held, so the promise resolves on the next
  connect's flush; while a `defer` gate holds the first build it resolves on
  `release()` (§6.3 — "settled" means built, so release first, then await). This
  replaces the flaky bare-`await Promise.resolve()` guess in tests AND gives
  consumers a deterministic read-after-write point. Its users are mainly tests;
  app code needs it only to read back rendered state (shadow DOM, layout, live
  getters) right after a write — the coalesced flush runs before paint, and
  imperative methods `flush()` themselves.
- **`@keenmate/web-components-core/testing`** — runner-agnostic DOM fixtures
  (pure DOM, zero deps, so they work under vitest+jsdom or a real browser):
  `mount(html|element)` (+ tracked `cleanup()`), `mountBeforeUpgrade()` (exercise
  the pre-upgrade property-capture path), `uniqueTag()` / `defineOnce()`,
  `nextTick()` / `nextFrame()`, and `listen(target, type)` → an `EventSpy`
  (`count` / `events` / `last` / `lastDetail` / `stop()`) for asserting §12.5
  emits without a mocking library.

The Playwright + a11y/contrast fixtures the original §12.4 note mentioned are
**deferred** — they need a real-browser toolchain and belong closer to a
design-system/theming package than the input-model core.

**Emulating device classes in Playwright (responsive rules §6.7, `classifyDevice`).**
`isMobile: true` on a page **without** `<meta name="viewport" content="width=device-width">`
reports `innerWidth` 980 (the legacy layout viewport) → the short side is ≥ 600, so the
device classifies as `tablet`, not `mobile`. To test `mobile`, emulate touch
(`hasTouch: true`, so `pointer: coarse` matches) or use a device profile
(`devices['iPhone 13']`) on a page that HAS the viewport meta tag. A merely narrow
`viewport` without touch stays `desktop` (capability over width) — width-driven rules
go on the map's `breakpoint` axis (or a `responsiveCallback`).

### 12.8 Style injection — IMPLEMENTED (`src/dom/adopt-styles.ts`)

**Status:** built (main index — tiny, zero-dep). The §12.4 theming candidate was
hedged as "may need no runtime code"; the resolution is that the *authoring*
conventions stay pure guideline, but the two *runtime* injection steps every
component re-rolls become core helpers. Core deliberately does NOT touch shadow
DOM elsewhere (it is render-agnostic — web-grid uses light DOM), so these are
free functions taking a root + CSS strings, NOT `BlissElement` methods.

- **`adoptStyles(root, ...cssStrings)`** — STATIC, shared stylesheets (the
  `main.css?inline` pattern). One `CSSStyleSheet` per unique string, cached
  module-level and shared across every instance via `adoptedStyleSheets` (dedup
  per root); `<style>` fallback where constructable sheets are unsupported;
  no-op under SSR.
- **`createStyleElement(root, { position?, cssClass? })`** → `{ set, clear,
  destroy }` — a PER-INSTANCE, replaceable `<style>` element for the
  `getCustomStylesCallback` pattern (user CSS that changes at runtime). One element
  at a consistent position, so re-`set` replaces rather than stacks — fixing the
  prepend-on-init / append-on-update inconsistency the components have today
  (e.g. multiselect's `.ms-custom-styles` handling). `<style>`-based on purpose:
  user CSS may use `@import`, which constructable stylesheets reject. Core owns
  the mechanism; the `getCustomStylesCallback` input row stays in each component's
  table (a `toFunction()` returning a CSS string).
- **`createCustomStyles(host, root, { getContext, getInstanceStyles, cssClass?,
  position?, appliedCallback?, shouldHoistImports?, getOwner? })`** → `{ refresh, destroy }` — the whole custom-CSS story on
  top of two style slots: the **page layer** for the host's tag
  (`window.components[tag].getCustomStylesCallback(ctx)`, else
  `window.components[tag].customStyles`) and, after it, the **instance layer**
  (`getInstanceStyles()` → the element's callback, else its `custom-styles`). Within a
  layer the callback wins when it is a function; both callbacks get the component's own
  context (`getContext()`). The page slot always precedes the instance slot, so an
  instance overrides shared rules. The per-tag accessors are installed by
  `registerComponent()` (enumerable, adopt a value set on a pre-created entry, a wrong
  type warns and keeps the previous value); assigning one refreshes every live handle of
  that tag (held weakly — a dropped element stays collectable). A throwing callback is
  logged and leaves its layer empty. Use case: `window.components['web-daterangepicker']
  .customStyles = "@import url('/css/drp-days.css')"` — one file for every picker,
  fetched once. No page-wide (all tags) layer: selectors are per component.
  **One adoption everywhere** (rulebook C-CA-15, canonical code in `docs/usage.md`): the
  `customStyles` / `getCustomStylesCallback` rows (`on: 'update'`), one handle
  (`cssClass: '<prefix>-custom-styles'`, core's default position), refreshed per build and on
  those keys, destroyed in `destroyCallback()`; no private custom-CSS code. A component that
  doesn't apply the page layer: core warns once per tag (THEME) when the page sets it — at the
  first instance's `ready`, or on the assignment when instances are live.
  **Fonts (`shouldHoistImports`, default `true`, rc20):** Chromium ignores `@font-face`
  inside a shadow root, so an `@import`ed icon font (FontAwesome from a CDN — cross-origin,
  its rules can't be read and copied) would draw boxes. Each `@import` URL of either layer is
  therefore ALSO linked in the document `<head>` (`<link rel="stylesheet"
  data-km-custom-styles>`), once per document: shared and ref-counted across every handle
  (page state, all core copies), dropped when the last handle stops importing it (CSS change,
  `destroy()`, or the host REALLY removed — a BlissElement host reports it at `removedCallback`
  timing through a core-internal removal watch, and a re-attached host takes its imports back;
  a DOM move keeps them). A `<link>` the page already has for that URL is reused and never removed.
  Only the imports the browser really loads count (the leading ones of each layer, comments
  skipped); a plain one becomes a `<link>`, one with conditions (`layer()`, `supports()`, media)
  a head `<style>` holding the whole statement, so its layer / media still apply.
  Shadow roots only (a light-DOM root registers fonts itself). Trade-off: the imported sheet's
  rules also reach the page. **The page decides** (CSP, or it loads those fonts itself):
  `window.components['web-treeview'].shouldHoistImports` (per tag, enumerable like the tag's
  `customStyles`), else the non-enumerable page-wide `window.components.shouldHoistImports`,
  else the component's own `createCustomStyles` option (default `true`). Assigning either
  re-syncs every live handle. CSP: the URL was already loaded by the shadow `@import` (same
  `style-src`); a conditional import's head `<style>` is inline like every custom-CSS slot.
  **Extra roots (`shouldShareLayers: false`, 2026-11-17, from web-dropzone's overlay layer):** a component that
  renders into a second root of its own (a `createLayer` overlay, a portaled panel) creates a second handle for
  it with the same inputs and `shouldShareLayers: false`: same page + instance CSS in that root, but it is not the
  host's registered layers — its `refresh()` / `destroy()` never notify or unregister what managed children read
  from the host's MAIN handle (one shared entry per host; the extra one used to replace it, and its `destroy()`
  dropped the children's owner layers). It FOLLOWS the main handle instead (audit G2, 2026-11-23): every main
  `refresh()` — the component's instance inputs changed — re-resolves it too, so the component refreshes only its
  main handle. A `createLayer` overlay takes it from `createLayer(host, { customStylesOptions })` (§12.29).

  **Managed children (`getOwner`, decided 2026-11-10, Q24):** an element a component mounts
  and owns (web-dropzone's bulk-mode satellites — picker / summary / queue bound to one store)
  also takes its OWNER's layers. The child's handle gets `getOwner: () => HTMLElement | null`
  and two more slots (`<cssClass>--owner-page`, `<cssClass>--owner`); the order in the child's
  root is **child page → owner page → owner instance → child instance** — the owner's layers
  come after the child's own page layer, the child's own instance CSS stays the most specific.
  The owner's CSS is the CSS the owner's OWN live handle last wrote (page state keeps host →
  resolved layers, weakly), not re-resolved by the child: the owner's callbacks run once, with
  the owner's context, and the child shows exactly what the owner shows. Live: a page write for
  either tag, and the owner's `refresh()` (its instance CSS changed), refresh the child — also
  when the owner's handle is created after the child's. `getOwner` is read on every refresh (a
  re-bind calls the child's `refresh()`); `null`, a throw (logged, THEME), the host itself, an
  owner without a live handle (none yet / `destroy()`ed) or an owner really removed from the
  page (the removal watch above) = no owner layers, i.e. today's behaviour. `@import` hoisting
  counts the owner layers like the child's own (under the child's hoisting setting). `appliedCallback`
  sees only the child's own layers (the owner's `appliedCallback` saw its CSS). Only the direct owner's
  own two layers — not the owner's owner.

The `?inline` import (Vite build concern) and the `@layer variables, component,
overrides` order (CSS guidelines, invariants #6–#9) stay authoring rules — the
helpers take strings and don't care how you got them or how they're layered. The
layer order is what makes custom CSS work: adopted sheets cascade after every
`<style>`, so a component's own CSS must sit in `@layer component` for un-layered
custom CSS (either layer) to beat it at equal specificity.

### 12.5 Callbacks & events — IMPLEMENTED (`src/element/`)

**Status:** built. The five components hand-roll two distinct things every time,
and both drift. The naming convention already separates them, and core now gives
each ONE unified primitive:

- **`*Callback` suffix = a hook that shapes behavior/state.** Interceptors
  (`beforeDateSelectCallback`), providers (`getDateMetadataCallback`), renderers
  (`renderDayCallback`). Its **return value matters** (veto / adjust / supply)
  and it may be async.
- **Events = outward, fire-and-forget notifications.** No `Callback` suffix
  (`select`, `change`, `date-select`). The `on<Name>` property is a listener
  alias, not a callback — return value ignored.

**Events — `static events` + `emit()` + `on<Name>` twins.** A component
declares its notifications in a `static events` table (a bare name, or an
`EventDef` for dispatch/property overrides). `emit(name, detail)` is typed
against the component's `BlissElement<TEvents, TController>` event map and does
three things, in order:

1. **attaches the component context** to the detail (`withContext`). A plain-object detail is
   shallow-copied first (every own descriptor kept), so the caller's object is never changed
   (review I-03); arrays and class instances get the context in place:
   `controller` (the component's public facade, `el.controller`, built once by
   the `createController()` hook) and `element` (the host) as **non-enumerable**
   properties, plus the enumerable extras from the `eventContext()` hook (popup
   components return their presentation flags). Destructuring works;
   `JSON.stringify`, `Object.keys`, logs and LiveView `pushEvent(…, e.detail)`
   see only the data. No detail → `{}` + context, so even `ready` carries it.
2. **calls the `on<Name>` twin** (default `on` + PascalCase, e.g. `onNodeClick`)
   with that detail object — a plain function property, not a listener. A
   throwing twin is logged and doesn't stop step 3.
3. **dispatches the `CustomEvent`** with the **same object** on the host —
   `bubbles: true`, `composed: false` by default (per-event overrides from the
   table). Non-composed: an event fired by a component nested in another
   component's shadow DOM (an editor in a grid cell) can't leak out and be
   mistaken for the outer component's.

*Changed in rc15 (interaction model, `docs/interaction-model-plan.md`):* the
twin used to be a managed **listener** receiving the `CustomEvent` (the
platform's `onclick` convention). That left every component with two `on*`
contracts under the same name (engine config `onSelect(option)` vs element
`onSelect(event)`); the house rule is now one detail shape for both surfaces.
`addEventListener` / the typed `on(name, handler)` method are the listener path.

Dev-time lint (warn-only, once per class) additionally flags an event name that
reuses a **composed native** (`click`, `focus`, `input`, `copy`, `paste`,
`keydown`, `pointer*`, `drag*`, …): fired inside a shadow root, the browser's
event of that name also reaches host listeners.

**`before*Callback` — one contract, `runBeforeCallback(fn, ctx, name?)`.** One
`ctx`; may be async. `false` rejects (nothing starts — a before-callback vetoes an operation before it begins; "cancel" is reserved for stopping a running one), `undefined`
continues, any other value (incl. `null`) continues with that value — what the
value replaces is the hook's documented contract. A throw rejects and is
logged. Returns a discriminated `BeforeCallbackResult` (`isRejected`,
`hasValue`, `value`). `runBeforeCallbackSync` is the variant for triggers that
need a synchronous answer (`dragstart`, `keydown`); a returned `Promise` there
is warned and ignored. `runBeforeCallbackEager` answers synchronously when the
hook does and returns a `Promise` only for an async hook — for flows that are
synchronous today (ms: a click selects in the same tick) and must stay so for
sync hooks. This supersedes the per-component result objects
(drp's `{ action: 'accept' | 'adjust' | … }`).

**`*Callback` — `runCallback(key, ctx, { whenUnset, errorCallback? })`.** Core owns only
the drift-prone plumbing: unset → `whenUnset`; the callback is invoked with a
single `ctx` argument and its result is normalized through `Promise.resolve` (so
sync OR async both work); a throw routes to `errorCallback` if given, else **re-throws**
(no silent swallow — a component that forgets `errorCallback` fails loudly).
`runCallback` stays the generic path for providers / renderers whose result has no
shared meaning; interceptors use `runBeforeCallback` above, whose contract core
now owns (the drp result objects it used to defer to go in rc15).

**Dev-time lint** (warn-only, once per class, with the input-table checks):
duplicate event name; a name that isn't lowercase kebab/bare (the `date-select`
convention); an `on<Name>` property that collides with an input `configKey`.

**Component renames** (`rowdelete` → `row-delete`, treeview's tense drift,
`cp-*` prefixes) ride each component's interaction-model migration (rc15). Core
still accepts any lowercase name; the composed-native lint is warn-only.

### 12.9 Environment (device / viewport / orientation) — IMPLEMENTED (`src/environment/`)

**Status:** built (main index — tiny, zero-dep). The gap: components already gate
behavior on *viewport width* but have no signal for *device capability*. The
motivating bug is web-daterangepicker on a phone — the floating calendar steals
focus from the input, so the soft keyboard flashes open then shut and the panel
dismisses. The fix is a fullscreen calendar on touch devices, but width alone
can't decide that: a **landscape phone is wide** (width says "desktop") yet still
wants fullscreen. The deciding fact is capability, not size.

**One shared observable.** `observeEnvironment(cb, { shouldFireImmediately? }) => unsubscribe`
is a lazily-started, ref-counted singleton over `matchMedia` + a rAF-throttled
`resize`; the shared listeners attach on the first subscriber and detach on the
last. `getEnvironment()` is the synchronous companion read (for `reinit()` /
`connect()`). The default width buckets are `{ mobile: 768, tablet: 1024, desktop:
Infinity }` (pure-css `$mobile-breakpoint` / `$tablet-breakpoint`; was 640 before
rc15). On the first browser snapshot the base tokens `--base-breakpoint-mobile` /
`--base-breakpoint-tablet` (read from `getComputedStyle(document.documentElement)`,
`768px` or unitless; absent / unparsable → the default) move those two lines. They are
settled once found; while absent and the page is still loading they are re-read on each
snapshot and one final time on the window `load` event (subscribers notified if the bucket
moved), then settled — nothing is read after load (rc19, review V-13: CSS injected by JS, as
in Vite dev, used to lock in the defaults). `configureBreakpoints(map)` redefines the buckets globally and always wins
over the tokens. Overriding the tokens (or calling `configureBreakpoints`) at runtime moves
components' `env.breakpoint` only — pure-css's compiled `@media` lines stay put. For the page
and the components to agree, change the breakpoints at compile time (SCSS
`$base-breakpoint-*`), which emits the matching tokens. SSR-safe: no `window`/`matchMedia` → a
static desktop default + no-op unsubscribe. Detection is **feature-detection, not
UA sniffing** — media queries are reliable AND already reactive.

**`EnvironmentSnapshot`** carries: `pointer` (`coarse`/`fine`/`none`, from
`(pointer: …)`), `hasCoarsePointer` (`(any-pointer: coarse)` — touch available at
all), `canHover` (`(hover: hover)`), **`isTouchPrimary`** (`coarse && !hover` —
*the* "phone/tablet, be aggressive" flag, honest in landscape where width lies),
`orientation`, `viewportWidth`/`Height`, and the resolved `breakpoint` name.

**OS hint (the one UA-derived exception).** `os`
(`ios`/`android`/`macos`/`windows`/`linux`/`unknown`) plus `isApple`/`isAndroid`
are **best-effort UA/Client-Hints** — there is no media query for "is this Apple",
so this is identity, not capability: constant per session (memoized), derived from
`navigator.userAgentData.platform` when present, else the UA string, with the
iPadOS-13+-masquerades-as-desktop-macOS correction via `maxTouchPoints > 1`. It is
documented as a **hint for genuine OS-specific quirks** (an iOS-Safari-only bug),
NOT a behavior gate where a capability query exists — `isTouchPrimary` stays the
decision signal (gating on `os === 'android'` would miss touch-Windows tablets and
mislabel iPads).

**`BlissElement` integration — the `environmentChanged(env)` hook.** Overriding
the (no-op-default) hook opts the element in: the base subscribes on every
`connect` and unsubscribes on every `disconnect` (balanced with the lifecycle,
via an override check so non-overriding elements attach NO global listeners). It
fires once immediately with the current snapshot on connect, then on every change
— a DOM move re-subscribes, an orientation flip re-fires. Components resolve their
own presentation from it (e.g. daterangepicker: `presentation: 'auto'` →
fullscreen when `env.isTouchPrimary`).

**Two channels — discrete vs continuous (rc09).** The observable splits by
cadence, because the two things a component asks the environment change at wildly
different rates. `observeEnvironment` / `environmentChanged(env)` is the
**discrete** channel: it fires only when a *category* field flips —
`breakpoint`, `orientation`, `pointer`/`hasCoarsePointer`/`canHover`,
`isTouchPrimary`, or the `classifyDevice()` class (rc15 — a foldable opening inside one width bucket). Raw `viewportWidth`/`viewportHeight` are **excluded from its
equality gate** (`environmentEqual`), so a plain desktop drag-resize that crosses
no breakpoint no longer wakes it — previously every 1px change passed the gate and
fired the hook ~60×/s during a drag, on every subscribed component. The snapshot
still *carries* the live width; the discrete channel just stops firing on it.
`observeViewport` / `viewportChanged(env)` is the **continuous** channel for the
few consumers that genuinely track live width (a layout that reflows *within* a
device class — e.g. drop a calendar from two months to one as its own box
narrows). It fires on raw size changes, **throttled to one notify per ~30 ms
(`VIEWPORT_THROTTLE_MS`), leading + trailing** — a steady stream during a drag
plus a final settled read, never a per-frame flood. Both are override-gated and
ref-counted over the *same* `matchMedia`/`resize` listeners, so an element that
overrides neither attaches nothing, and one that overrides only `environmentChanged`
pays zero per-resize cost (the 30 ms timer never starts). Caveat worth stating:
both report the **viewport** (`window.innerWidth`), not the element's own box — a
picker in a narrow sidebar on a wide monitor still reads "wide". Element-box
observation is the other half (below).

**Element-box reactivity — two tiers (rc09).** Reflowing to your *container*
rather than the viewport splits into two tiers, and the first is not core's job:

- **Tier 1 — CSS container queries (prefer this).** When the reflow is purely
  *presentational* (stack columns, hide a label, shrink padding), use
  `container-type: inline-size` on the host + `@container (max-width: …)` in the
  component's CSS. It's native, element-box, cheaper than any JS, and fires before
  paint. Core adds nothing here but the rule of thumb (a CSS authoring guideline,
  not code) — push as much as possible into this tier.
- **Tier 2 — the `sizeChanged(size)` hook (structural only).** Container queries can't
  make a JS decision — instantiate *one* calendar component instead of two, render
  a different button set, feed a width into `reinit()`. For that, overriding the
  (no-op-default) `BlissElement.sizeChanged(size)` hook opts the element into
  `observeElementSize(this, …)`: a **single, shared, page-wide `ResizeObserver`**
  (one observer watches every subscribed element, fanned out per target via a
  `WeakMap`, so N pickers pay for one observer) in `src/environment/element-size.ts`.
  It fires with the element's real laid-out **border box** shortly after connect
  (`shouldFireImmediately: false` so the first fire isn't a pre-layout `0×0`), then on box
  changes, **throttled to ~30 ms (leading + trailing)** with identical-size dedup —
  the same cadence as `viewportChanged`, which also sidesteps the `ResizeObserver`
  loop error by deferring reflow out of the callback. `size` is `{ width, height }`
  in CSS px — the LAYOUT size, CSS transforms not applied (rc19, review V-15: the observer
  reads the entry's `borderBoxSize`, mapped for vertical writing modes; the first fire
  `offsetWidth` / `offsetHeight`; SVG the bounding box). For a one-off read of the same size use
  `this.offsetWidth` / `this.offsetHeight` (`getBoundingClientRect()` includes transforms). Override-gated
  and balanced across connect/disconnect like the other environment hooks. SSR-safe
  (no `ResizeObserver` → one `0×0` fire + no-op unsubscribe).

Rule of thumb: **presentational reflow → container queries; structural reflow →
`sizeChanged()`.** The DRP dropping two months to one (a different number of rendered
calendars) is structural, so it's a `sizeChanged()` consumer.

**Classification vs presentation — two functions, split on purpose (rc07).** The
"what should this component show" decision is split into a shared *fact* and a
per-component *policy*:

- **`classifyDevice(env) → 'mobile' | 'tablet' | 'desktop'`** (`src/environment/`)
  is the shared classification every KM component must agree on. **Capability
  decides first:** a non-`isTouchPrimary` device is always `desktop`, at *any*
  window width — so a *narrowed desktop window* keeps a floating dropdown, never a
  fullscreen sheet. Only touch-primary devices consult the size line: the short side
  below `TABLET_MIN_SHORT_SIDE` (600, the Material `sw600dp` line) ⇒ `mobile`, else
  `tablet`. The short side is `min(viewportWidth, screenShortSide)` (the snapshot's
  `min(screen.width, screen.height)`): a soft keyboard shrinks only the viewport height, so it
  can't flip a landscape tablet to `mobile` mid-typing (review V-05), and a narrow window
  (iPad Slide Over) still reads as `mobile`. No screen size (SSR, jsdom) → the shorter
  viewport side. This is a **distinct axis** from the width-only
  `EnvironmentSnapshot.breakpoint` (a landscape iPad is `breakpoint: 'desktop'` yet
  `deviceClass: 'tablet'`); `deviceClass` is the one to key mobile/tablet UX off.
  The 600 line is a hard constant on purpose — it can't drift per app.
- **`resolvePresentation(mode, env, map?) → 'floating' | 'modal' | 'fullscreen'`**
  (`src/overlay/`) owns the *policy*, which legitimately differs per component (a
  multiselect wants a floating panel on a tablet; a calendar may want a centered
  modal). `auto` classifies the device and looks the class up in `map`, falling
  back per-class to `DEFAULT_PRESENTATION_MAP` (`mobile: 'fullscreen'`, `tablet`/
  `desktop: 'floating'` — what every overlay component does today); a forced mode
  is returned as-is. A component passes only the classes it overrides, e.g.
  `{ tablet: 'modal' }`. The author-facing setting type is `Presentation`
  (`'auto' | ResolvedPresentation`) — components expose it as the `presentation`
  input. (The rc06 `MobilePresentation` type and binary `resolveMobilePresentation`
  were removed in rc15.)

**Escape hatch — width (or anything) *within* a class.** The `map` is keyed by
`DeviceClass` only, so it can't express "desktop, but under 800px show a modal" (a
desktop is one class at any width). That's deliberate: `classifyDevice` owns the
*shared* boundary (the 600px line no app should redefine), while a per-component
rule *finer* than the class is the component's own logic, not core's. A component
that needs it stops calling `resolvePresentation` and composes directly — it
already holds the snapshot via `environmentChanged(env)` / `getEnvironment()`, so
`env.viewportWidth` is the current width:

```ts
protected environmentChanged(env: EnvironmentSnapshot) {
  if (this.mode !== 'auto') return this.render(this.mode);   // author forced it
  const cls = classifyDevice(env);                            // shared classification
  const p =
    cls === 'mobile'             ? 'fullscreen' :
    cls === 'tablet'             ? 'modal' :
    env.viewportWidth < 800      ? 'modal'      :             // desktop, narrow
                                   'floating';                // desktop, wide
  this.render(p);
}
```

Rule of thumb: **class-only policy → `resolvePresentation(mode, env, map)`;
width-aware (or any snapshot field) → `classifyDevice(env)` + your own branch.**

Overlay runtime helpers for the fullscreen tier: `lockBodyScroll()` (ref-counted
body-scroll lock) and `fitToVisibleViewport(panel)` (pin a fixed sheet above the
soft keyboard via `visualViewport`).

`lockBodyScroll()` **pins** `<body>` (since rc18): on the first lock it records
`scrollX` / `scrollY` and the body's inline `position` / `top` / `left` / `right` /
`width` / `overflow`, then sets `position: fixed; top: -scrollY; left: -scrollX;
right: 0; width: 100%; overflow: hidden` — the page doesn't move, and iOS Safari
(which ignores `overflow: hidden` for touch scrolling) can't scroll it either. The
last release restores the styles and calls `scrollTo({ …, behavior: 'instant' })`,
so a page with `html { scroll-behavior: smooth }` doesn't animate the jump back.
`<html>` also gets `overflow-x: hidden` while locked (rc20, its inline value saved in
`saved.rootStyle` and restored): a page wider than a phone screen otherwise keeps the browser
zoomed out to fit it, so a fullscreen sheet is drawn too small / under the system bar. A joiner
that saved no `rootStyle` (an older copy, pure-css before its port) leaves `<html>` alone on
release.

**Cross-bundle state.** Every component bundles its own copy of core, so page-wide
overlay state can't live in module variables:
- the lock's count and snapshot live on `globalThis[Symbol.for('km-scroll-lock')]`
  (internal type `ScrollLockState`, not exported: `{ count, saved: { scrollX, scrollY, style, body?, rootStyle? } | null }`) — a
  documented shape, so non-core code (pure-css) can join the same lock;
- `ALL_OVERLAY_GROUPS` (the `dismissAllOverlays()` wildcard of `km-overlay-activate`) is
  `Symbol.for('km-overlay-all-groups')`, so a dismiss from one component's copy
  reaches every other copy and outside listeners can compare against it;
- the breakpoint table (`configureBreakpoints()`, the tokens settled by page load) lives on
  `globalThis[Symbol.for('@keenmate/web-components-core:breakpoints')]`, and
  `configureBreakpoints()` fires `km-breakpoints-change` (`BREAKPOINTS_CHANGE_EVENT`) on
  `document` so the other copies recompute their cached snapshot.

Rule for new page-wide state in core: never a module variable — `sharedState(key, init)`
(`src/global/shared-state.ts`: a `Symbol.for` key on `globalThis`), plus a `document`
event when the other copies cache something. A published key is a contract: never rename
it; an incompatible shape change takes a new key with a version suffix (`…:name@2`).

**Overlay tree (since rc18, step 1).** Overlays nest: modal → dropdown → context menu →
submenu, any depth. The `km-overlay-activate` detail gains an optional `ancestors` array
(the opener's ancestor sources, parent first); a participant whose source is in it is not
dismissed. Core computes it: `registerOverlay(onDismiss, group, { getElement })` names the
overlay's panel, and `activate({ trigger })` finds the parent — the nearest OPEN overlay
whose panel contains the trigger (composed walk, across shadow roots), from a page-wide
registry (`sharedState('open-overlays')`) every copy of core shares; `activate({ parent })`
overrides it. The rules:
1. opening never dismisses an ancestor; group exclusivity applies to everything else;
2. `deactivate()` (closing) dismisses the overlays opened inside it, deepest first;
3. an overlay dismissed by another activation leaves the tree even if its handler never
   deactivates (it can't become a parent afterwards);
4. an activation without `ancestors` (older code, pure-css) behaves exactly as before.
`/menu` registers its root level and passes its opener.

**Step 2 — routing (since rc20 work, opt-in).** `registerOverlay(onDismiss, group, {
getElement, shouldCloseOnEscape, shouldCloseOnOutsideClick })`: one page-wide `keydown` /
`pointerdown` / `pointerup` capture + `window` `click` (capture and bubble) listener set (installed once, by whichever copy needs
it first; the routing key is versioned, see below) routes
- **Escape** to the DEEPEST open overlay that opts in — one level per press; focus returns
  to its trigger when it was inside the panel; the key is consumed; a press already `defaultPrevented`
  is skipped — a focus-shown `createTooltip` consumes the first Escape on `window` capture (§12.2);
- an **outside click**, decided when the click ENDS (the `window` bubble listener runs after the
  page's own click handlers), like the browser's popover light dismiss: the press records the
  overlays it started outside of, the click closes those it also ended outside of. The overlay
  clicked in (the deepest whose panel is on the event's composed path) and its ancestors stay;
  the rest close, deepest first. Not outside: the overlay's own trigger (it toggles it), its
  `getInsideElements`, and a click during which it was (re)activated or claimed
  (`handle.claimCurrentClick()`: a page button driving it through its API, e.g.
  `scrollToIndex()`). A click whose propagation a page handler stops (a tree's checkbox) never
  reaches the bubble listener: a `window` capture listener saw it on the way down, and it is
  decided once its task is done (rc20; rc19 missed it). A keyboard "click" (no press), a
  cancelled press (`pointercancel`) and a press that never got its click (a drag released
  elsewhere — forgotten after its `pointerup` task) close nothing. Decided at `pointerdown` instead (rc18), a page "toggle" button closed the
  overlay on the press and its click reopened it (createPopover fit study, B7).
  Mixed core copies: the click-time rule is stored as `outsideClickRule`, so an older copy's
  `pointerdown` router ignores it; this copy honours an older entry's `shouldCloseOnOutsideClick`
  at click time.
`onDismiss(reason)` gets an `OverlayDismissReason`: `'overlay'` (another activation,
`dismissAllOverlays`), `'parent'` (the overlay it was opened from closed), `'escape'`,
`'outside-click'`. `registerOverlay()` options: `shouldCloseOnEscape` / `shouldCloseOnOutsideClick`
(a boolean or a function asked at each key / press), `getInsideElements` (more elements a press
on doesn't count as outside), `beforeEscapeCallback()` (return `false` = the overlay handled Escape itself —
stepped back a level — and stays open; the press is consumed); `activate({ returnFocusTo })` overrides the
trigger as the focus target (`null` = none); `activate({ dismissGroups })` also dismisses those groups (same
exclusions: itself + its ancestors — `startModalSession` passes the default group, §12.19); `deactivate({ shouldReturnFocus: true })` returns focus the same
way on the component's own close paths (✕, a pick), when it was inside the panel. A sub-panel that is not a
popover (an inline year selector) joins the tree the same way to get outside-click / Escape — no own
document click manager. `createPopover({ shouldCloseOnEscape, shouldCloseOnOutsideClick,
getInsideElements, returnFocusTo, overlayGroup, closeCallback })` joins the tree with them. `/menu` keeps its own keyboard and
dismiss handling (its submenus are levels of ONE overlay) but is a node of the tree;
components move their own dropdown dismissal onto the stack when they next touch it.
`lockBodyScroll()` pads `<body>` by the width of the vertical scrollbar that pinning actually removes
(`<html>` `clientWidth` after minus before; no sideways jump) — 0 with overlay scrollbars, on touch
devices, or under `scrollbar-gutter: stable`; never `innerWidth - clientWidth`, which on a zoomed-out
phone page wider than the screen is the horizontal overflow.

**Phone Back (`claimBackEntry(onBack)`, decided 2026-11-13).** A sheet / modal that the phone Back
gesture should close holds ONE history entry (same URL, `history.state = { kmBackEntry: true }`)
while open: `const release = claimBackEntry(() => close('back'))` on open, `release()` on every
other close. Back pops the entry and runs the newest claim's `onBack` (call `claimBackEntry` again
from it to re-arm — one level up, the sheet stays open); a release gives the entry back with
`history.back()` one task later, so a sheet opening right after adopts it instead. Page-wide
(shared state, every copy of core), one entry for the page. While held, the page's entry uses
`history.scrollRestoration = 'manual'` and gets its own mode back one task after it is current again
(the browser restores scroll after `popstate` and reads the mode then): the entry is
pushed while `lockBodyScroll()` has the window at scroll 0, so the browser's own restore would jump
the page to the top after the lock put it back. Replaces the private copies in web-multiselect
(`pushOverlayHistory`), web-daterangepicker (same) and web-grid (`claimHistoryEntry`); `/menu`'s
sheet uses it too (`src/overlay/back-entry.ts`).

`startSheetSession(panel, { backCallback, shouldLockScroll, shouldFitToVisibleViewport, shouldCheckContainingBlock,
logSource })` (`src/overlay/sheet-session.ts`) composes `lockBodyScroll` + `fitToVisibleViewport` + `claimBackEntry`
(+ a one-time containing-block warning via `getFixedPositionOffsetParent`) behind one idempotent `end()`;
`rearmBack()` re-claims from inside `backCallback`. A phone sheet is modal (rule C-CA-19), so a component's
full-screen sheet gets it through `startModalSession()` (§12.19), which runs it underneath.

**Sheet chrome (`SHEET_CHROME_CSS` + `createSheetHeader()`, decided 2026-11-13).** Every phone
sheet / full-screen panel has ONE header bar: `.km-sheet-header` > `.km-sheet-title` (optional) +
`.km-sheet-close`. The close is a fixed-size round chip (`--base-touch-target-min`) with the
`--base-icon-close` mask in `currentColor` (no text glyph), slid toward the trailing edge, and an
invisible `::after` that stretches the tap target into the sheet's top-trailing corner without
covering the first row; bg / border / radius turn it into a bordered button. A component adds the
classes to its own elements (or builds them with `createSheetHeader({ title, closeLabel, closeCallback })`,
then adds its BEM classes and any fields), adopts `SHEET_CHROME_CSS` into that root, and maps its
own variables onto the private `--_km-sheet-*` on its host with no fallback (the `/menu` three-layer
rule, §12.13); the page themes every sheet with `--km-sheet-*`. Sizes from base-css-variables
(`--base-space-*`, `--base-font-size-lg`, `--base-font-weight-semibold`, × `--base-rem`). Replaces the
four copies (menu sheet + grid sheet: a text ✕; multiselect + daterangepicker: the mask chip this
standardises on) and the dropzone drawer / popover close (`src/overlay/sheet-chrome.ts`).

**Full-screen frame `.km-sheet` (decided 2026-11-23, audit Q8 / G4).** The phone full-screen sheet PANEL, next to
`.km-drawer` (§12.29) in `SHEET_CHROME_CSS`: `position: fixed` pinned by `top` / `inset-inline-start` with
`100dvw × 100dvh` — NOT `inset: 0`, because the keyboard inset (`fitToVisibleViewport`) writes an inline `height` /
`top` that a pinned bottom would defeat — `box-sizing: border-box`, full-bleed background, four-edge
`env(safe-area-inset-*)` padding, `overflow: hidden` + `overscroll-behavior: contain`, the modal tier, no margin /
border / radius / shadow / resize, and a flex column: the header (`createSheetHeader()`) then `.km-sheet-body` (the
scroller: `flex: 1`, `min-height: 0`, `overflow-y: auto`) — or the component's own scrolling column. It fades + rises
in on `--km-sheet-duration` (→ `--base-duration-medium`; `data-motion` / reduced motion through the token) by
`--km-sheet-enter-offset`; closing = `animateOut(panel, { className: 'km-sheet--closing' })`. Variables (same layering
as `.km-drawer`: `--_km-sheet-*` → `--km-sheet-*` → base tokens → `light-dark()`): `--km-sheet-bg` (→
`--base-elevated-bg`, `--base-main-bg`), `-color` (→ `--base-text-color-1`), `-z-index` (→ `--base-z-modal`),
`-duration`, `-enter-offset`. A component's full-screen sheet = its panel + `.km-sheet` + `startModalSession(panel, {
dismissCallback, shouldFitToVisibleViewport: true })` (rule C-CA-19). It replaces six copies: web-multiselect
`.ms__dropdown--fullscreen` + `.ms__selected-popover--fullscreen`, web-daterangepicker `.drp__picker--fullscreen`,
web-dropzone `.dz__popover--sheet` / `.dz__indicator-drawer--sheet`, web-grid `.wg__dropdown--sheet` +
`.wg-datepicker-container--sheet`. `/menu`'s sheet is a bottom sheet (not full-screen) and keeps `.km-menu-sheet`.

### 12.10 Theme context (dark / light) — IMPLEMENTED (`src/environment/theme.ts`)

**The gap.** Components followed a framework's dark/light signal with
`:host-context([data-theme="dark"])`, `:host-context([data-bs-theme="dark"])` and
`:host-context(.dark)`. Firefox doesn't support `:host-context()` and Safari only
partly, so on a Tailwind `<html class="dark">` page those browsers rendered the
component light. Every BlissFramework component carried the same rules, so the fix
belongs here, once.

**Detect once, reuse.** Detection moves to JS and runs once per *watched element*,
not per component:

- The **page** (the default): `<html>`, then `<body>`. On each element the signal
  is read in a fixed order and the first match wins: `data-theme`, then
  `data-bs-theme`, then a `.dark` / `.light` class. Only `dark` / `light` count; a
  named theme (`data-theme="corporate"`) falls through.
- One cached value per watched element, computed when its first subscriber arrives.
  One shared `MutationObserver` per watched element (`attributeFilter` = `class`,
  `data-theme`, `data-bs-theme`) re-detects only when a signal attribute changes,
  and subscribers are notified only when their *result* changes. 50 components on
  one page = one detection + one observer. The page observer also watches `<html>`'s
  direct children, so a swapped `<body>` (Turbo / htmx) is re-attached.
- Ref-counted: an observer starts with the first subscriber of its element and stops
  with the last.

**Forcing and sources (resolution order, highest first).**

1. **Per-instance `data-theme="dark|light"` on the component** — pure component CSS
   (`:host([data-theme])` rules come after the context rules), above everything here.
2. **`setThemeMode('dark' | 'light')`** — forced globally. Observers pause while
   forced (nothing to detect); `setThemeMode('auto')` re-detects once and resumes.
3. **`theme-source`** — a per-component source instead of the page: a CSS selector
   (nearest matching ancestor, crossing shadow roots; else the first match in the
   document), `closest` (the nearest ancestor carrying a signal, re-resolved whenever
   one of the host's ancestors gains or loses one — the old `:host-context` reach,
   opt-in; one shared observer watches every `closest` subscriber's ancestors), or an
   `Element` (property). Components sharing
   a source share its cache and observer. `<html>` / `<body>` as a source collapse
   to the page watch. A source without a signal falls back to the page.
4. **The page.**
5. **`null`** — nothing to mirror; the inherited `color-scheme` (and the OS
   preference through `light-dark()`) applies, exactly as before.

Forcing beats detection at every level, so a global `setThemeMode()` also beats a
`theme-source`; a section that must differ from a global force uses per-instance
`data-theme`.

**Trade-off, on purpose.** The default is page-level. A `data-bs-theme="dark"` on a
wrapper `<div>` is no longer picked up automatically (`:host-context` did that in
Chromium only); use `theme-source="closest"` or a selector there. A selector source is
fixed for the subscription — changing `theme-source` re-resolves, a matching element
added later does not. `closest` follows its ancestors: a section switched to dark after
the component connected (it had no signal then) becomes its source, and a source that
loses its signal hands over to the next ancestor that has one, then the page.

**Cross-copy safety.** The state (mode, page watch, source watches) lives on
`globalThis[Symbol.for('@keenmate/web-components-core/theme@1')]`, so two components
that each bundle their own copy of core still share one mode and one observer per
element. The `@1` suffix versions the state shape.

**`BlissElement` integration.** On by default for every component:

- Every element observes the global `theme-source` attribute (like `dir`) and has a
  `themeSource` property (string reflects to the attribute; an `Element` doesn't).
- On connect it subscribes with its source and mirrors the effective scheme onto the
  host as **`data-context-theme="dark|light"`** (removed when `null`), then calls the
  opt-in **`themeChanged(scheme)`** hook (for JS-side theming: canvas, chart palette).
  Unsubscribes on disconnect; a source change while connected re-subscribes.
- `static hasThemeContext = false` opts a component out entirely (no subscription).

Component CSS replaces the `:host-context` rules with plain host selectors, which
work in every browser:

```css
:host([data-context-theme="dark"])  { color-scheme: dark; }
:host([data-context-theme="light"]) { color-scheme: light; }
/* per-instance forcing stays after these, so it wins */
:host([data-theme="dark"])  { color-scheme: dark; }
:host([data-theme="light"]) { color-scheme: light; }
```

**API** (main index): `setThemeMode(mode)`, `getThemeMode()`,
`getThemeContext(host?, source?)` (sync read; cached while observed),
`observeThemeContext(host, source, listener, { shouldFireImmediately? }) => unsubscribe`,
`readThemeSignal(el)`, `resolveThemeSource(host, source)`, the constants
`THEME_CONTEXT_ATTRIBUTE` / `THEME_SOURCE_ATTRIBUTE`, and the types `ColorScheme`,
`ThemeMode`, `ThemeSource`, `ThemeListener`. SSR-safe: no DOM → `null` (or the forced
mode) once, no-op unsubscribe.

### 12.11 Search (normalization, matching, highlight) — IMPLEMENTED (`src/search/`)

**The gap.** web-multiselect 2.6.0-rc02 shipped a search model (accent-insensitive by
default, match modes, a custom term hook, highlight that follows the matching rules) as a
component-local module. web-treeview searches through a bundled FlexSearch index and would
have to re-implement the same rules to agree with it. The rules move here once, so
`search-behavior` / `search-match` mean the same thing in every component.

**Two independent axes** for built-in search, which works on strings only:

- `SearchBehavior` — how text is normalized, for the item values *and* the term:
  `normalized` (default; NFKD, strip combining marks that follow a Latin / Greek / Cyrillic
  letter, lowercase, hand-fold `ł ø đ ð ħ ı ŧ ŀ þ→th ĳ→ij ß→ss æ→ae œ→oe ς→σ`),
  `case-insensitive` (NFC + lowercase, `ß→ss`, `İ→i`, `ς→σ`), `exact` (NFC only). Every mode
  applies NFC, so composed and decomposed accents compare equal. `normalizeSearchText` is
  public so a custom search can normalize identically.
- `SearchMatch` — where the term must sit: `contains` (default), `equals`, `starts-with`,
  `ends-with` (whole value), `word-starts-with`, `word-ends-with` (a word = a run of
  `[\p{L}\p{N}\p{M}]`), `regex`. A regex is tested against the **raw** value with no flags:
  normalization does not apply, case and accents are up to the pattern. A typed pattern
  that doesn't compile (mid-typing) reuses the instance's last valid one
  (`createRegexCompiler`).

**Internal vs own search.** A component with search offers:

- `getSearchTermCallback({ term, target, behavior, match })` → `PreparedSearchTerm`. For
  built-in search (`target: 'internal'`) a string is used as-is (not normalized again) and a
  RegExp is matched raw (made stateless); an object is unusable there (`objectTermCallback`, the
  component warns). For `target: 'callback'` anything goes.
- `searchCallback(ctx)` — the consumer's engine (FlexSearch, a server).
  `SearchCallbackContext<T, TTerm>` = `{ term, signal, entries }`: the term to search
  for (the prepared term — `getSearchTermCallback`'s `target: 'callback'` result, else
  the typed text; ONE field, no raw/prepared pair), an `AbortSignal` for superseded
  searches, and every record paired with its search value (`SearchEntry` =
  `{ data, searchValue }` — `data` is domain-neutral, `item` is reserved for action
  items; the value may be an object from
  `getSearchValueCallback`). `entries` is built lazily on first access and is the **same
  array** until the items change, so an engine can key its index on it.

Built-in search state is an `ActiveSearchTerm` (`none` / `text` / `regex`) from
`prepareSearchTerm`; `matchesSearchTerm(term, match, prepared, raw)` tests one item, with
`prepared` / `raw` optionally lazy. **The component owns the per-item cache** (each value
read and normalized once, not per keystroke; invalidated when items or the
member/callback change) and the search flow — the module is pure and DOM-free. The cache
moves here when a second component needs it (web-treeview,
`docs/search-migration-plan.md` Phase 3).

**Highlight returns ranges, not HTML.** `findHighlightRanges(label, term, opts)` →
`{ text, ranges }`: for a text term the label is NFC'd and folded per code point with an
index map back, so `ces` marks `Čes` in `Český`, `ss` marks a whole `ß`, and combining marks
after a match stay inside it. The ranges index into the **returned** `text` — an NFD
`Zli\u0301n` comes back as NFC `Zlín`; ranges applied to the original would cut before the
accent. `wrapRanges(text, ranges, { open, close, escape })` builds the markup from PLAIN
text and escapes every slice with `escapeHtml` by default (since rc19 — it used to insert
the text raw, so a label like `<img onerror=…>` was an XSS path). A label that is already
trusted HTML (web-multiselect's display HTML) goes through `highlightHtml(html, term,
{ behavior, match, open?, close? })`: tags are kept and never marked, each run of text is
matched on its decoded text (an entity is one character and never split), so a `<mark>` can't
land inside a tag or an entity; a match spanning a tag boundary isn't highlighted.

**Folding.** One routine backs `normalizeSearchText` and the highlight map. `normalized`
uses compatibility decomposition (ligatures, full-width forms, no-break spaces fold) and
strips combining marks only after Latin / Greek / Cyrillic letters — Devanagari vowel signs
and kana dakuten are part of the letter and stay; `case-insensitive` folds `ß` → `ss` and
`İ` → `i`. Word boundaries are per code point, and a combining mark is part of the word.
ASCII takes a fast path with the same result (a whole-ASCII string is one `toLowerCase()`; inside the fold an
ASCII code point skips the Unicode work), so normalizing 100k grid values costs about what `toLowerCase` does.

**API** (`@keenmate/web-components-core/search`, not re-exported from the root):
`normalizeSearchText`, `findTextMatches`, `matchesText`, `findRegexMatches`,
`createStatelessRegex`, `NO_SEARCH_TERM`, `createRegexCompiler`, `prepareSearchTerm`,
`matchesSearchTerm`, `findHighlightRanges`, `wrapRanges`, `highlightHtml` (`escapeHtml` is on the root index only); types `SearchBehavior`,
`SearchMatch`, `SearchTermContext`, `PreparedSearchTerm`, `SearchEntry`,
`SearchCallbackContext`, `ActiveSearchTerm`, `SearchRange`, `HighlightResult`,
`RegexCompiler`, `PrepareSearchTermOptions`, `WrapRangesOptions`. No dependencies.

### 12.12 Actions (buttons, toolbars, menus) — IMPLEMENTED (`src/actions/`, subpath `/actions`)

**Status:** built (rc15). Plan, decisions and per-component inventory:
`docs/interaction-model-plan.md`, `docs/interaction-inventory/`.

Every clickable item a consumer configures — action buttons, row/cell toolbars,
context and header menus, palette commands — is an **`ActionItem<Ctx, A>`**:
`action?` (a built-in name, else `'custom'`), `id?`, `text`, `icon`, `tooltip`,
`shortcut`, `cssClass`, `isVisible`, `isDisabled`, `isDanger`, `isToggled`
(toggle state — the thing it toggles is ON; a button renders `aria-pressed`, a menu
item `role="menuitemcheckbox"` + `aria-checked`), each dynamic field with a separate
`get*Callback(ctx)` (callback wins), and `onClick(ctx)`. `MenuItem` adds
`children` / `getChildrenCallback(ctx)` (may be async) / `shouldCloseOnClick`;
`MenuDivider` (`createMenuDivider(text?)`) is its own entry — never a flag on an item.
`Ctx` is the **surface context** the component builds when it renders or opens
the surface (the row a menu opened on, the picker's selection), carrying the
component context (`controller`, `element`).

Helpers: `resolveActionItem(item, ctx, defaults?)` (callback > static >
component default > base; a throwing callback is logged and the static value
used), `resolveMenuEntries(entries, ctx, defaults?)` (drops hidden items, trims
leading / trailing / doubled dividers, expands string built-ins),
`loadMenuChildren`, `normalizeActionItems` (string shorthand),
`readActionDataset(el)` (`data-*` minus `action` / `id`).

**One `action` event per component.** `runAction({ detail, beforeActionCallback,
emitAction, runBuiltIn })` fixes the order for every surface:
`beforeActionCallback` (`false` cancels — nothing else runs) → item `onClick` →
built-in behaviour → `action` event + `onAction` twin (`emitAction`, normally
`this.emit('action', detail)`). The event is a **notification after the fact**: a
listener sees the state the built-in left (grid `delete` → the row is already gone
from `items`; `add` → the new row is present; `move-*` → the new order). A throwing
`onClick` or built-in is logged (not thrown) and the event still fires — the
activation happened; listeners re-read the actual state. The item is busy
meanwhile (`aria-busy`, a second activation ignored). The detail (`ActionEventDetail`) = surface context +
`action`, `id`, `item`, `source` (`'action-buttons' | 'row-toolbar' |
'context-menu' | …`), `sourceEvent`, `triggerElement`, `dataset` — one object for
`beforeActionCallback`, `onClick`, `onAction` and the DOM event. HTML a consumer
authors (a `showMessage` body) participates via `data-action="custom"
data-id="…"`; internal controls use a prefixed attribute so they can't collide.


**Shortcuts (`src/actions/shortcut.ts`).** `shortcut` has one syntax: `+`-joined chords, `Mod` (⌘ on Apple,
else Ctrl), space-separated sequences, `KeyboardEvent.key` names (aliases `Plus`, `Space`, `Esc`, `Del`, `Up`…;
ProseMirror `Mod-Shift-z` read too; free text with other characters is not a shortcut and shows as is).
`parseShortcut` / `matchesShortcut(event, s)` (modifiers exact, a bare single character ignores Shift, letters /
digits also match by `event.code` for macOS Option) / `formatShortcut` (`Ctrl+Shift+Z`, Apple `⇧⌘Z`) /
`getShortcutKeycaps` / `isTypingTarget` / `bindShortcuts(target, bindings | () => bindings, { sequenceTimeoutMs })`
(sequences, plain keys skipped while typing unless `shouldFireWhileTyping`, `run()` returning `false` keeps the
default). A binding's `isEnabled?(event)` is the key-press gate, asked only for the binding that matched the key
(incl. a sequence's first key): `false` skips it WITHOUT consuming the key (no `preventDefault()`), so the event
falls through to the next matching binding or an outer `bindShortcuts` on an ancestor (every listener skips a
`defaultPrevented` event, so an inner handled key never reaches the outer one). web-grid's Excel rule "no
shortcuts while a cell editor has focus" = `isEnabled: (e) => !isTypingTarget(e)`. Row / lock / permission gates
are NOT this hook's job — they stay on the action item (`getIsDisabledCallback(ctx)` / `beforeActionCallback`).
`/menu` formats item shortcuts and matches them with it.
### 12.13 Menu (context / dropdown menus) — IMPLEMENTED (`src/menu/`, subpath `/menu`)

**The gap.** web-treeview, web-grid and web-editor each rendered their own context
menu from `/actions` data — three renderers, three positioning stacks, three dismiss
rules, no keyboard model beyond shortcut letters + Esc.

**API.** `openMenu(entries, ctx, opts) → MenuHandle { isOpen, element, close(),
focusFirst(), update() }`. Options: `at` (viewport point or element), `host` (shadow
root / element the levels are appended to; the stylesheet is adopted into its root),
`runAction(item, { triggerElement, sourceEvent })` (the component's wrapper over core
`runAction()` — a leaf closes the menu first, then runs; a `shouldCloseOnClick: false`
item runs and its level re-renders when the returned promise settles),
`closeCallback(reason)` (`'action' | 'escape' | 'tab' | 'outside-click' | 'scroll' | 'blur' |
'overlay' | 'api' | 'empty' | 'back' | 'close-button' | 'presentation'` — `'back'` / `'close-button'` from the phone sheet, `'presentation'` an `'auto'` menu's device-class flip to / from floating; `'scroll'` by the popover's rule — one shared `watchScrollClose()`: the page or a
scroller around the `at` element / host, once it moved; never inside the menu, no bare wheel —
rc20), `renderItemCallback(item, el, ctx, resolved)` (fill-or-fall-through),
`renderMenuCallback(el, close)` (full custom content; core still positions + dismisses),
`defaults` / `prepareItemCallback` (built-in state / rewrite, every level), `placement`,
`offset`, `cssClass`, `shouldFocusFirst`, `returnFocusTo`,
`shouldCloseOnOutsideInteraction` (default `true`), `overlayGroup`, `labels` (`{ loading }`),
`inheritThemeFrom`, `presentation` (`'auto' | 'floating' | 'sheet' | 'drawer'`, default `'auto'`),
`presentationMap`, `side` (`'start' | 'end'`, the drawer's edge), `title`, `labels.back` / `labels.close`. No visible item → nothing rendered, a closed handle, no `closeCallback`.

**Phone: the bottom sheet (decided 2026-11-11).** Every component's context / column menu
gets the phone presentation from core, so the phone rule is ONE rule: `presentation: 'auto'`
classifies the device (`classifyDevice(getEnvironment())`, §12.9 — the device class, never a width
literal) and looks it up in `presentationMap` over `DEFAULT_MENU_PRESENTATION_MAP`
(`{ mobile: 'sheet', tablet: 'floating', desktop: 'floating' }`); a phone → the sheet, tablet /
desktop keep the floating menu. `'floating'` is the per-component / per-call opt-out, `'sheet'` /
`'drawer'` force one. Width-based choices are the host component's responsive rules (§6.7) on its
`menu-presentation` input, not the menu's. While an `'auto'` menu is open, `observeEnvironment`
re-resolves it on a device-class change (a rotation never changes the class — the short side
stays; a foldable unfolding does): sheet ⇄ drawer switch in place (classes only), a switch to /
from `'floating'` closes it with `'presentation'` (another structure; the next open gets it).

**Menu hosts (decided 2026-11-13).** A component that opens menus spreads `createMenuPresentationInputs()`
into its `static inputs` — `menuPresentation` (`menu-presentation`, `auto | floating | sheet | drawer`)
and `menuSide` (`menu-side`, `start | end`), both `on: 'none'` (read at open) — and opens with
`...getMenuPresentationOptions(this.config)` (the effective config, so the responsive rules apply) plus
`labels.back` / `labels.close` from its own `labels`. One spelling for every host; rulebook C-RO-16.

**Drawer (decided 2026-11-13).** `'drawer'` = the same sheet as a full-height side panel:
`.km-menu-sheet--drawer` + `--left` / `--right` (physical, from `side` and the opener's `dir`:
`'start'` is left in LTR), `width: --km-menu-drawer-width` (`min(320px, 85vw)`), the inner corners
rounded (`--base-border-radius-lg`), safe-area padding on its three free edges. Everything else —
header, drill-in, Back, dismiss, focus — is the sheet's. An app navigation sidebar (links, current
page, docked) is not `openMenu()`: it would reuse the sheet chrome, not the menu.

**Motion (decided 2026-11-13).** The sheet slides in from its edge (bottom / left / right) and the
backdrop fades, `--km-menu-sheet-duration` → `--base-duration-medium` with `--base-ease-out`;
closing plays the reverse (`--closing`, inert, `--base-ease-in`) and then removes both — at once
when the computed duration is 0. Only the tokens: `data-motion` and OS reduced motion reach them
through `MOTION_CSS` (`adoptMotionStyles(sheet)` on open), no own media query. The sheet:
- **DOM.** `.km-menu-sheet-backdrop` + `.km-menu-sheet` (`role=dialog`, `aria-modal`,
  `aria-label` = `title`) appended to `host`: a header `__header` (the shared sheet chrome, §12.9: also `km-sheet-header`; `__title`, `__close` button,
  `aria-label` = `labels.close`) and the menu levels (`.km-menu.km-menu--sheet`). Never anchored
  (no `anchor()`), full width at the bottom, `max-height: 85dvh`, safe-area padding on the
  three free edges, rows ≥ `--base-touch-target-min` (44px). `inheritThemeFrom` is copied onto the
  backdrop, the sheet and every level. `cssClass` stays on the levels only.
- **Drill-in.** A submenu level is appended into the sheet and the other levels are `hidden`
  (only the deepest shows); its first row is a Back row (`.km-menu__item--back`, `role=menuitem`,
  `labels.back`) that goes up one level and refocuses the item that opened it (as ← / Escape do).
  The header shows the deepest level's name (`title`, else the opening item's text). Tap / click /
  Enter / → drill in; hover never does. Focus moves into the new level (its Back row, or its
  first item when the keyboard opened it).
- **Modal (decided 2026-11-23, audit Q2; rule C-CA-19).** The sheet and the drawer run through
  `startModalSession(sheet, { backdrop: <the menu's backdrop>, initialFocus: false, … })` (§12.19): the page
  behind is `inert` (the opener too), Tab stays inside — it swaps between the shown level (its first row) and
  the header's close button, never closes the menu (a `renderMenuCallback` sheet: the focus trap cycles its
  fields) — scroll lock and the Back entry come from the same session. Escape, whichever capture listener sees
  it first (the menu's keydown or the overlay router via `beforeEscapeCallback`), goes up one drilled-in level,
  else closes. The session joins `overlayGroup` when given, else the modal-only group. Opening it dismisses
  the page's default-group overlays except its opener chain (§12.19) — a sheet opened from a row in a dropdown
  keeps that dropdown.
- **Focus.** On open focus moves into the sheet (the root level, or its first item with
  `shouldFocusFirst`); on close the session returns it to `returnFocusTo`, else to what had it at
  open — also for a backdrop tap (the backdrop's `mousedown` is prevented so focus never leaves);
  not after `'blur'` / `'overlay'`.
- **Dismiss.** The backdrop closes on `click` (its `pointerdown` doesn't, so the tap can't click
  through to the page; wired by the modal session) — reason `'outside-click'`; the close button →
  `'close-button'`; Escape / blur / overlay / action as before (Tab no longer closes a sheet); no
  scroll close (page scroll is locked for the sheet's lifetime).
- **Phone Back.** While open the sheet holds ONE history entry (`pushState`, same URL — the
  core `claimBackEntry()`, §12.9; page-wide state): Back in a
  submenu goes up one level and re-arms the entry; at the root it closes with `'back'`. Closed any
  other way, the entry is given back with `history.back()` one task later (a sheet opened right
  after adopts it instead). While the entry is held the page's entry uses
  `history.scrollRestoration = 'manual'` (the page's own mode returns once its entry is current
  again): the entry is pushed while the body is pinned (window scroll 0), so the browser's own
  restore would jump the page to the top; the scroll lock restores the position itself.

**Decisions.** Item icons go through `renderIcon` (§12.33: markup raw, maps, built-ins, hooks, then the
component's `iconDefaults` option — its name → icon map); the floating menu, submenus and the phone sheet / drawer
render items the same way;
label and shortcut are text. Items are `div[role=menuitem][tabindex=-1]` (not buttons —
no native Space/Enter click to double-fire). The keyboard is a capture `keydown` on the
document while open, so the menu is keyboard-modal whether focus is in it or still on
the opener; handled keys are consumed. **The keyboard-initiated native `contextmenu` (decided 2026-11-23,
audit G21).** A component opens its menu from the keydown (Shift+F10 / the ContextMenu key); the browser then
raises its own `contextmenu` (Chromium: `button: -1`, on keydown for Shift+F10 — a prevented keydown suppresses
it — and on KEYUP for the ContextMenu key, which a prevented keydown does not; Firefox: `button: 0`; `pointerType`
is no signal — Chromium reports `'mouse'`). While open, the menu swallows it itself (a capture `contextmenu`
listener on the document, `preventDefault` + `stopPropagation`, removed on close; no option), so neither the
native menu nor the component's own `contextmenu` handler (a re-open) sees it. Keyboard-initiated = `button !== 2`
AND no `pointerdown` since the last key press: a real right-click (`button: 2`) or a touch long-press (pointerdown
first) passes through and opens the component's next menu as before. Components drop their own copies. Arrow keys / Home / End skip dividers and disabled
items (by design, review A-21: the MUI / Radix / React Aria default; the Keenmate components
all skip). Hover focuses items (roving focus follows the
pointer). Focus returns to `returnFocusTo` only when the menu held focus and the close
wasn't pointer-away (outside press / scroll / blur / overlay). An item that defines
its toggle state (`isToggled`, `getIsToggledCallback`, or an `isToggled` from
`defaults`) is a toggle: `role="menuitemcheckbox"` + `aria-checked="true|false"`
(+ the `--toggled` modifier when on); the rest are `role="menuitem"`. The keyboard
treats both alike (Enter / Space run; a toggle closes the menu unless
`shouldCloseOnClick: false`). The menu registers with `registerOverlay`
(one overlay open at a time). Styling: shared `km-menu` (`km-` is
reserved for shared UI rendered by core — not a component prefix), `__item` (`--danger`
`--toggled` `--disabled` `--has-submenu`), `__icon`, `__label`, `__shortcut`,
`__divider` (`--named`), `__loading`, `--submenu`, `--custom`, `--has-icons`, in
`@layer component`.

**Variable chain.** Every value reads three layers, highest precedence first:
`var(--_km-menu-X, var(--km-menu-X, var(--base-…, <default>)))`.

1. **Component variable** (one instance) — the component maps its own variable onto
   the *private* `--_km-menu-X` on its host, **with no fallback**
   (`:host { --_km-menu-bg: var(--wtv-context-menu-bg); }`). Unset component
   variable → the private one is guaranteed-invalid → the lookup falls through. The
   component variable must itself be unset by default (no `:host` default), or it
   would always win.
2. **`--km-menu-X`** (every menu on the page) — public, set by the page
   (`:root { --km-menu-bg: … }`). Components never set `--km-menu-*`: a host-level
   `--km-menu-bg: var(--wtv-context-menu-bg)` is guaranteed-invalid when the
   component variable is unset and shadows the page value.
3. **`--base-*`** theme tokens, then the literal default.

Sizes come from the base-css-variables scale too (decided 2026-11-13): radius
`--base-border-radius-sm` (sheet top corners `-lg`), font size `--base-font-size-sm` (sheet
`-base`), paddings / gaps `--base-space-*`, title weight `--base-font-weight-semibold`, each
unitless × `--base-rem` (fallback `10px`, as in every component). Stacking:
`calc(var(--base-z-tooltip, 9000) + 1)` — a menu is a short-lived chooser, so it stacks above whatever
opened it, a modal-tier sheet included (§12.18; was a bare `10000`). The sheet hides keyboard-shortcut hints (`__shortcut`); the keys still work.

```css
:root { --km-menu-bg: #fffbe6; }                 /* every menu on the page */
web-tree-view.files { --wtv-context-menu-bg: #eef; } /* just this tree's menu */
```

`--km-menu-hover-color` (item text on hover / focus / open submenu) defaults to
unchanged; it is applied at zero specificity, so danger / toggled items keep their
colour. The full list (name, usage, `--base-*` fallback, default) ships as
`component-variables.manifest.json` at the package root (export
`./component-variables.manifest.json`); a unit test keeps it in sync with the
stylesheet.


### 12.14 Loader (loading states) — IMPLEMENTED (`src/dom/render-loader.ts`, main index)

**The gap.** Every component drew its loading states its own way (treeview
`isLoading` overlay, grid infinite-scroll row, multiselect / cp async search, drp
summary, dropzone upload, editor pending indicator), so one page had several
spinners and no single place to change them. Shadow DOM lets only custom properties
in, so the look is a **token contract** (`--base-loader-icon` / `-rotate` /
`-duration` / `-size`, base-css-variables) for single-colour mask loaders, plus
**one render hook** for anything richer. No `<km-loader>` element.

**API.** `renderLoader(host, containerElement, context, { label, prefix,
renderLoadingCallback? }) → remove()`. Precedence, highest first:

1. the **instance `renderLoadingCallback`** — same name in every component. Taken
   from the option when the key is present (`null` = none), else from
   `host.renderLoadingCallback` (the generated `BlissElement` property);
2. the **page-wide `window.components.renderLoadingCallback`**;
3. the **default** `<span class="<prefix>__loader" aria-hidden="true">`, drawn by
   the component's CSS.

Both hooks are `RenderLoadingCallback = (ctx: LoaderRenderContext) => void | (() => void)`
with `ctx = { component (tag name), context, containerElement, element (host), label }`.
`context` names the loading state per component (`'overlay' | 'row' | 'search' |
'upload' | 'summary' | …`). The hook fills `containerElement`; an optional returned
function is its cleanup. The container always gets `role="status"` + `aria-label`
(`label` = the component's `labels.loading` / `labels.searching`; empty → no
`aria-label`). `remove()` (idempotent) runs the cleanup, removes the nodes the render
added (pre-existing children stay) and restores the container's previous `role` /
`aria-label`. A throwing hook is logged (`UI` / `CORE:ELEMENT`, §12.1) and the
default loader is drawn instead — a loading state is never blank.

**Page hook.** `window.components.renderLoadingCallback` is a **non-enumerable**
accessor (like `logging`, §12.3), published by `registerComponent()` and
`renderLoader()`; its value lives on `globalThis[Symbol.for(...)]` so every bundled
core copy shares it. A value the page assigned before any component loaded (a plain
property) is adopted at publish time; a non-function reads as unset.

```js
window.components.renderLoadingCallback = ({ component, context, containerElement }) => {
  containerElement.innerHTML = '<span class="my-dots"><i></i><i></i><i></i></span>';
};
```

**CSS (component-owned).** Core ships no loader CSS — the default element carries
the component prefix, so the component draws it (unlike the `km-menu`, which core
renders and styles, §12.13). Every component copies the same drawing rule, with its
`--<prefix>-loader-*` tokens chained to `--base-loader-*` (and listed in its
manifest):

```css
:host {
  --x-loader-icon: var(--base-loader-icon, url("data:image/svg+xml,…")); /* the contract's arc */
  --x-loader-rotate: var(--base-loader-rotate, 1turn);
  --x-loader-duration: var(--base-loader-duration, 0.8s);
  --x-loader-size: var(--base-loader-size, 1.25em);
}
.x__loader {
  display: inline-block;
  inline-size: var(--x-loader-size); block-size: var(--x-loader-size);
  mask: var(--x-loader-icon) center / contain no-repeat;
  background: currentColor;
  animation: x-loader-spin var(--x-loader-duration) linear infinite;
}
@keyframes x-loader-spin { to { transform: rotate(var(--x-loader-rotate)); } }
```

The class is BEM (`<prefix>__loader`, an element of the component block); the tokens and the
keyframes keep the hyphenated `<prefix>-loader-*` names (custom properties, not classes).
The four lines + keyframes are base-css-variables' drawing contract verbatim (its
README → Loader); `display: inline-block` is only needed where the element is
otherwise inline. The icon fallback is the contract's default data URI, so the
loader draws without the contract loaded. `--x-loader-rotate: 0` = the SVG animates itself (it keeps its own speed under
reduced motion — only rotating shapes slow, via `--base-loader-duration` 1.5s; the
loader never stops). Mask data URIs fall under CSP `img-src`. Multi-colour loaders
go through the render hook.

### 12.15 Container scroll — IMPLEMENTED (`src/dom/scroll-container.ts`, main index)

**The gap.** Components bring an inner element into view (a tree row, a list option, a
calendar day). `Element.scrollIntoView()` scrolls *every* scrollable ancestor, the page
included, so a search jump or a keyboard move made the whole page jump. web-multiselect
(`revealFocusedOnOpen`), svelte-treeview (`findScrollableAncestor`) and web-treeview each
hand-rolled the same workaround; web-daterangepicker still calls `scrollIntoView` for day moves.

**API** (zero deps, SSR-safe — no `document` → `null`, nothing happens):

```ts
findScrollContainer(el, { stopAt?, axis?: 'y' | 'x' | 'both' }): HTMLElement | null
scrollIntoContainer(el, { block?, inline?, behavior?, container?, shouldRevealContainer?, stopAt?, axis? }): HTMLElement | null
// A target that isn't rendered (a virtual-list row by index): content coordinates, same block rules,
// the container's scroll-padding (+ insetTop for a sticky header measured in JS), clamped. `behavior:
// 'auto'` sets scrollTop synchronously (the list renders the new window right after). null = no move.
getScrollTopForBox(container, { top, height }, { block?, insetTop? }): number | null
scrollContainerToBox(container, { top, height }, { block?, behavior?, insetTop? }): number | null
```

- **Find.** Walks the *flat* tree from `el`'s parent: a slotted node → its `assignedSlot`,
  else the parent element, else the shadow host (so a light-DOM wrapper around a custom element,
  and a shadow scroller around a `<slot>`, are both found). A scroller = computed overflow on
  `axis` (default `'y'`; `'both'` = either) is `auto | scroll | overlay` AND the content is larger
  than the client box. `overflow: hidden` never counts. Never returns `<html>`, `<body>` or
  `document.scrollingElement`; `stopAt` ends the walk (exclusive). `null` = only the page scrolls.
- **Scroll.** One container — `container` or the found one — never the page. View = the
  container's client box (inside borders, scrollbar excluded) minus its computed
  `scroll-padding`; target = `el`'s box plus its `scroll-margin` (sticky headers are CSS, as with
  native scrolling). Per axis: `start` / `end` / `center` align; `nearest` (default, both axes)
  follows the CSSOM rule (inside → no move; larger than the view and covering it → no move; else
  the closer edge aligns). `inline` is logical — in an RTL container `start` is the right edge.
  Delta-based (`scrollTop + delta`); the browser clamps. Under 1px on both axes → **no
  `scrollTo()` call** (a redundant call can disturb a running smooth scroll). `behavior`
  default `'auto'` — the caller decides (reduced motion, its `--*-scroll-behavior` token).
- **No container** → the page is the only scroller, so it gets the same request:
  `el.scrollIntoView({ block, inline, behavior })` (a `center` jump — search hit, `scrollToPath` —
  centres the row in the window, exactly as it would in a panel; `nearest` keyboard moves still
  nudge the page only when `el` is off-screen) and returns `null`. Otherwise returns the container.
- **Documents.** Measured against `el`'s own document / window (`ownerDocument.defaultView`), so
  an element inside an iframe finds and scrolls the iframe's scroller; that document's
  `<html>` / `<body>` are the "page".
- **`shouldRevealContainer: true`** → first, if the container isn't fully inside the viewport,
  `container.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior })` — a jump to a
  search hit in a tree further down the page. Default `false` (keyboard moves happen in a
  focused, visible container).

**Limits:** a CSS-scaled container (`transform: scale`, a zoomed preview) scrolls by the
unscaled amount; vertical writing modes aren't handled (`block` is always vertical); only the
innermost scroller moves — one clipped inside an outer scroller stays out of sight unless
`shouldRevealContainer` (whose `scrollIntoView` scrolls every ancestor).

**Not this module's job:** virtual lists (the component scrolls by index), focus (callers use
`focus({ preventScroll: true })`), deciding *whether* to scroll — a component's
`beforeScrollCallback` (component vocabulary in its ctx) runs through `runBeforeCallback`
(§12.12) and passes the container it found.

**Non-core copies** (svelte-treeview has no core dependency) must follow this exact algorithm,
including the no-call-when-nothing-moves rule and scroll-padding / scroll-margin.

### 12.16 Motion level — IMPLEMENTED (`src/environment/motion.ts`, main index)

**The gap.** Components animate through the shared speed tokens (`--<prefix>-transition-normal:
var(--base-duration-normal, 0.15s)`, `--<prefix>-scroll-behavior: var(--base-scroll-behavior,
smooth)`), and base-css-variables zeroes those under `prefers-reduced-motion`. On a page without
base-css-variables nothing did — web-multiselect kept its own reduced-motion block for exactly that
reason — and there was no single switch for "no animations here" or "snappier, please".

**API.**

- **`motion`** on every `BlissElement` (core-declared, like `theme-source`): `'auto'` (default) |
  `'none'` | `'snappy'` | `'smooth'`; attribute `motion`, property `el.motion`, reflects, accepted by
  `setProperties()`. Invalid → warn, keep the previous level (the attribute is written back).
- **`window.components.motion`** — the page level (non-enumerable accessor on `globalThis` state,
  shared by every bundled core copy; a value assigned earlier as a plain property is adopted;
  invalid → `auto`). Core writes it **once, on `<html data-motion>`** — the outermost layer — never
  on the hosts (rc19, review V-10: it used to go on every `auto` host and beat closer sections). An
  author-written `<html data-motion>` is the same layer: the page level replaces it while set,
  `auto` restores it. The writer subscribes through the shared listener set, so it runs whichever
  copy of core owns the setter. Exports: `getPageMotion()`, `observePageMotion(listener)`.
- **`data-motion`** — core writes the element's OWN level (not `auto`) to the host; `auto` removes
  it (only one core wrote — an author-written `data-motion` is left alone). An `auto` element gets
  nothing: its tokens inherit. The same attribute on any element (`<html>`, a `<section>`) sets
  the level for everything inside.

**Mechanism.** `MOTION_CSS` is adopted (`adoptStyles`) into every root a `BlissElement` connects
in — the document, or the shadow root of the component that renders it — so `[data-motion]`
matches the host itself and any page element, with or without base-css-variables:

| Level | `--base-duration-fast / -normal / -medium / -slow` | `--base-scroll-behavior` |
|---|---|---|
| `none` | `0s` ×4 | `auto` |
| `snappy` | `0.05s / 0.08s / 0.12s / 0.15s` | `smooth` |
| `smooth` | `0.15s / 0.25s / 0.35s / 0.45s` | `smooth` |
| `auto` | not set — inherited (section / page / base-css-variables) or the component's fallback | |

`@media (prefers-reduced-motion: reduce)` comes last and zeroes the durations (+ `scroll-behavior:
auto`) on `:root`, `:host` and every `[data-motion]` element: **the OS setting always wins**, even
over `motion="smooth"` — it's the user's accessibility choice. Precedence — **closest wins**, by
plain CSS inheritance: OS reduce > the element's own level (on the host) > the nearest
`[data-motion]` ancestor (a section) > the page level (`<html data-motion>`, from
`window.components.motion` or the author) > base-css-variables' `:root` values > the component's
fallbacks. Demo: `examples-motion.html` MO02.

Every level sets the scroll behaviour too, so a level nested inside another (`smooth` inside a
`none` section) follows the nearest one for scrolling as well as speed. A page's own
`:root { --base-duration-*: … }` has the same specificity as `html[data-motion]` in
base-css-variables, so a later page stylesheet can win there; core's adopted copy comes after the
page's styles, so on pages with components the level holds.

**What `motion` switches off, and what it never touches (decided 2026-11-15).** Components DO animate
by default; `motion` decides how fast, and `none` (or OS reduced motion) makes these animations instant.
Two groups, nothing in between:

| Group | Examples | Default (`auto`) | `motion="none"` / OS reduced motion |
|---|---|---|---|
| **Decorative animations** — they show a change happening | appear / disappear (a panel, a sheet, a toast), **expand / collapse** (a tree node's rows, an accordion), a size change, a highlight fade, smooth scrolling, the visual OF a timer (a countdown bar) | **animate**, timed by the motion tokens | **instant** (a countdown bar is hidden) |
| **Not animations — `motion` never changes them** | **timers**: a delay before something happens (feedback time, debounce, tooltip delay, auto-close); **activity indicators**: a loader | run as configured | timers keep their time; a loader keeps moving (slower under OS reduced motion — it is the only sign something runs) |

So a tree's expand / collapse animates, and `motion="none"` turns it off; a tooltip's 500ms delay stays
500ms at every level. Decorative animations are timed ONLY by `--<prefix>-transition-*` →
`--base-duration-*`.

**One switch, no per-feature properties.** `motion` is the only "animate or not" setting — no
`isRowAnimationEnabled` / `isContextMenuAnimationEnabled`, no animations object (rulebook
naming-conventions "Motion is CSS, never an attribute", C-NC-15). Fine-tuning ONE animation is its CSS
duration token, `--<prefix>-<what>-animation-duration` (`--km-menu-sheet-duration`,
`--wtv-row-animation-duration`): `0s` turns it off, at any level the cascade reaches (page `:root`, a
section, one instance). Its default points at a speed token (`var(--<prefix>-transition-normal)`),
never a literal time, so `motion` and reduced motion still win over it; a page author who writes a
literal opts that animation out on purpose. JS-driven animations need nothing extra:
`animateOut` reads the computed duration, so `0s` is instant there too.

**Enter / exit animations (`animateOut`, `src/dom/animate-out.ts`, main index, decided 2026-11-14).**
An element that appears animates with a CSS `@keyframes` that plays on insertion — no JS. One that
disappears gets a closing class whose `forwards` keyframe uses the `-in` easing, and the caller
removes / collapses it only after: `animateOut(elements, { className /* string, or (el) => string per element */, doneCallback, shouldSetInert = true,
shouldSetHeightVar = false })` → `{ cancel(), finished: Promise<boolean> }`. It reads the duration back
from CSS (`readAnimationMs(el)`: the longest `delay + duration` over the animation list, `0` for none
or `0s`), so the motion level, the component's own knob and reduced motion need no code: at `0` it
calls `doneCallback` synchronously. Otherwise it waits for each animating element's OWN `animationend` (a
child's bubbling one doesn't count), with a duration + 50ms timer for a tab that never fires it.
`shouldSetHeightVar` writes each element's height to `--km-exit-height` first (all measured, then
all written), because a keyframe can't shrink from `height: auto` — so rows shrink in the flow and
what follows slides up. `cancel()` takes the class, `inert` and the variable off and skips `doneCallback`;
after `doneCallback` the class stays (the caller removes or resets the element), `inert` and the variable
are put back. Used by `/menu`'s sheet close; components (row expand / collapse) use it instead of
their own waits — rulebook C-CA-18. CSS transitions remain right for an element that STAYS in the
DOM (a dropdown, a tooltip toggling a class).

JS that has to follow the resolved level reads it at the element (`src/dom/css-values.ts`, main index):
`isMotionOff(el)` (`--base-duration-normal` is `0s`), `readScrollBehavior(el, prop?)`, `readCssDurationMs(el, prop,
fallback)` (a speed token for WAAPI) and `readCssLengthPx(el, prop, fallback)` (a hidden probe resolves the length
where it applies; inside a `display: none` subtree its computed width). Components never probe `getComputedStyle` for these themselves.

base-css-variables carries the same `[data-motion]` presets (the reference for the values; a core
unit test compares them when the repo sits next to core).

**Component contract.** Animate only through the `--base-duration-*` speeds (via the component's
own `--<prefix>-transition-*` tokens) and scroll via `--<prefix>-scroll-behavior`; a hard-coded
`transition: 0.2s` ignores the level. No per-component reduced-motion code is required any more
(a component's own block stays harmless).

### 12.17 Persisted UI state — IMPLEMENTED (`src/dom/state-store.ts`, main index)

**The gap.** Components that keep what the user arranged did it four ways: web-dropzone (popover size:
`storage-key`, `loadStateCallback` / `persistStateCallback`, `localStorage['dz-state:<key>']`), web-grid
(column widths / order: plain properties `gridName` + `shouldPersistColumn*`, `localStorage['wg-<name>-state']`,
no host store), web-commandpalette (favorites / recents: `usage-key`, `loadUsageCallback` /
`saveUsageCallback`, its own localStorage code). Different names, key formats and callback shapes.

**The rule (one way, rulebook C-CA-17).** A component that persists UI state has the input rows:

| configKey | attribute | converter | |
|---|---|---|---|
| `storageKey` | `storage-key` | `toText({ isNullable: true })` | the key; unset / empty = persistence off |
| `loadStateCallback` | — | `toFunction()` | `(ctx & { key }) => S \| null \| Promise<…>`; set → the host keeps the state |
| `saveStateCallback` | — | `toFunction()` | `(ctx & { key, state: S })`, the WHOLE state each time |

and one handle: `createStateStore(host, { getConfig, toContext })` → `{ load(), save(partial), clear() }`;
`getConfig()` returns `{ storageKey, loadStateCallback, saveStateCallback }` (the row names, so a BlissElement passes
`() => this.config`) and is read on every call. Default store `localStorage['km-state:<tag>:<storage-key>']`; the cache is per key and store (setting / removing a callback later
reads from the new store); EITHER callback set → the host keeps the state and
localStorage is never used (a missing half is a no-op, warned once — set both);
`save()` merges the partial into the whole state; the key is read per call (a new key loads its own
state); nothing throws (a failing callback / unavailable storage is logged via the element's logger and
the component keeps working from memory). Each component documents its state shape `S`. No
`localStorage` / `sessionStorage` in a component outside the store.

A component whose persistence IS the feature (web-commandpalette's favorites / recents) may give
`storageKey` a default and keep its own on/off switch (`usage-storage="none"`). It has the three rows like
every other one (its state: `{ entries }`); its per-entry data API (`loadUsageCallback` /
`saveUsageCallback`, one changed entry per call) stays as a data feature and wins when set.

Not UI state: data the page owns (web-treeview's `expandedPaths` / `selectedPaths` / `checkedPaths`
+ their change events) — the page saves those itself.

### 12.18 Stacking tiers — IMPLEMENTED (`src/dom/z-index.ts`, main index)

**The gap.** base-css-variables has had the `--base-z-*` scale for a long time, but there was no tier for a
phone full-screen sheet, so each component picked a number: web-multiselect and web-treeview tooltip + 1,
web-daterangepicker 9500–10002, web-dropzone 9999 / 100000, web-grid 999 / 1000, web-commandpalette
popover + 1, web-editor 1000 / 1100. A picker opened inside another component's sheet could land under it.

**The rule (decided 2026-11-16).** `Z_INDEX` maps each tier onto its token with ONE fallback:

| Tier | Token (fallback) | For |
|---|---|---|
| `modalBackdrop` | `--base-z-modal-backdrop` (6000) | the dimmed layer under a dialog / sheet |
| `modal` | `--base-z-modal` (7000) | dialogs, phone full-screen sheets, drawers — anything that takes over the screen |
| `dropdown` | `--base-z-dropdown` (7500) | a field's dropdown panel |
| `popover` | `--base-z-popover` (7600) | other floating panels |
| `toast` | `--base-z-toast` (8000) | notifications (visible over a dialog) |
| `tooltip` | `--base-z-tooltip` (9000) | hover / focus hints, the top |

A sheet is the MODAL tier, not "above everything": whatever opens from inside it is a higher tier and
stacks above with no special case; page tooltips can't show through (the sheet covers what triggers
them). A component's own sub-layer is `calc(<tier> + 1)`, never a bare number. Components keep their own
`--<prefix>-z-index-*` variables, defaulting to a tier. `/menu` stays at `calc(tooltip + 1)` (a chooser
above whatever opened it).

### 12.19 Modal session + dialogs — IMPLEMENTED (`src/dom/focus-trap.ts`, `src/overlay/modal-session.ts`, subpath `/dialog`)

**The gap.** Every modal wrote its own plumbing: web-daterangepicker's centered modal (backdrop, scroll lock,
Back, focus return by hand), web-commandpalette (its own Tab trap), web-grid (its own dialog), and
web-editor used `window.prompt` / `window.confirm` (unstyled, untranslatable). No focus trap anywhere kept
Tab or a screen reader out of the page behind.

**Decided 2026-11-16: two layers.**

1. **`startModalSession(panel, opts)`** (main index) — for a component's OWN modal markup. `backdrop:
   boolean | HTMLElement` (`true` = core inserts `.km-modal-backdrop` before the panel at `Z_INDEX.modalBackdrop`,
   removed on end; an element = the component's, only its click is wired; omitted = none). Core never closes
   anything: `dismissCallback(reason)` (`'escape' | 'back' | 'backdrop' | 'overlay' | 'parent'`) → the component
   closes and calls `end()`. Pieces: `createFocusTrap` (below), `role="dialog"` unless set + `aria-modal`,
   `startSheetSession` (scroll lock, Back; keyboard inset OFF by default — it sizes the panel to the visual
   viewport, right only for a full-screen sheet), `registerOverlay` in a modal-only group (a page dropdown
   opening never dismisses a modal; a dropdown opened inside is its child and closes first on Escape).
   **Page overlays close at open (decided 2026-11-23, audit Q3):** the session's activation also dismisses the
   default (ungrouped) group — the page's open dropdowns / popovers / menus — through `activate({ dismissGroups:
   [undefined] })`, with the same exclusions as any activation: the modal's ancestor chain (the overlay its
   `trigger` sits in — a menu sheet opened from a dropdown row keeps that dropdown; a dialog opened from a modal
   sheet keeps the sheet and the sheet's dropdown it came from) and anything opened after the session started
   (a dropdown inside the panel is the modal's child). Named groups are untouched (`dismissAllOverlays()` still
   crosses them); `shouldDismissPageOverlays: false` opts out. Replaces web-commandpalette's own
   `dismissAllOverlays()` call before opening.
   Its non-modal sibling **`startPanelSession(panel, { dismissCallback, shouldCloseOnEscape, shouldCloseOnOutsideClick,
   shouldCloseOnBack, trigger, returnFocusTo, initialFocus, isOpenedByPointer })`** (decided 2026-11-17, from
   web-dropzone's upload drawer) is a panel the page stays usable around: Escape (overlay tree), a click outside
   and Back → `dismissCallback('escape' | 'outside-click' | 'back' | 'overlay' | 'parent')`; `role="dialog"` without
   `aria-modal`; no backdrop, no inert, no trap, no scroll lock; focus stays unless `initialFocus`; `end()` returns
   focus only with `shouldReturnFocus: true`. Own overlay group (a page dropdown doesn't dismiss it; a second
   panel does, unless opened from inside it). A separate function, not a `startModalSession` flag.
   Core's own `/menu` phone sheet / drawer runs through `startModalSession` too (§12.13, decided 2026-11-23).
2. **`/dialog`** — `openDialog({ title, message, content, actions, isDismissible, beforeCloseCallback, labels,
   container, trigger })` → `{ result: Promise<string | null>, close, panel, body }`, `confirmDialog()` →
   `Promise<boolean>`, `promptDialog({ value, label, validate, inputType })` → `Promise<string | null>`. Own layer
   (`div.km-dialog-layer` + shadow root, `DIALOG_CSS` + `SHEET_CHROME_CSS` + motion) on `<body>`; `message` is
   text, `content` a node; a bottom sheet under 480px.

**`createFocusTrap(panel, { initialFocus, returnFocusTo, shouldMakeBackgroundInert, keepInteractive })`** (subpath `/a11y`, with
`getTabbables(container)`): like
`showModal()` without the top layer — every sibling along the panel's path up to `<body>` (across shadow roots)
gets `inert` (only what it set is removed again; overlays mounted later stay live), Tab / Shift+Tab wrap at
the edges (tabbables on the flat tree), focus goes in and comes back when it was still inside (or lost to
`<body>`). Why not native `<dialog>`: the top layer sits above every z-index, so a component's portaled
dropdown / tooltip would have to mount inside the dialog (`findOverlayContainer` handles that for the
consumer's own `<dialog>`, §12.2); the tiers (§12.18) keep nesting simple.

**Ghost click (decided 2026-11-17, opt-in).** A tap fires `pointerdown` → `mousedown` → `click` at one spot; a
component that opens its modal on the PRESS (web-daterangepicker on `pointerdown`, web-multiselect's full-screen
sheet on `mousedown` — both to keep the soft keyboard down) has the panel up when the tap's own `click` lands on
it (picks a day / an option, or the backdrop dismisses). `startModalSession({ isOpenedByPointer: true })` arms
`guardGhostClick([panel, backdrop])` (main index): the next click is swallowed when its composed path hits a
guarded element, then the guard removes itself (700 ms safety net; `trailingFocus` blurs an input the press
focuses — inside a session the inert background already blocks that). Modals opened on `click` / keyboard
don't pass it. web-daterangepicker's `armGhostClickGuard` + `blurTrailingFocus` were the original.

### 12.20 Direction + ids — IMPLEMENTED (`src/dom/direction.ts`, `src/dom/create-id.ts`, main index)

**`isRtl(el)`** — the effective CSS `direction` (a `dir` anywhere up the composed tree, `dir="auto"`, a CSS
`direction` rule); detached / no layout engine → the nearest `dir` attribute across shadow roots.
`BlissElement.isRtl` and `/menu` (which read only the `[dir]` attribute before) use it. Components had three
answers: the host's computed style (web-multiselect, web-daterangepicker), the host's own `dir` only
(web-dropzone), `document.dir` only (web-grid's toolbar).

**`createId(prefix = 'km')`** — `<prefix>-<counter><random>`, a valid id and CSS identifier, unique per page
even with two bundled copies of core. For ARIA references (`aria-labelledby`, `aria-controls`,
`aria-activedescendant`), `<label for>`, log instance tags, new tree keys. Replaces web-multiselect's
`Math.random()` instance id, web-treeview's and web-dropzone's `Date.now()` + random keys.

### 12.21 Form inputs — IMPLEMENTED (`src/dom/form-inputs.ts`, main index)

The submission convention (light-DOM hidden inputs, never `setFormValue`) had three copies: web-multiselect
(rebuild all, `json` default, `name[]` for `array`), web-daterangepicker (same, `text` default) and web-editor
(one reused input). Decided 2026-11-17:

- **`createFormInputs(host)`** → `{ write(name, value, { isDisabled }), clear(), inputs }`. A string = one
  `<input type="hidden" name>`, an array = one `name[]` input per item (none for `[]`); inputs reused, re-appended
  when a framework dropped them, never an `id` (duplicate ids — web-multiselect 3.0.0-rc04 dropped its `id = name`);
  `disabled` while the control is; `null` name removes them.
- **`formatFormValue(values, format, { separator, callback })`** → `{ value, error? }`: `json` (default) /
  `text` (joined, `','`) / `array`; the component's `getValueFormatCallback` (bound to its context) wins, also
  over `array`; a throw yields `''` + `error`. The component keeps `setFormatError` + `value-format-error`.
  Domain formats (web-daterangepicker's date masks / ranges) keep their own serializer and use
  `createFormInputs` only.

### 12.22 Async runner — IMPLEMENTED (`src/dom/async-runner.ts`, main index)

Five copies of "latest request wins" (web-multiselect search, web-commandpalette palette + usage, web-grid
dropdown, web-editor pipelines), each with a different subset. Decided 2026-11-17:
**`createAsyncRunner({ concurrency = 'latest', debounceMs, loaderDelayMs = 0, loadingChangeCallback, errorCallback, logSource })`** →
`{ run(task, onResult): boolean, cancel(), isLoading, isPending }`.

- `run(task: (signal) => T | PromiseLike<T>, onResult)` replaces the previous run: its debounce is dropped, its
  signal aborts, a late answer is ignored (generation check) — only the latest run reaches `onResult`.
- `concurrency: 'exclusive'` (audit Q9, 2026-11-23 — web-daterangepicker's month navigation `isMonthChanging`
  gate): while a task is RUNNING (from its start until it settles or `cancel()`) a new `run()` is REFUSED —
  returns `false`, nothing is queued, the running task is untouched. A debounce wait is not running: inside it
  the newest call still replaces the pending one (so the debounce keeps its "last call of a burst" meaning). A
  `run()` from `onResult` is allowed (the task has settled). `run()` returns `true` (started / scheduled) in both
  modes otherwise.
- A synchronous result is delivered at once (after the debounce) with no loader. An async one turns the
  loader on — after `loaderDelayMs` when set (web-editor's 200 ms `PendingGate`), at once otherwise
  (web-multiselect) — and a run replacing a loading one keeps it on (no flicker). Loader off before `onResult`.
- `AbortError` (by `name`) is never an error; other failures → `errorCallback`, else the logger. Throwing callbacks
  are logged (`runSafely`), the runner keeps working. `cancel()` on close / `disconnect()`.
- Not in core: web-editor's "pause while a dialog is open", web-multiselect's term check (the generation covers
  it).

### 12.23 Announcements — IMPLEMENTED (`src/dom/announce.ts`, main index)

Screen readers missed what changed without focus moving: web-daterangepicker's message area had no ARIA,
web-multiselect announced through its visible toast, web-commandpalette had its own live region. Decided
2026-11-17: **`announce(text, { politeness = 'polite', document })`** — one visually hidden region per
document and politeness (`[data-km-announcer="polite"]` `role="status"`, `"assertive"` `aria-live` only),
created on first use at the end of `<body>`, shared by every component and core copy; cleared then written
50 ms later (the same text is read again; a newer call replaces one not yet written). `createFocusTrap` never
makes a region inert. Visible toasts stay per component (web-multiselect anchors its toast to the field).

### 12.24 Locale + labels — IMPLEMENTED (`src/locale/`, subpath `/locale`)

Every component had its own label resolution (web-treeview `resolveLabel`, web-daterangepicker `resolveLabels` +
`formatLabel` + `resolveLocale` + a week-start table, web-commandpalette / web-editor their own `{name}`
formatter) and none had a page-wide layer; a German browser with a US user needed a per-instance `locale` on
every element. Decided 2026-10-26 / 10-27 / 10-28 (rulebook D-NC-24), built 2026-11-17:

- **Page-wide** `window.components.locale = { locale, dateFormat, timeFormat, weekStartDay, decimalSeparator,
  thousandsSeparator, labels: { '<component>.<elementType>.<name>': '…' }, translateCallback }` and `window.components.security =
  { shouldEscapeLabels }` — non-enumerable accessors (installed by the internal `publishLocaleHooks()`, from `registerComponent()` and
  every read), state in `sharedState('locale')`. Assigning REPLACES the object; it is stored as a frozen copy
  (nested mutation throws instead of being silently missed). A non-object warns and is ignored.
- **Settings** (`resolveLocaleSettings(instance)`): per key instance → page → derived from `Intl` for the resolved
  locale — `getDateFormat` (`YYYY` / `MM` / `DD` tokens from `formatToParts`), `getTimeFormat` (`hourCycle`),
  `getWeekStartDay` (`Intl.Locale` `getWeekInfo()` / `weekInfo`, then a region table), `getNumberSeparators`.
  The page-wide keys are the USER's preference, so they apply also to an element with its own `locale`.
  `resolveLocale(instance)`: instance (`'auto'` / empty = unset) → page → `navigator.language` → `en-US`; an
  invalid tag warns and falls through. `getMonthNames` / `getWeekdayNames` from `Intl`. No language tables.
- **Numbers:** `formatNumber(value, opts)` (`Intl.NumberFormat`, then the resolved separators swapped in) and
  `parseNumber(text, options, source?)` (decimal separator → `.`, U+2212 minus; a group separator — the locale's,
  or any space — only in a real group position: first 1–3 digits, then 2–3, the last group exactly 3, so `'1.5'` in
  `de` is `null`, never 15; not a number → `null`). `parseNumberCallback` overrides it: the element's own
  (`options.parseNumberCallback`), then `window.components.locale.parseNumberCallback`; `ctx = { text, locale,
  decimalSeparator, thousandsSeparator, parseDefault() }` → a number, `null` = not a number, `undefined` = next rule
  (a throw is logged, next rule).
- **Text compare:** `getCollator(locale?, options?, source?)` → a cached `Intl.Collator` for `resolveLocale(locale)`
  (the same instance per resolved locale + options, option order irrelevant); never throws — an invalid tag warns and
  falls through like `resolveLocale`, options `Intl` rejects warn and are dropped. Every component text sort uses it
  (`getCollator(this.config.locale, { numeric: true }).compare`), never a bare `localeCompare()` (browser locale).
- **Labels:** `createLabels(host, DEFAULT_LABELS, () => this.config.labels, { tag, getLocale })` → `{ template,
  text, html, all }`. A user callback's context gets `ctx.labels = createLabelsView(labels)` → frozen `{ text, html }`
  only (the paths that run the translate callbacks; `template` / `all` skip them) — never a plain labels object. Keys are flat `<elementType>.<name>` — element types `buttons`, `tooltips`, `ariaLabels`,
  `placeholders`, `headers`, `labels`, `messages`, `errors`, `menuItems`, `columnHeaders` (one text per surface: a
  button's caption, its tooltip and its screen-reader name are three keys sharing `<name>`); the FULL key is
  `<tag>.<key>` with `tag` = the component's own name (not the element's tag — a custom tag still reads the app's
  `web-grid.*`). Per key: the instance `labels` (short or full key) → the page-wide flat dictionary
  `locale.labels['<tag>.<key>']` (the app's whole translation JSON can be assigned; other keys ignored; a nested
  per-tag object warns) → English (a string wins, `''` included). A key the instance did NOT set goes to
  `translateCallback({ component, key: '<tag>.<key>', template, params, locale })` first — the app's own i18n;
  `null` / `undefined` = not mine; a throw → logged; then the default `{name}` replacement. The element's own
  `translateCallback` (`getTranslateCallback` option, else `host.translateCallback` — the component's input row) is
  asked first, the same way; its `null` passes to the page-wide one. **Per-call default:** `text(key, params, {
  fallback })` / `html(key, params, { fallback })` use `fallback` exactly where (and instead of) the built-in
  `DEFAULT_LABELS` entry — the callbacks get it as `template`, placeholders and `html()` escaping apply as to a
  built-in default; a key with neither shows the key itself. For derived keys with no built-in entry (web-editor's
  command / group texts) — never mutate `defaults` around a call. Decided 2026-11-23 (Q11). **One text, one key:**
  a visible text names its element (a text button has no `aria-label`; an input points at its caption with
  `aria-labelledby`), so no twin key exists to drift. Where twins remain (an icon button's tooltip + screen-reader
  name), an `ariaLabels.x` / `tooltips.x` NOBODY set (still the built-in English) takes the first CUSTOMIZED sibling
  with the same `<name>` — `ariaLabels.x` ← `buttons` / `labels` / `headers` / `messages` / `menuItems` / `tooltips`,
  `tooltips.x` ← `buttons` / `labels` / `menuItems` / `ariaLabels` (`getLabelFallbackKeys`; customized = instance, page
  dictionary or `translateCallback`; only siblings the component defines): a page that translates only the visible
  caption doesn't leave the spoken name in English (WCAG 2.5.3). A key that is set always wins. Decided 2026-11-19
  (the documenthub admin's `<scope>.<elementType>.<key>`; keen-pure-admin's `translate` callback; nested groups,
  per-tag objects and `formatLabelCallback` dropped). `text()` is for `textContent` / attributes — never escaped. `html()` is for `innerHTML`:
  `shouldEscapeLabels` off (default) → string param values escaped before formatting, the template stays HTML;
  on → the finished label escaped once. Plural pairs (`day` / `days`) stay component keys. A NUMBER param is
  displayed through `formatNumber` (resolved locale + separators — components pass raw numbers, never pre-formatted
  strings), while `translateCallback` receives the raw number (ICU / i18next plural rules need it); a string param
  (a year, an id) is shown as given. Decided 2026-11-17 (web-commandpalette's pass: pre-formatted counts reached the
  callback as `"12 345"`).
  **Placeholders read dotted paths (2026-11-22):** `{ctx.remaining}` / `{ctx.item.text}` — own properties at every
  step, a missing step leaves the placeholder as written. A component passes the text spot's callback context as
  `{ ctx }`, so a label template and the spot's `get*Callback(ctx)` share one context (rulebook D-NC-24 amendment:
  callback → label chain → English; `ctx.count` = the number the text's noun agrees with, so one generic
  `translateCallback` pluralizes every key). Numbers are locale-formatted and (in `html()`) strings escaped at
  ANY depth of plain objects / arrays — the translate callback gets that same deep-escaped copy, numbers raw.
  Flat `{name}` params keep working. Core stays a formatter: no plural / select syntax (the app's library does it).
- **Live:** `observePageLocale(listener)` hears page-locale / security assignments and the browser `languagechange`;
  BlissElement's opt-in `localeChanged()` hook (override = subscribed while connected) re-renders texts. Not
  called on the first connect (`reinit()` read the locale); a change while detached fires on reconnect (a
  revision counter).
- Not core-declared: a component's `locale` input — every component declares its own row (rulebook C-CA-38;
  exempt: a satellite bound to a main element, e.g. the web-dropzone satellites, takes the main element's locale).
- Not in core: language packs (`/locales/cs` later, if ever), a byte formatter (web-dropzone's stays until a second copy).

### 12.25 Keyboard navigation — IMPLEMENTED (`src/a11y/`, subpath `/a11y`)

The audit (2026-11-16, B8) found every list / tree / grid with its own keys and half of them without ARIA:
web-multiselect moved a highlight with no `aria-activedescendant`, web-commandpalette had its own, the
web-daterangepicker day grid and web-treeview moved real focus their own way, web-editor's toolbar had no arrows.
Decided 2026-11-17 — two patterns, roles stay per component:

- **`createActiveDescendant(input, listbox, { getItems, activateCallback, activeChangeCallback, isWrapping, isSkipped,
  hasHomeEnd, pageSize, shouldScroll, shouldHandleKeys })`** → `{ active, activeIndex, setActive, move, refresh,
  destroy }`. `shouldHandleKeys: false` = ARIA only (a component with its own key handling and
  `before*Callback`s drives `move()` / `setActive()`; core installs no keydown listener). Focus
  stays in the input; ArrowUp / Down (PageUp / Down by `pageSize`, Home / End only with `hasHomeEnd` — they are
  the caret's otherwise) move over the items, skipping `aria-disabled="true"`; nothing active + ArrowUp starts at
  the last. Core sets `aria-activedescendant`, ids (`createId`), `aria-controls`, `tabindex="-1"` on the listbox
  (Chromium makes a scroller a tab stop), and scrolls the item into the listbox (or its nearest scroller —
  never the page). Enter → `activateCallback(item, index, event)`. `refresh()` after a re-render keeps the active item
  by element or id, else clears. Composing / modified keys pass through. Input + listbox in the same root (warns
  otherwise — an id reference doesn't cross a shadow boundary).
- **`createRovingFocus(container, { getItems, orientation, columns, isWrapping, hasTypeahead, getItemText,
  isSkipped, focusItemCallback })`** → `{ current, currentIndex, focusItem, refresh, destroy }`. One tab stop
  (`tabindex` 0 / -1); `vertical` / `horizontal` / `grid` (`columns`, number or function); Left / Right follow
  `isRtl(container)`; Home / End (row in a grid), Ctrl+Home / End; grid columns never wrap; a click / focus on an
  item makes it the stop. Disabled items stay focusable unless `isSkipped` says otherwise (APG).
- **`createTypeahead(timeoutMs = 500)`**: printable keys within the timeout form one prefix; a repeated letter
  cycles; used by roving focus, exported for list widgets that keep their own focus model.
- Not in core: roles, `aria-selected` / `aria-checked`, the highlight class, tree expand / collapse keys
  (ArrowRight / Left on a parent), the date grid's PageUp / Down month jumps — the component handles those
  keys before (the helpers skip a `defaultPrevented` event). `/menu` keeps its level-based model (all items
  `-1`, submenus / drill-in back rows).
- The subpath also exports the focus trap `createFocusTrap` / `getTabbables` (§12.19; code in `src/dom/`, since the
  main index's `startModalSession` uses it). Entry-point layout: see the §12 intro.

### 12.26 Virtual window — IMPLEMENTED (`src/dom/virtual-window.ts`, main index)

Three virtual lists with three copies of the same math: web-multiselect (`VirtualScroll`, an absolutely
positioned div per row), web-treeview (scroller → spacer → translated content, rAF-throttled) and web-grid
(table spacer rows). Decided 2026-11-17 — fixed row height only (every copy is):

- **`createVirtualWindow(scroller, { getCount, rowHeight, overscan = 5, render, insetTop, hasStructure = true })`**
  → `{ range, window, refresh(), scrollToIndex(i, { block, behavior }), indexAt(clientY), destroy() }`.
- Core builds `.km-virtual-spacer` (`position: relative`, `block-size: count × rowHeight`) with
  `.km-virtual-window` inside (`position: absolute`, `translateY(start × rowHeight)`) — appended to the scroller,
  so a header before it (sticky or not) stays. The range is measured from the spacer's own top. `render({ start,
  end, offsetTop, totalHeight, window })` — the component fills `window` with rows `start … end - 1`. A
  `<table>` passes `hasStructure: false` (`window: null`) and sizes its spacer rows from `offsetTop` /
  `totalHeight`; its `listTop` (px or a function) says where row 0 starts in the scroller's content (a `<thead>`
  inside the scroller), so the range, `scrollToIndex` and `indexAt` count from there.
- `getPinned: () => number[]` keeps rows rendered while scrolled away (web-grid: the row being edited keeps its
  input and focus): `render` gets `pinned`, the valid indexes OUTSIDE the range, ascending; a change of that list
  re-renders. The component keeps their elements alive (placed at `index × rowHeight`, or a table row between its
  spacer rows). `computeVirtualRange({ scrollTop, viewport, count, rowHeight, overscan })` is the pure range math,
  for a component that measures and renders on its own schedule.
- Renders on scroll (passive, only when the range changes), on the scroller's own resize (`observeElementSize`)
  and on `refresh()` (always — the data changed). `rowHeight` / `insetTop` may be functions, read per compute.
  A scroller with no height yet (a hidden dropdown) renders `2 × overscan + 1` rows until its size arrives.
- `scrollToIndex` goes through `getScrollTopForBox` / `scrollContainerToBox` (§12.15: `block`,
  `scroll-padding-top`, `insetTop` for a sticky header measured in JS) and renders at once for `'auto'`.
  `indexAt(clientY)` = the row under a viewport y (drop targets, hover), `-1` outside.
- Not in core: variable row heights, horizontal virtualization (web-grid columns), row recycling — the
  component re-renders the window (string or DOM, its choice).

### 12.27 Selection model — IMPLEMENTED (`src/selection/selection.ts`, main index)

web-multiselect, web-treeview, web-grid and web-dropzone each kept a selected set, an anchor and their own
Shift / Ctrl rules (one without Ctrl + Shift, one where Shift ignored filtering). Decided 2026-11-17 —
**`createSelection<K>({ mode, getOrderedKeys, isSelectable, changeCallback })`** → `{ click(key, modifiers),
toggle, extendTo(key, { isAdditive }), selectAll, clear, set(keys), has, values, size, anchor, setAnchor }`:

- File-manager rules: click = only this key (anchor = key); Ctrl / Cmd = toggle (anchor = key); Shift = the
  range anchor … key REPLACES the selection, the anchor stays; Ctrl + Shift = the range is added. `click()` takes
  the `MouseEvent` itself (its `shiftKey` / `ctrlKey` / `metaKey`).
- `single` mode: a click selects the key, Ctrl + click on the selected key clears it, Shift is ignored,
  `selectAll` does nothing, `set()` keeps the first key. `mode` may be a function (a live input).
- Ranges walk `getOrderedKeys()` — the DISPLAY order (sorted, filtered, collapsed rows out) — and skip
  `isSelectable(key) === false` keys; an anchor that isn't shown any more → the range is just the key.
- `changeCallback({ added, removed, values })` only on a real change, never for `{ isSilent: true }` writes (a
  `value` input the component reports itself); a throwing `changeCallback` is logged.
- `extendTo` = Shift + Arrow; `setAnchor` moves the anchor with keyboard focus without selecting.
- Not in core: tree cascades (parent ↔ children), grid cell ranges, `maxSelections` limits, group headers —
  the component checks / expands before calling, or post-processes in `changeCallback`.

### 12.28 Drag — IMPLEMENTED (`src/dom/page-drag.ts`, `src/dom/pointer-drag.ts`, main index)

Two gaps from the audit (B11 / B12): only web-dropzone knew when files were dragged over the page (its own
`page-file-drag.ts`), and in-page drags (web-treeview nodes, web-grid columns / rows) were HTML5 DnD or mouse
events — nothing on a phone except web-treeview's own touch-event copy. Decided 2026-11-17:

- **`observePageDrag({ types = ['Files'], changeCallback(isDropActive) })`** → unsubscribe: one window listener set (capture
  phase) shared by every watcher; per watcher only drags carrying one of its `dataTransfer.types` arm it. Start:
  a matching `dragenter` / `dragover`; end: `drop`, leaving the window (enter / leave depth), `dragend`, Escape,
  or 350 ms without a `dragover` pulse (Escape on an external drag never reaches JS). After Escape the same
  drag's `dragover`s don't re-arm (they keep pulsing while the pointer moves); a new `dragenter` or a pause in
  the pulses longer than the timeout does. `setDropActiveState(host,
  internals, isDropActive)` → `drop-active` attribute + `:state(drop-active)`. From web-dropzone.
- **`createPointerDrag(container, { getSource, threshold = 5, longPressMs = 300, autoScroll, beforeStartCallback, moveCallback,
  dropCallback, cancelCallback })`** → `{ isDragging, cancel(), destroy() }`. Pointer events for mouse, pen and touch. Mouse /
  pen start after `threshold` px; touch must rest `longPressMs` (an earlier move = a scroll, the drag never
  starts; `longPressMs: 0` = armed at pointerdown, the page doesn't scroll, and the drag starts past `threshold`
  like a mouse — no timer race with the first move; `longPressMs` / `threshold` may be functions, read per press),
  then a non-passive `touchmove` is prevented (no page scroll) and the long-press context menu is
  suppressed. Callbacks get `{ source, x, y, target, pointerType, event }`; `target` = `deepElementFromPoint`
  (through open shadow roots — the drag image needs `pointer-events: none`). `beforeStartCallback` returning `false`
  refuses. Auto-scroll near the edges of `findScrollContainer(source)` (or `autoScroll.container`; `autoScroll.isEnabled(ctx)` per frame — `false` holds still), `moveCallback`
  re-run as content slides under the pointer. Escape / `pointercancel` → `cancelCallback`. The click that ends a drop
  is swallowed (`guardGhostClick`). Pointer capture on the container.
- Not in core: the drag image / drop indicator, drop rules, cross-window HTML5 DnD (a component may keep
  `draggable` for dragging OUT of the page; its drop targets still use `observePageDrag` to arm).

### 12.29 Styled layers + the drawer preset — IMPLEMENTED (`src/positioning/layer.ts`, `/positioning`; `.km-drawer` in `SHEET_CHROME_CSS`)

Audit B13 / B14: web-treeview drew its drop pads and drag ghost by hand, web-dropzone mounted its drag overlay on
`<body>` with its CSS variables copied inline, and its side panel was a dummy `createPopover` with no anchor.
Decided 2026-11-17:

- **`createLayer(host, { css, className, zIndex = Z_INDEX.dropdown, isInteractive = true, container, cssVars, customStylesOptions })`** →
  `{ element, layer, place(rect), syncTheme(), destroy() }`. A fixed `div.km-layer` in
  `findOverlayContainer(host)` (`<body>` or the open top-layer `<dialog>` / popover around the host) with its OWN
  shadow root: `css` + `MOTION_CSS` adopted there, `element` (`.km-layer__content` + `className`, `inset: 0`) is
  where the component renders; the host's theme attributes copied with `inheritTheme` (C-CS-10). `place(rect)`
  takes viewport coordinates (`host.getBoundingClientRect()` to cover the host) and subtracts the fixed
  containing block when the container has one (`getFixedPositionOffsetParent`). `isInteractive: false` =
  `pointer-events: none` (a drag ghost under the pointer). Per-instance custom properties on the HOST don't
  inherit into the layer (not a descendant): the ones the layer CSS reads are listed in `cssVars` and their
  computed values at the host are set on the layer (re-read by `syncTheme()`); page tokens and the theme arrive on
  their own. Core's `:host { all: initial }` reset is in the lowest cascade layer (`@layer km-layer-base`), so the
  component's rules — layered or not — override it. The host's text look (font family / size / weight / style, line
  height, colour, letter spacing) and `dir` are copied inline on the layer — what it would have inherited inside the
  host (web-treeview's pass); `syncTheme()` re-reads them (found in web-dropzone's pass: a layered
  `:host([data-theme]) { color-scheme }` lost to the unlayered reset).
- **The component's custom CSS (`customStylesOptions`, audit G2, 2026-11-23):** page CSS can't reach the layer's
  shadow root, and neither can the custom CSS (§12.8) in the host's root. `customStylesOptions` takes the SAME
  `CustomStylesOptions` object the component passes to its main `createCustomStyles`; the layer creates an unshared
  handle for its own root (`shouldShareLayers: false` forced — not the host's registered layers, managed children keep
  reading the main handle), so the tag's page-wide `customStyles` / `getCustomStylesCallback` and the instance's sit in
  the layer too. Live: a page write for the tag and every `refresh()` of the host's MAIN handle re-resolve it (an
  unshared handle follows its host's main handle, §12.8), `syncTheme()` refreshes it, `destroy()` removes it. Replaces
  the hand-made `createLayer` + second `createCustomStyles` wrapper in web-treeview, web-grid and web-dropzone.
- **Drawer preset**: `.km-drawer` + `.km-drawer--start | --end | --top | --bottom` in `SHEET_CHROME_CSS` — fixed on
  one edge (start / end follow the panel's writing direction), the modal tier, safe-area padding, slide in / out on
  `--km-sheet-drawer-duration` (→ `--base-duration-medium`, so `data-motion` / reduced motion apply),
  `--km-sheet-drawer-size | -max-height | -bg | -color | -shadow | -border-radius`. A component's drawer =
  its panel with those classes + `startModalSession(panel, { backdrop: true, dismissCallback })` — or, for a drawer the
  page stays usable around (an upload monitor), `startPanelSession(panel, { dismissCallback })`; closing =
  `session.end()` + `animateOut(panel, { className: 'km-drawer--closing' })`. `/menu`'s drawer presentation keeps
  its own `.km-menu-sheet--drawer` (same look, its own variables).
- **Full-screen frame**: `.km-sheet` (+ `.km-sheet-body`, `.km-sheet--closing`) in the same stylesheet — the phone
  full-screen sheet panel, §12.9; with `startModalSession(panel, { dismissCallback, shouldFitToVisibleViewport: true })`.

### 12.30 IME-safe text input — IMPLEMENTED (`src/dom/text-input.ts`, main index)

Audit B16: only web-commandpalette handled IME composition (Japanese / Chinese / Korean input, phone keyboards
with suggestions); web-multiselect, web-treeview, web-grid and web-editor searched on every intermediate
`input` and treated the candidate-confirming Enter as their own. Decided 2026-11-17:

- **`observeTextInput(input, callback(value, event))`** → unsubscribe: `input` events with `isComposing` are skipped,
  `compositionend` delivers the committed text, and Firefox's plain `input` right after `compositionend` (same
  value, same task) is dropped; a same-value `input` later is a real edit. Works on an input, a textarea or a
  contenteditable (`textContent`). Delegated: `observeTextInput(container, cb, { selector })` — one subscription on an
  element / shadow root covers every matching descendant, including ones re-rendered later (web-grid's filter
  row); the callback's third argument is the matched element.
- **`isImeEnter(event)`**: `isComposing` or `keyCode === 229` (Safari's confirming Enter arrives after
  `compositionend` with `isComposing: false`) — a keydown handler returns early on it.
- Debouncing stays with the caller (`createAsyncRunner` / `createDebounce`).

### 12.31 Scroll kept across a DOM move — IMPLEMENTED (`src/dom/keep-scroll.ts`, main index)

BlissElement keeps a component's state across a DOM move (§6: `disconnect()` → `connect()`, no rebuild), but the
browser drops every scroll offset inside a detached element — a keyed list reorder or a re-parent put every
grid / tree / list back at the top. Audit B20, decided 2026-11-17:

- **`keepScrollAcrossMove(host, () => [scrollers])`** → stop. Records each listed scroller's `scrollTop` /
  `scrollLeft` from its `scroll` events (capture listeners on the host and its shadow root — a detached element
  already reads 0, so reading at disconnect would be too late) and restores them after the host's next
  activation (after `connect()`), then once more on the next frame (after a re-render in that frame).
- Driven by a core-internal connection notifier (`src/element/connection-watch.ts`, page-wide state like
  `removal-watch.ts`): BlissElement calls `notifyConnected(this)` at the end of every activation. A host that
  isn't a BlissElement never restores.
- Only listed scrollers; only positions a `scroll` event reported (a programmatic `scrollTop` write fires one in
  the browser too).

### 12.32 Clipboard — IMPLEMENTED (`src/dom/clipboard.ts`, main index)

Audit B21: web-grid copied with `navigator.clipboard.writeText` and no fallback (it rejects outside a secure
context — an intranet app on plain `http://` — and in some webviews); web-grid (twice) and web-daterangepicker
read `clipboardData.getData('text')` each their own way. Decided 2026-11-17:

- **`copyText(text)`** → `Promise<boolean>`: the async Clipboard API when present in a secure context, else a
  hidden, focused, selected `<textarea>` + `execCommand('copy')` inside the same user gesture; the previous focus
  and selection are put back — focus via `deepActiveElement()`, so a focused grid cell inside a shadow root gets
  it back, not its host; never throws (`false` = not copied — show the component's own message).
- **`readPasteText(event, { type = 'text/plain', shouldNormalizeNewlines = true })`** → the pasted text (`''`
  when none): falls back to the legacy `'text'` alias, CRLF / CR → LF so a pasted spreadsheet block splits the
  same on every OS.
- The component keeps the parsing (TSV → cells, a date string → a date) and the `before*Callback`s around it.

### 12.33 Icons — IMPLEMENTED (`src/dom/render-icon.ts`, main index)

Icons are DATA: the page passes a string on an item / option / command / node. Audit B22 found five readings of
that string — web-commandpalette's `renderIcon` (the model), `/menu`'s raw `innerHTML`, web-grid / web-treeview /
web-multiselect each their own. Decided 2026-11-17 — **`renderIcon(icon, { prefix })`** → HTML:

- starts with `<` → raw (an `<svg>`, `<img>`, `<i class="fa …">` — the page vouches for its markup);
- a built-in name (`BUILT_IN_ICON_NAMES` = the base-css-variables `--base-icon-*` glyphs: `close`, `chevron`, `check`,
  …) → `<span class="km-icon <prefix>__icon <prefix>__icon--<name>"
  style="--_km-icon: var(--base-icon-<name>, linear-gradient(transparent 0 0))" aria-hidden="true">` — a 1em glyph
  in `currentColor` masked from the token; an unset token draws nothing (not a square). The hooks below
  never see a built-in (a theme restyles it through the token); the icon maps, asked BEFORE the built-ins since
  2026-11-23, may replace one (`{ close: 'fa-solid fa-xmark' }`);
- the element's own `renderIconCallback` (option `renderIconCallback`, else `host.renderIconCallback` — every
  component's input row), then the page-wide `window.components.renderIconCallback(name, { component, element,
  prefix, …extras })` (`component` = the `component` option — for a framework component whose host is a plain
  `<div>` — else the host's tag) (non-enumerable, installed internally by `registerComponent()` / `renderIcon()`) → a string is used as is (`''` = no icon); `null` /
  `undefined` = not mine (the next one decides); a throw → logged (the host's logger) and the next rule decides.
  One element needs no page setup;
- ASCII class names (`[A-Za-z][A-Za-z0-9_-]*`, space-separated) → `<i class="<prefix>__icon <names>"
  aria-hidden="true">` — an icon font (`fa-solid fa-folder`, `bi-gear`). Inside a shadow root the page's icon-font
  stylesheet doesn't apply, so the `<i>` is empty until the PAGE brings it in through the component's custom CSS
  (§12.8): `customStyles = "@import url('…/all.min.css');"` per element or `window.components[tag].customStyles` per
  tag (core hoists the `@import` into the head for `@font-face`). A documented page requirement, no core
  mechanism (decided 2026-11-23);
- anything else (an emoji, a non-Latin letter) → escaped text.

Revised 2026-11-19 to keen-pure-admin's model (reserved affordances → providers → `<i class={name}>`), plus the
markup and text steps string data needs. The trade-off: a page-invented token (`--base-icon-star` + `'star'`) is no
longer masked — it renders `<i class="star">`; map it in the hook instead.

`ICON_CSS` (`.km-icon`, `@layer component`, forced-colors aware) is adopted where named icons render; `/menu`
adopts it and renders item icons through `renderIcon` (a name used to come out as its text), with the component element as
`host` (its `icons` map / `renderIconCallback` apply) and `openMenu`'s `iconDefaults` option as `defaults` — so a
component's menu entries carry icon NAMES (`icon: 'rowDelete'`), never pre-resolved markup (decided 2026-11-23).

**Live (decided 2026-11-21):** the page may set `window.components.renderIconCallback` AFTER components rendered (load
order can't be ensured), so they repaint. `observeIconHook(listener)` → unsubscribe hears every change of the page
hook (set / replaced / cleared — the same function assigned again is no change; a non-function = none);
`getIconHookRevision()` is the counter behind it. BlissElement's opt-in **`iconsChanged()`** hook (override =
subscribed while connected), wired like `localeChanged()` (§12.24): not called on the first connect (`reinit()`
rendered with the current hook); a change while detached fires on reconnect (the revision). A component that renders
icons implements it: re-render the icons, keep the state. An instance `renderIconCallback` is an input row — its
change goes through `update()` / `reinit()` as usual. Cross-copy: the state (callback, revision, listeners, the
notifying accessor) is `sharedState`; an accessor installed by core rc24 or older (its setter only stores the
callback) is replaced by the first newer copy that publishes — the shared callback is kept.

**Icon maps (decided 2026-11-23, audit Q12):** icons work like labels — a page replaces a component's own icons
without a callback. Order (first match wins; MAPS FIRST, revised 2026-11-23): markup → the element's `icons`
map → the page-wide flat `window.components.icons` (`'<tag>.<name>'` before `'<name>'`; non-enumerable accessor in the
shared icon state; assigning replaces it with a frozen copy, non-string values dropped with a warning, a non-object
ignored) → built-in name → the element's `renderIconCallback` → the page-wide `renderIconCallback` → the component's
`defaults` (new
`renderIcon` option: its icon names → icons) → class names → text. A map value is itself an icon string resolved by
the same rules (`{ rowDelete: 'delete' }` → the built-in glyph); a name not in a map falls through; a value leading
back to a name already met on the way is skipped (the next rule decides; `{ close: 'close' }` draws the built-in) —
no recursion loop. `''` = no icon. Instance map: option `icons`, else
`host.icons`. Every icon-rendering component names its icons (a built-in name is fine — grid's `add` / `delete`: the
built-in draws it unless a map replaces it), keeps its
look as `defaults`, declares `{ configKey: 'icons', attribute: 'icons', converter: toObject({ validate: isIconMap }),
on: 'update' }` (property object or JSON attribute; `isIconMap` exported) and documents its icon names in the row's
description. A `window.components.icons` assignment bumps the same revision as the page hook → `iconsChanged()`;
BlissElement also calls `iconsChanged()` after `update()` for a patch batch that changed `icons` (a rebuild batch
already rendered with it).

### 12.34 Controller facade — IMPLEMENTED (`src/element/controller-facade.ts`, main index)

`createController()` (§12.5) returns the component's public imperative API — never the engine. Audit B23: six
hand-built copies (web-treeview / web-dropzone factories, web-multiselect / web-daterangepicker `call()` maps,
web-editor / web-commandpalette object literals), each forwarding methods to an engine that exists only after the
first build, answering state with empties before that, some frozen, some not. Decided 2026-11-17:

- **`createControllerFacade<C>(target, spec)`** → a FROZEN object. `target` = the object or a function returning
  it (the component's `() => { this.flush(); return this.#engine; }`), read on every call so a rebuilt engine is
  picked up.
- `spec` = an array of method names, or `{ methods, state, writable, emptyResults }`: methods forwarded with
  `this` = the target (no target → `emptyResults[name]?.()`); `state` = live read-only getters (`name → empty value
  or factory` while there is no target); `writable` = forwarded getter + setter (a set without target is
  dropped). Nothing else of the target is reachable.

### 12.35 Render-callback results — IMPLEMENTED (`src/dom/render-slot.ts`, main index)

Audit B24: every component read its `render*Callback` return values its own way (a string HTML here, text there;
`null` = default in one, empty in another; an element appended / replaced / ignored; the hook re-run on every
repaint, so a focused input inside a custom cell lost focus). Decided 2026-11-17 — every `render*Callback` that
RETURNS its content goes through **`renderSlot(container, result, { renderDefault, memoKey })`** → `'custom' |
'default' | 'hidden'`:

- `string` → the container's HTML (a render callback is code, like a template — the page vouches for it; data
  inside it is the callback's to escape); a same string isn't rewritten (focus, listeners survive);
- `Node` → the container's only content (moved, not cloned);
- `null` / `undefined` → `renderDefault(container)` (the built-in look), else emptied;
- `false` → emptied and `hidden`.
- `result` may be the hook call itself (`() => cb(ctx)`): with a `memoKey` equal to the previous one for that
  container (`Object.is`), the hook isn't called and the DOM isn't touched — the component builds the key from
  what the hook depends on (`${row.id}@${row.version}`).
- Not this contract: hooks that FILL a given element and may return a cleanup (`renderLoadingCallback`, `/menu`'s
  `renderItemCallback` / `renderMenuCallback`, web-treeview's `renderIconCallback`) — they keep "fill + optional
  cleanup".
- Rows built as HTML strings (a virtual window's rows, a badge strip) use the string form
  **`renderSlotHtml(result, renderDefault?)`** → `{ html, kind }`: the same reading, `false` → `''`; a `Node` is
  serialized (no listeners), so such a slot is documented as markup-only. No memo (no container).

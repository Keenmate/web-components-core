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
| **web-multiselect** | single-pkg | string-tag: `parser:'enum', enumValues:[…]` + central switch | local SSR stub; `setAttributes()` batching |
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
│   │   ├── resolve-enum-attribute.ts   (lifted from dropzone)
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
}
```

One converter per input owns **both** parsing (from an attribute string)
and validation (of a JS-assigned value) — correctness lives in one place
and can't drift across the three spots it used to.

---

## 5. Converter library (`to*` factories)

Common cases stay one-liners; the converter is where "ensure the value is
correct" is enforced. Naming: `to<Type>` — "convert the raw value to a …".

```ts
toEnum(values, { default?, shouldNullOnInvalid? })  // exact-match against the set; invalid → default (or null; with no default, el.x = null clears it too)
toInt({ min?, max?, default? })                // parse + range-check; NaN/out-of-range → default
toFloat({ min?, max?, default? })
toText({ shouldTrim?, isEmptyAllowed?, isNullable?, default? })  // string (NOT toString). isNullable:true → absent/empty is null (optional string), not ''
toBool('presence' | 'default-true' | 'default-false' | 'tristate')
toBytes({ default? })                          // "10mb" → 10485760
toList({ itemType: 'string' | 'int', separator?, requiredCount? }) // CSV / pipe-list, with optional fixed-length validation
toCustom(parseFn)                              // wrap any bespoke parser  (month-names, 'auto'|0..6)
toFunction()                                   // callback: property-only, validates typeof === 'function'
toValue({ validate?, default? })               // rich value; property = validate, attribute = JSON, reflects JSON
toObjectArray({ validateItem?, default? })     // array of rich items (e.g. `options`); property = array, attribute = JSON; default []
toObject({ validate?, default? })              // plain (non-array) object; property = object, attribute = JSON
```

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
"unset"), `toBool('presence')` (any value means on), a blank list/JSON. A custom
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

  // BATCHING: setAttributes({...}) / batch(fn) coalesce many changes into ONE reinit()/update()
  setAttributes(values: Record<string, unknown>): void { /* … */ }
  batch(fn: () => void): void { /* … */ }

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
  `connect()` did).
- **Removal vs move** — `removedCallback()` (opt-in: the base schedules the
  check only when a subclass overrides it) fires after `disconnect()` once the
  element is still detached at the next animation frame (a macrotask where rAF
  is unavailable or the document is hidden). A synchronous move never fires it.
  Use it for teardown that must survive a move but not a removal (cancel uploads,
  `destroy()`). Re-adding the element after it fired is a fresh activation:
  `connect()` runs as usual (no forced `reinit()`); a subclass that tore its
  structure down in the hook rebuilds it in `connect()`.

Plus a typed `dispatch(el, name, detail, {bubbles=true, composed=true})`
and generic DOM utils (`resolveEnumAttribute`, `createMicrotaskScheduler`)
lifted from dropzone. The store/satellite topology stays dropzone-local.

The `static inputs` table is sanity-checked once per class at construction
(warn-only, never throws): duplicate `configKey`/`attribute`, or `shouldReflect:true`
without an `attribute` / without `converter.toAttribute`. Removing an attribute
is reactive — it resets that input to its `default` (absent == default).

**Invalid values — one rule for both paths: warn and keep the previous value.**
A property value `validate` rejects, and an attribute value the converter reports
invalid (or whose converter throws), both warn and stage nothing — no
`reinit()`/`update()`, and the write isn't explicit for §6.2. Before any valid
value the previous value is the default, so `<x page-size="abc">` in markup ends
at the default. After a rejected attribute, an input with `shouldReflect` writes
its current value back (before the first connect: at that connect's flush), so
the DOM shows what the element uses; a non-reflected input leaves the markup
alone. The write-back runs inside the reflect guard, so it can't re-enter.

The warning goes through the element's instance logger (`INIT` category, else the
bundle's first; `[CORE:ELEMENT] tag#id` when the tag has no logging bundle) — it is
visible at the default `warn` level and silenced by `disableLogging()` like any
other line. *(Amended: these warnings used to bypass the loggers via a direct
`console.warn`; that exception was revoked — core has no direct `console` calls,
§12.1.)*

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
`shouldNullOnInvalid` enum, or a `default: null` row — see
`clearableConfigKeys`). So **null is always intentional; never drop it.**

**Component side.** Assemble the engine config with
`this.engineConfig(excludeKeys)` (→ `collectEngineConfig`): a shallow copy of
`config`, `exclude` keys removed, **every `null` preserved**. Never hand-roll a
`if (value === null) delete cfg[key]` loop — dropping the clear is the bug this
replaces (it made clearing a nullable input a silent no-op across every
component).

```ts
protected override update(partial = {}) {
  const cfg = this.engineConfig(NON_ENGINE_KEYS); // nulls intact
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
  `setAttributes()`, or connect while detached).
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
  like a detached one), so `whenSettled()` waits for the release; `flush()`,
  `setAttributes()` and `batch()` stage but don't build. A pre-upgrade
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

Every form-participating component has the `isDisabled` input (attribute
`disabled`). A form-associated element (`static formAssociated = true`) can also
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

---

## 7. Fit check — all five components

- **multiselect** — `{parser:'enum', enumValues}` → `toEnum(...)`;
  `bool-default-true` → `toBool('default-true')`; `setAttributes` batching
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
  `resolveEnumAttribute` / scheduler.
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
   component needs it (recommended).
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
ESM loader in consumers' vitest runs. Core has no logging dependency.)* Original
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
export const DEFAULT_CATEGORIES = ['INIT', 'DATA', 'UI'] as const;

export function createLoggers<C extends string>(
  namespace: string,
  categories: readonly C[] = DEFAULT_CATEGORIES,
): {
  loggers: Record<C, Logger>;
  enableLogging(): void;
  disableLogging(): void;
  setLogLevel(level: LogLevel): void;
  setCategoryLevel(category: C | `${string}:${C}`, level: LogLevel): void; // 'DATA' or 'GRID:DATA'
  LOGGING_CATEGORIES: readonly C[];
};
```

Usage — defaults, redefine, or extend:
```ts
const { loggers } = createLoggers('MULTISELECT');                                   // defaults: INIT/DATA/UI
const { loggers } = createLoggers('TREEVIEW', ['INIT','DATA','INDEX','UI','DRAG']); // redefine
const { loggers } = createLoggers('DROPZONE', [...DEFAULT_CATEGORIES, 'FILE']);     // extend
export const { INIT: initLogger, DATA: dataLogger, UI: uiLogger } = loggers;
```

Optional companion module: `createPerfLogger(namespace)` (treeview's
`perfStart` / `perfEnd` / `perfMeasure` / `perfSummary`), opt-in per
component.

**Default level, core's own messages, page-wide switch** *(added after rc14)*:

- **Every bundle starts at `warn`** (`DEFAULT_LOG_LEVEL`) — errors and warnings
  visible out of the box; `enableLogging()` (default `debug`) adds info/debug;
  `disableLogging()` silences everything. A level persisted in `localStorage`
  (`km-log:NS:CAT`, only written by an explicit `logger.setLevel(x)` — the bundle
  controls never persist) wins over the default. A second `createLoggers()` for
  the same namespace keeps the current level.
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
  `getMenuChildren` / `runBeforeCallback*` take an optional trailing `logSource`
  (default: the ctx); `openMenu` passes its `host`, `runAction` its detail.
- **Page-wide switch — `window.components.logging`** (non-enumerable; tag names
  always contain a hyphen, so no clash, and enumerating `window.components` /
  `getRegisteredTags()` still yields components only): `enableLogging(level?)`,
  `disableLogging()`, `setLogLevel(level)`, `getCategories()` — the per-component
  method names. Applies to every bundle created so far AND later (a late
  `createLoggers()` adopts the current global level). Components bundle their own
  core copy, so the state (bundle list, current level, the controls object) lives
  on `globalThis[Symbol.for('@keenmate/web-components-core:logging')]` and is
  shared by every copy. A later per-component call wins for that component (it
  just sets that bundle's levels again); per-instance overrides apply on top.
  `getGlobalLogging()` is the code-side handle. SSR-safe: no `window` → nothing
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
  reference, so portaled layers keep the theme automatically.
- **Width-matching** → one `matchWidth: 'min' | 'exact' | 'max' | false` (via
  `size()`), replacing the three per-component hacks. `'min'` floors the panel to
  the reference width (grows for wider content), `'exact'` pins it, `'max'` caps
  it (shrinks for narrower content).
- **`lockPlacement`** → feeds `flip({ fallbackStrategy: 'initialPlacement' })`,
  so the initial placement is preferred over reordering.

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
  offset?: number;                    // default 4
  shouldFlip?: boolean;               // default true (skipped when lockPlacement holds)
  shift?: number | false;             // padding; default 8
  matchWidth?: 'min' | 'exact' | 'max' | false;   // via size(); default false
  lockPlacement?: boolean;            // keep first placement unless it must flip
  shouldAutoUpdate?: boolean;         // default true
  inheritThemeFrom?: HTMLElement;     // copy data-theme onto `floating` (C-CS-10)
  placedCallback?(placement: Placement): void;
}): { update(): void; destroy(): void };

createTooltip(opts: { trigger; container; content; placement?; offset?; delay?; cssClass?; visibleClass? }): TooltipHandle;
createPopover(opts: { reference; panel; container?; placement?; matchWidth?; lockPlacement?; strategy? }): PopoverHandle;
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
- **Live-instance registry** — `BlissElement` adds itself to a per-tag `Set` on
  connect and removes itself on disconnect (a DOM move re-tracks the same
  element, no duplicate). `getInstances(tag)` returns the live elements; the
  registry entry's `getInstances()` is wired to it. No per-component tracker.
  The elements ARE the per-instance handles: a devtools overlay
  (Ctrl-Alt-C → list a tag's instances → act on one) enumerates tags via
  `window.components` + `getRegisteredTags()` and each tag's instances via
  `getInstances()`.
- **Per-instance logging** — `BlissElement` exposes `this.log` (an instance
  logger per category of the tag's `createLoggers` bundle, wired by
  `registerComponent`'s `logging` option). Each line reads
  `[NAMESPACE:CATEGORY] #id` (the element's own `id` when set, read per line, else
  a running number — the tag is not repeated; a tag with no bundle falls back to
  `CORE:ELEMENT` labelled `tag#id`, §12.1) and is gated by
  the MORE verbose of the type-level category level and the
  instance's own override, emitting via `console` directly so an instance can
  log while its type stays silent. `element.enableLogging(level?)` /
  `disableLogging()` / `isLoggingEnabled` are the overlay's per-instance switch:
  pick one instance from `getInstances()`, flip it loud, leave the rest quiet.
  Components should prefer `this.log.<CATEGORY>` over the shared type-level
  loggers so this scoping works. `bundle.forInstance(id, getOverride)` is the
  underlying factory; a tag→bundle map (`logger-registry.ts`) lets the element
  base find its bundle by `localName`.

### 12.4 Other candidates (later modules)
- **Callbacks & events model** — IMPLEMENTED, see §12.5 (`static events` +
  `emit()` + managed `on<Name>` properties, and `runHook()` for `*Callback`s).
- **Theming / CSS cascade-layer helpers** — the RUNTIME step (adopt a
  stylesheet into a shadow root) is IMPLEMENTED, see §12.8 (`adoptStyles`
  + `createStyleSlot`). The authoring conventions (`@layer` order, `?inline`
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
  analysis).
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
  extends, with the plugin pre-wired.

The source-of-truth split (§8 amendment): structure from the table, prose from
the optional `description` / `deprecated` fields on each row.

### 12.7 Testing utilities — IMPLEMENTED (`src/testing/` + `whenSettled()`)

**Status:** built. Two parts.

- **`BlissElement.whenSettled(): Promise<void>`** — a first-class "await the
  pipeline" signal, in **core** (not just tests). Resolves once every staged
  change has flushed and its `reinit()`/`update()` has run; resolves immediately
  when nothing is pending. `setAttributes()`/`batch()` flush synchronously (so
  the element is already settled after them); loose property assignment coalesces
  on a microtask (so `el.x = …; await el.whenSettled()` awaits it). While
  detached, pending changes are held, so the promise resolves on the next
  connect's flush. This replaces the flaky bare-`await Promise.resolve()` guess
  in tests AND gives consumers a deterministic read-after-write point.
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
- **`createStyleSlot(root, { position?, cssClass? })`** → `{ set, clear,
  destroy }` — a PER-INSTANCE, replaceable `<style>` slot for the
  `customStylesCallback` pattern (user CSS that changes at runtime). One element
  at a consistent position, so re-`set` replaces rather than stacks — fixing the
  prepend-on-init / append-on-update inconsistency the components have today
  (e.g. multiselect's `.ms-custom-styles` handling). `<style>`-based on purpose:
  user CSS may use `@import`, which constructable stylesheets reject. Core owns
  the mechanism; the `customStylesCallback` input row stays in each component's
  table (a `toFunction()` returning a CSS string).

The `?inline` import (Vite build concern) and the `@layer variables, component,
overrides` order (CSS guidelines, invariants #6–#9) stay authoring rules — the
helpers take strings and don't care how you got them or how they're layered.

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

1. **attaches the component context** to the detail, in place (`withContext`):
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

**`*Callback` — `runHook(key, ctx, { whenUnset, errorCallback? })`.** Core owns only
the drift-prone plumbing: unset → `whenUnset`; the callback is invoked with a
single `ctx` argument and its result is normalized through `Promise.resolve` (so
sync OR async both work); a throw routes to `errorCallback` if given, else **re-throws**
(no silent swallow — a component that forgets `errorCallback` fails loudly).
`runHook` stays the generic path for providers / renderers whose result has no
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
`connect()`). `configureBreakpoints({ mobile: 640, tablet: 1024, desktop: Infinity })`
redefines the width buckets globally. SSR-safe: no `window`/`matchMedia` → a
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
`isTouchPrimary`. Raw `viewportWidth`/`viewportHeight` are **excluded from its
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
  in CSS px; for a one-off read use `this.getBoundingClientRect()`. Override-gated
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
  fullscreen sheet. Only touch-primary devices consult the size line: shorter
  viewport side below `TABLET_MIN_SHORT_SIDE` (600, the Material `sw600dp` line) ⇒
  `mobile`, else `tablet`. This is a **distinct axis** from the width-only
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
  `{ tablet: 'modal' }`. The earlier binary `resolveMobilePresentation` is a
  deprecated wrapper (default map; never `modal`), removed at 1.0.

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
body-scroll lock) and `observeKeyboardInset(panel)` (pin a fixed sheet above the
soft keyboard via `visualViewport`).

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
   document), `closest` (the nearest ancestor carrying a signal *at connect* — the
   old `:host-context` reach, opt-in), or an `Element` (property). Components sharing
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
Chromium only); use `theme-source="closest"` or a selector there. A source resolved
by `closest` / selector is fixed for the subscription — changing `theme-source`
re-resolves, a signal added later to some *other* ancestor does not.

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
  `normalized` (default; NFD, strip `\p{M}`, lowercase, hand-fold `ł ø đ ð ħ ı ß→ss æ→ae
  œ→oe ς→σ`), `case-insensitive` (NFC + lowercase + `ς→σ`), `exact` (NFC only). Every mode
  applies NFC, so composed and decomposed accents compare equal. `normalizeSearchText` is
  public so a custom search can normalize identically.
- `SearchMatch` — where the term must sit: `contains` (default), `equals`, `starts-with`,
  `ends-with` (whole value), `word-starts-with`, `word-ends-with` (a word = a run of
  `[\p{L}\p{N}]`), `regex`. A regex is tested against the **raw** value with no flags:
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
accent. `wrapRanges(text, ranges, { open, close, escape })` builds the markup; escaping is
the caller's decision (web-multiselect renders trusted display HTML unescaped, a component
rendering plain text passes an escaper).

**API** (`@keenmate/web-components-core/search`, not re-exported from the root):
`normalizeSearchText`, `findTextMatches`, `matchesText`, `findRegexMatches`,
`statelessRegex`, `NO_SEARCH_TERM`, `createRegexCompiler`, `prepareSearchTerm`,
`matchesSearchTerm`, `findHighlightRanges`, `wrapRanges`; types `SearchBehavior`,
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
`MenuDivider` (`menuDivider(text?)`) is its own entry — never a flag on an item.
`Ctx` is the **surface context** the component builds when it renders or opens
the surface (the row a menu opened on, the picker's selection), carrying the
component context (`controller`, `element`).

Helpers: `resolveActionItem(item, ctx, defaults?)` (callback > static >
component default > base; a throwing callback is logged and the static value
used), `resolveMenuEntries(entries, ctx, defaults?)` (drops hidden items, trims
leading / trailing / doubled dividers, expands string built-ins),
`getMenuChildren`, `normalizeActionItems` (string shorthand),
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
'overlay' | 'api'`), `renderItem(item, el, ctx, resolved)` (fill-or-fall-through),
`renderMenu(el, close)` (full custom content; core still positions + dismisses),
`defaults` / `prepareItem` (built-in state / rewrite, every level), `placement`,
`offset`, `cssClass`, `shouldFocusFirst`, `returnFocusTo`,
`shouldCloseOnOutsideInteraction` (default `true`), `overlayGroup`, `loadingText`,
`inheritThemeFrom`. No visible item → nothing rendered, a closed handle, no `closeCallback`.

**Decisions.** Icons are inserted as HTML (developer-supplied, like action buttons);
label and shortcut are text. Items are `div[role=menuitem][tabindex=-1]` (not buttons —
no native Space/Enter click to double-fire). The keyboard is a capture `keydown` on the
document while open, so the menu is keyboard-modal whether focus is in it or still on
the opener; handled keys are consumed. Hover focuses items (roving focus follows the
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


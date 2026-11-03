# Core review 2026-11-03 — slice 01: `src/element/bliss-element.ts`

Reviewer: cold adversarial pass. Scope: `src/element/bliss-element.ts` (all 1986 lines), its unit tests
(`bliss-element*.test.ts`, `defer-ready`, `destroy`, `hook-errors`, `removed-callback`, `settle`,
`form-disabled`, `form-validity`, `live-value`, `invalid-attribute`, `ssr`), e2e `lifecycle` / `reactivity` / `forms`.
Probes: `src/element/__probe-element-1.test.ts`, `__probe-element-2.test.ts` (jsdom). Both deleted afterwards; no other file touched.

Page-wide state check: this file keeps no page-wide state in module variables (`VALIDATED` is a per-class
WeakSet, which is correct per copy; the rest are constants). No cross-bundle bug of the known kind here.

## Summary

| ID | Sev | Category | Where | One-liner | Confirmed |
|----|-----|----------|-------|-----------|-----------|
| E-01 | High | bug | bliss-element.ts:347-358 | An invalid `motion` attribute in markup wipes out every initial attribute after it during upgrade | yes (probe) |
| E-02 | Medium | bug | bliss-element.ts:1945-1946, 1962 | A `reinit()` retry that calls `this.flush()` (the pattern the docs recommend for imperative methods) recurses without bound | yes (probe) |
| E-03 | Medium | bug | bliss-element.ts:451-486 | A throwing `connect()` means `ready` never fires, `whenReady()` hangs and the env/viewport/size/theme subscriptions are never made, until a DOM move | yes (probe) |
| E-04 | Medium | bug | bliss-element.ts:302-312 | `motion` and `themeSource` assigned before upgrade are never lifted, so an own data property shadows the accessor for good | yes (probe) |
| E-05 | Medium | bug | bliss-element.ts:1217-1221, 1930-1940 | A `formDisabledCallback` that arrives before the first `connectedCallback` runs `update(partial)` before `reinit()` | partly (simulated ordering) |
| E-06 | Medium | bug | bliss-element.ts:1947-1958, 1610-1618 | A throwing `toAttribute` in the deferred-reflect loop drops the first build; `whenSettled()` never resolves and later writes call `update()` on an element that was never built | yes (probe) |
| E-07 | Medium | design | bliss-element.ts:1962-1968 | A throwing `update(partial)` loses its keys, so `config` and the rendered state drift apart for good | yes (probe) |
| E-08 | Low | bug | bliss-element.ts:615-618, 759-778 | `whenReady()` never resolves on a destroyed element, or for waiters registered before `destroy()` | yes (probe) |
| E-09 | Low | bug | bliss-element.ts:1598-1607, 1755 | A throwing `converter.validate` escapes the property setter and `#refreshResponsive`; the attribute path catches the same throw | yes (probe) |
| E-10 | Low | bug | bliss-element.ts:676-691, 337-339 | `setAttributes({ shouldDefer: false, … })` builds twice (release mid-loop, then the rest) | yes (probe) |
| E-11 | Low | bug | bliss-element.ts:364 | The pre-upgrade guard also drops genuine `setAttribute()` calls made after upgrade but before the first connect | yes (probe) |
| E-12 | Low | bug | bliss-element.ts:453-486, 1974-1976 | `destroy()` from inside `connect()` (or a hook) still subscribes / fires hooks on the destroyed element (leak) | yes (probe) |
| E-13 | Low | design | bliss-element.ts:1676-1683 | No change detection: `el.x = el.x` on an `on:'reinit'` input causes a full rebuild | yes (probe) |
| E-14 | Low | bug | bliss-element.ts:1974-1976 | `disabledChanged()` throwing on a retry flush skips `#activate()` | no (code reading) |
| E-15 | Low | bug | bliss-element.ts:1588-1595 | `getLiveValue` on an `on:'none'` input: read-after-write returns the live (old) value, not the assigned one | no (code reading) |
| E-16 | Low | design | bliss-element.ts:1446-1515 | The table check misses an invalid `on` value and configKeys / twin properties that collide with core members (`motion`, `form`, `validity`, `controller`, …) | no (code reading) |
| E-17 | Low | duplication / missing-helper | bliss-element.ts:120-128, 149-162, 302-312, 317-359 | Core-declared properties are listed in 4 separate places (observed attrs, acb dispatch, setAttributes map, pre-upgrade lift). They have already drifted (E-04) | n/a |
| E-18 | Low | duplication | bliss-element.ts:451-539, 516-524 vs 759-778 | Subscription bookkeeping is hand-paired in `#activate`/`#deactivate`, `disconnectedCallback` and `destroy` | n/a |
| E-19 | Nit | naming | bliss-element.ts:278 vs 1229 | Private `#isFormDisabled` (combined state) and protected `isFormDisabled` (fieldset only) share a name but mean different things | n/a |
| E-20 | Nit | naming | bliss-element.ts:879-942 | Lifecycle hooks mix vocabularies: `reinit/update/connect/disconnect` vs `removedCallback/destroyCallback` | n/a |
| E-21 | Nit | docs-drift | bliss-element.ts:10-12, 671-672, 615, 581 | Stale header (web-grid has no table), `setAttributes` JSDoc omits `motion`, the `whenReady` "never rejects" note is incomplete, `shouldDefer` getter after the first build | n/a |
| E-22 | Nit | design | bliss-element.ts:22-41, 1573-1576 | Helpers are declared above the imports; a non-function `on<Name>` twin assignment is dropped silently | n/a |
| E-23 | Medium | test-gap | e2e/*, unit | Missing scenarios (list below), mainly real-browser upgrade / fieldset ordering and throwing-hook paths | n/a |

---

## Findings

### E-01 — High — bug — invalid `motion` in markup swallows the remaining initial attributes
`bliss-element.ts:347-358`

On an invalid `motion` value, `attributeChangedCallback` writes the previous level back inside `#withoutReflect`,
and it does this even during upgrade. The setAttribute/removeAttribute call is `[CEReactions]`. When it pops, the
element's own reaction queue is drained, and that queue still holds the replay of the other initial attributes. They now
run while `#reflecting === true`, and line 318 drops every one of them. Inputs do not have this problem:
`#restoreAttribute` (402-406) and batch values (1654-1655) wait until the first connect when `!#connectedOnce`, and
the `#deferredReflect` comment (213-218) describes exactly this mechanism. The motion branch was written later and
skips that rule.

- Scenario: `<x-el motion="bogus" label="hi" title2="t">` parsed before `define()` → after upgrade `label === ''`,
  `title2 === ''` (the defaults). Both values are silently lost, and the `motion` attribute is removed.
- Probe: innerHTML with the attributes above, then `customElements.define`. Result: `label: "" title2: ""`. The control
  `motion="none"` gives `label: "hi" title2: "t"`. jsdom follows the spec's element reaction queue. Chrome should behave
  the same (same spec mechanism), but this has not been verified in a real browser.
- Fix: when `!this.#connectedOnce`, record a deferred motion write-back and run it at the first connect's flush, the same
  way `#deferredReflect` works. A shared "write own attribute now or at first connect" helper would also cover the next
  core attribute that adds a write-back. Add a unit test (markup with an invalid core attribute before input attributes) and
  an e2e test.

### E-02 — Medium — bug — unbounded recursion on a retried `reinit()` that calls `flush()`
`bliss-element.ts:1945-1946, 1962, 1972`

`#hasFailedReinit` is cleared only after the hook succeeds (1972). During a retry `reinit()`, any nested `this.flush()`
sees `isRetry === true` → `reinit = true` → calls `reinit()` again → and so on. CLAUDE.md tells component authors to call
`this.flush()` at the top of imperative methods, so a `reinit()` that calls one of its own imperative methods (for example
`setSelected`) is realistic.

- Scenario: the first build throws (a bad option, say). Next write → retry `reinit()` → `this.selectAll()` → `this.flush()`
  → `reinit()` → … → stack overflow. On a normal, non-retry build this does not happen, because `#pendingReinit` was
  cleared before the hook ran.
- Probe: a `reinit` that throws on the first build and calls `this.flush()` on later builds. With a depth cap of 20 it was
  re-entered 22 times and hit the cap.
- Fix: clear `#hasFailedReinit` before calling the hook and set it again in `catch`. Or add a `#isFlushing` re-entrancy
  guard that makes a nested flush handle only the newly pending writes.

### E-03 — Medium — bug — a throwing `connect()` stops `ready` and the subscriptions until a DOM move
`bliss-element.ts:451-486`

`#isActive = true` is set before `connect()` runs. If `connect()` throws, the code below it never runs: no
environment/viewport/size/theme subscriptions and no `ready` microtask. Every later `#activate()` returns early because
`#isActive` is already true. So `whenReady()` hangs and `isReady` stays false while the element is otherwise live and
updating. The same happens if the immediate `environmentChanged`/`viewportChanged` fire throws (460, 466). The SPEC
(§6.3) promises "a throwing first build keeps ready pending until a later flush succeeds", but this case is not covered by
any later flush.

- Probe: `connect()` throws once. Then `el.height = 20; el.flush()` → calls `reinit connect reinit`, `isReady === false`,
  `whenReady` unresolved. Only `remove()` + `append()` brought it back: disconnect → connect → ready.
- Fix: do the subscriptions and the ready scheduling in a `try/finally` around `connect()`. Or treat a throwing `connect()`
  as "not active" (reset `#isActive`, retry on the next flush, like a failed `reinit`). Document which one.

### E-04 — Medium — bug — pre-upgrade `motion` / `themeSource` are never lifted
`bliss-element.ts:302-312`

The constructor lifts the input accessors, the event twins, `shouldDefer`, `responsive` and `responsiveCallback`. It does
not lift `motion` or `themeSource`, which are also prototype accessors. A value assigned before the class is defined (lazy
loading, framework props set before import) becomes an own data property that shadows the accessor for the element's whole
life. Later `el.motion = 'smooth'` writes keep landing on that data property, so the component never reacts.

- Probe: `el.motion = 'none'; el.themeSource = 'closest'` before define → upgrade → append:
  `hasOwnProperty(el,'motion') === true`, no `motion` attribute, no `data-motion`. Same for `themeSource`.
- Fix: one table of core properties (see E-17), and lift every entry. Add a unit test per core property for pre-upgrade
  assignment.

### E-05 — Medium (likely) — bug — `formDisabledCallback` before the first connect runs `update()` before `reinit()`
`bliss-element.ts:1217-1221, 1930-1940`

`formDisabledCallback` flushes whenever `this.isConnected`. It does not check `#connectedOnce`. `#pendingReinit` is set
only inside `connectedCallback`. If the browser calls `formDisabledCallback(true)` before `connectedCallback`, `#flush`
runs with `reinit === false` and calls `update(pending)` on a component that has never been built. That likely crashes on
missing shadow DOM. It also sets `#isReleased = true` and `#lastEffectiveDisabled` early. The DOM "insert" algorithm runs
the HTML insertion steps (form-owner reset, disabled-state change) before it enqueues `connectedCallback`, and Chromium
updates the ancestor-disabled state in `InsertedInto`. So this ordering is plausible for an element appended into a
`<fieldset disabled>`. Not verified in a real browser; jsdom has no `formDisabledCallback`.

- Probe: a subclass whose `connectedCallback` calls `formDisabledCallback(true)` before `super.connectedCallback()`, after a
  pre-connect `el.label = 'pre'`. Calls: `update:label reinit connect`. With a real browser ordering, the first hook a
  component sees would be `update()`.
- Fix: `if (this.isConnected && this.#connectedOnce) this.#flushNow();`. The first connect's flush already ends with
  `#syncDisabled`. Add an e2e test: append a form-associated element into a `<fieldset disabled>` and check the hook order
  and `isEffectivelyDisabled` in `reinit()`.

### E-06 — Medium — bug — a throwing `toAttribute` in the deferred-reflect loop wedges the element
`bliss-element.ts:1947-1958` (and `#reflect` 1610-1618)

`#flush` clears `#pendingReinit` and `#pending` (1948-1949) before the deferred-reflect loop, and the loop sits outside the
`try/finally`. If a converter's `toAttribute` throws there, the first build is lost: `#hasFailedReinit` is not set, settle
waiters are not resolved, and `connect()` never runs. Every later write then calls `update()` on an element that was never
built. The property path has a milder version: `#reflect` runs after `#stage`, so the setter throws but the value is
already staged.

- Probe: a batch value staged before connect, for a reflected input whose `toAttribute` throws → after append, calls `''`
  (no reinit, no connect), `whenSettled` never resolved. Then `el.label = 'q'; el.flush()` → `update:label`, still no
  `reinit`.
- Fix: move the deferred-reflect loop inside the `try` (or before the pending state is consumed), and catch converter
  throws in `#reflect` with a warning, as the attribute parse path does (373-377).

### E-07 — Medium — design — a failed `update(partial)` loses its keys
`bliss-element.ts:1962-1968`

A throwing `reinit()` is remembered (`#hasFailedReinit`) and retried. A throwing `update()` is not: its partial is already
consumed, so those keys are never applied again unless they are written again. `config`, the getters and `getLiveValue`
fallbacks report the new value while the rendered state keeps the old one. SPEC §6 only promises "doesn't wedge", but this
leaves the two out of sync for good.

- Probe: `update` throws for `label = 'lost'`. After the fix, `flush()` → `applied = {}` while `el.label === 'lost'`.
- Fix (pick one, document it): put the failed partial back into `#pending` (merge into the next flush), or escalate to a
  rebuild (`#hasFailedReinit = true`) after a failed `update`.

### E-08 — Low — bug — `whenReady()` hangs after `destroy()`
`bliss-element.ts:615-618, 759-778, 482-484`

`destroy()` resolves the `whenSettled` waiters but leaves `#readyResolvers` alone. A destroy before the ready microtask
suppresses the announcement (482) and those waiters stay pending forever. `whenReady()` called after destroy on an element
that never became ready also never resolves. Code that awaits `whenReady()` in a teardown path, or test helpers, can hang.

- Probe: `whenReady()` before append, then `append; destroy()`, then `whenReady()` again → neither resolved.
- Fix: in `destroy()`, resolve the pending ready waiters (or reject them with a "destroyed" error, but the docs say
  "never rejects"). Make `whenReady()` return a resolved promise when `#isDestroyed`. Update the JSDoc and SPEC §6.3/§6.5.

### E-09 — Low — bug — a throwing `validate` escapes the property path
`bliss-element.ts:1598-1607` (`resolveFromProperty`), 1648, 1755

The attribute path wraps converter throws (373-377). The property path calls `resolveFromProperty` → `converter.validate`
without a guard. A `toCustom` validator that throws therefore:
- (a) throws out of the property setter;
- (b) throws out of the constructor, via the pre-upgrade lift (1552), so the upgrade fails;
- (c) throws out of `#refreshResponsive`, which runs inside `#flush` before the try (1943), so the flush aborts with the
  pending writes still held (or out of `#stageBatchValues`).

- Probe: `validate` throws for `'boom'` → `el.x = 'boom'` threw `validate boom`.
- Fix: one guarded `#resolveProperty(def, value)` helper that catches, warns and returns `null`, used at all three call sites.

### E-10 — Low — bug — `setAttributes()` with `shouldDefer:false` / `defer` is not one batch
`bliss-element.ts:676-691, 337-339, 581-583`

`shouldDefer = false` toggles the attribute → `attributeChangedCallback` → `release()` → `#flushNow()` inside the loop.
Keys that come after it in the object land in a second `reinit()`/`update()`. That breaks the "ONE reinit/update" contract
and, for a deferred element, the point of deferring.

- Probe: held element, `setAttributes({ shouldDefer: false, label: 'x', height: 5 })` → `reinit connect reinit`.
- Fix: apply the core properties after the inputs (or collect a "release after the loop" flag) so the release flush includes
  every key.

### E-11 — Low — bug — the pre-upgrade guard drops real attribute writes made before the first connect
`bliss-element.ts:364`

The guard is meant for the initial attribute replay only, but it applies until the first connect. An element upgraded
while detached (`customElements.upgrade(el)`, or a defined tag created in a template and kept detached) ignores
`el.setAttribute('label', 'x')` until it connects. The attribute stays in the DOM while the value differs, and there is no
warning.

- Probe: pre-upgrade `el.label = 'prop'` → define → `upgrade(el)` → `setAttribute('label','attr-later')` → after connect
  `el.label === 'prop'` while the attribute reads `attr-later`.
- Fix: end the guard after the replay instead of at connect. Clear `#preUpgradeKeys` on a microtask scheduled in the
  constructor, or delete each key on its first `attributeChangedCallback` (the replay comes before any user code can run).

### E-12 — Low — bug — `destroy()` during `connect()` / a hook leaves live subscriptions
`bliss-element.ts:453-486, 1972-1976`

`#activate` does not check `#isDestroyed` after `connect()` returns. It goes on to subscribe the environment, viewport, size
and theme on a destroyed element. Nothing ever unsubscribes them: `disconnectedCallback` returns early when destroyed, and
`destroy` is idempotent. Likewise a `destroy()` inside `reinit()`/`update()` still runs `#syncDisabled` →
`disabledChanged()` after the hook.

- Probe: `connect() { this.destroy(); }` with an `environmentChanged` override → `isDestroyed === true`, and
  `environmentChanged` still fired (subscription leaked).
- Fix: `if (this.#isDestroyed) return;` after `connect()` and after the hook call in `#flush`.

### E-13 — Low — design — writing an unchanged value is never a no-op
`bliss-element.ts:1676-1683`

Every accepted write is staged and dispatched, even when the value is identical. Frameworks that re-assign all props on each
render (React/Svelte/Vue wrappers, LiveView patches re-setting attributes) cause a full `reinit()` per render for every
`on:'reinit'` input, and an `update()` with unchanged keys for the others. SPEC §6.2 deliberately runs batch values on a
re-set, but the hook dispatch itself has no stated rule.

- Probe: `el.height = el.height` → `reinit`.
- Fix: skip staging when `Object.is(prev, next)` (still run batch values per §6.2), or document "every write dispatches" in
  SPEC §6 so components can dedupe themselves.

### E-14 — Low — bug — a throwing `disabledChanged()` on a retry flush skips activation
`bliss-element.ts:1974-1976`

`#syncDisabled` runs between the successful retry and `if (isRetry) this.#activate()`. A throw there leaves a now-built
element inactive: no `connect()`, no ready. Code reading only.
- Fix: activate before reporting the disabled flip, or use `try/finally`.

### E-15 — Low — bug — `getLiveValue` with `on:'none'` is not read-after-write
`bliss-element.ts:1588-1595`

The "stored value while staged" rule is keyed on `#pending`, but `on:'none'` writes never enter `#pending`. So
`el.x = 5; el.x` returns `getLiveValue(el)`, the old live state, as soon as the element has built. SPEC §4.1 promises the
assigned value until the write is applied. Code reading only.
- Fix: track staged-but-unapplied keys separately from `#pending`, or warn at table validation when `getLiveValue` is
  combined with `on:'none'`.

### E-16 — Low — design — gaps in the table sanity check
`bliss-element.ts:1446-1515`

- `on: 'rebuild'` (a typo, or a JS consumer) is treated silently as `update` (1679-1681).
- A configKey or `on<Name>` twin that equals a core member is not warned about. The instance accessor silently shadows the
  core one and breaks it (`form`, `validity`, `motion`, `themeSource`, `controller`, `isReady`, `release`…). Only
  `shouldDefer`, `responsive`, `responsiveCallback` and the attributes `dir`/`defer`/… are deduplicated.
- A class field named like a configKey (`isOpen = false` under `useDefineForClassFields`) replaces the instance accessor
  after `super()`. It would be cheap to detect at the first connect (`Object.getOwnPropertyDescriptor(this,key)` has
  `value`) and warn.

### E-17 — Low — duplication / missing-helper — core properties have no single table
`bliss-element.ts:120-128, 149-162, 302-312, 317-359`

Each core attribute/property (`dir`, `theme-source`, `defer`, `responsive`, `motion`) is listed separately in
`observedAttributes`, in its own `if (name === X && !this.#byAttribute.has(X))` branch, in `CORE_PROPERTY_BY_KEY`, and
(for some) in the constructor lift. They already disagree: E-04 (lift list) and E-21 (docs). One descriptor table —
`{ attribute, property, onAttribute(raw), isLifted, writeBack }` — would remove the drift and make E-01's "defer until first
connect" rule the same for all of them.

### E-18 — Low — duplication — hand-paired subscription bookkeeping
`bliss-element.ts:451-539, 516-524, 759-778`

There are 9 optional unsubscribe fields (`#envUnsub`, `#viewportUnsub`, `#sizeUnsub`, `#themeUnsub`, `#motionUnsub`,
`#responsiveUnsub`, `#responsiveEnvUnsub`, `#responsiveViewportUnsub`, `#cancelRemovalCheck`). Their stop code is
duplicated between `disconnectedCallback` and `destroy`. A small `Disposables` set (add → returns the dispose; `disposeAll()`)
would remove the duplication and make leaks like E-12 harder to write. `#flush` (48 lines, 9 concerns) and
`#refreshResponsive` (70 lines) would also benefit from being split; E-02, E-06 and E-14 all live in `#flush`'s ordering.

### E-19 — Nit — naming — `#isFormDisabled` vs `isFormDisabled`
`bliss-element.ts:278, 1229`

The private field is the browser's combined (own attribute OR fieldset) state. The protected getter with the same name is
fieldset-only. Rename the field to `#formDisabledState` or `#isBrowserDisabled`.

### E-20 — Nit — naming — mixed lifecycle vocabulary
`bliss-element.ts:879-942`

`reinit/update/connect/disconnect/destroy` sit next to `removedCallback`/`destroyCallback`. The house rule says `*Callback`
means state-affecting hooks; these two are lifecycle hooks like `connect()`. Also `destroy()` vs `destroyCallback()` reads
like a public/consumer callback pair. Consider `removed()`/`destroyed()`, or record the exception in the rulebook.

### E-21 — Nit — docs-drift
- 10-12: the header says a class without inputs gets "`dispatch`/`define` (web-grid's use)". web-grid now has a table
  (CLAUDE.md), and the API is `emit`.
- 671-672: the `setAttributes` JSDoc lists the core properties without `motion`, which the map accepts (127).
- 612-613: `whenReady` "Never rejects — a throwing first build keeps it pending until a later flush succeeds" does not
  hold for a throwing `connect()` (E-03) or `destroy()` (E-08).
- 577-583: after the first build `shouldDefer = true` sets the attribute and the getter reports `true` although nothing is
  deferred. For a pre-upgrade `shouldDefer` on a never-connected element the getter reports `false`. Document this, or make
  the getter reflect the gate state.

### E-22 — Nit — design
- 19-41: `ABSENT_ATTRIBUTES`, `isSameValue` and `describeValue` are declared between two import blocks.
- 1573-1576: assigning a non-function (string, object) to an `on<Name>` twin silently clears the handler. Input converters
  warn on invalid values; twins should too (`null`/`undefined` clear silently).
- 736: `whenSettled()` on a never-connected element with no writes resolves immediately, although the first build is still
  owed (`#pendingReinit` is set only at connect). Inconsistent with "detached writes wait for connect". It is documented as
  "nothing pending", but it surprises in tests (`createElement` → `await whenSettled()` → nothing built).

### E-23 — Medium — test-gap — scenarios not covered
Unit (jsdom):
1. An invalid core attribute (`motion="bogus"`) in markup before input attributes, then upgrade (E-01).
2. A retry `reinit()` that calls `this.flush()`; also `flush()` / `release()` / `destroy()` called from inside
   `reinit()`/`update()`/`connect()` (E-02, E-12).
3. A throwing `connect()`, and a throwing immediate `environmentChanged` → ready / whenReady / subscriptions (E-03).
4. Pre-upgrade `motion`, `themeSource`, and event twins (`onReady`) — only inputs and `shouldDefer` are tested (E-04).
5. `whenReady()` before/after `destroy()` (E-08). `destroy()` while held (deferred) and while detached with pending writes.
6. Throwing `validate` / `toAttribute` on the property, batch-value, deferred-reflect and responsive paths (E-06, E-09).
7. `setAttributes` with `shouldDefer:false` mixed with inputs (E-10). `setAttributes` with `motion` / `theme-source`.
8. Attribute writes between `customElements.upgrade()` and the first connect (E-11).
9. A failed `update()` followed by recovery (E-07 — whatever behaviour gets chosen).
10. `whenSettled()` resolution when the hook itself stages more writes. Verified by reasoning to be fine, but it is
    unpinned and depends on the scheduler's microtask order.
11. `themeSource` set to an `Element` vs a string, plus switching while connected; `motion` attribute round-trip and the
    page-level `observePageMotion` unsubscription on disconnect/destroy.
12. A DOM move between documents (`adoptNode` into an iframe document): motion styles adopted into the new root, the
    removal check.

e2e (real browser; these semantics differ from jsdom and nothing pins them):
1. The pre-upgrade property vs initial attribute guard and the reflect-during-upgrade swallow (E-01/E-04/E-11). Only jsdom
   tests exist, and the guard relies on the browser's element reaction queue order.
2. Appending a form-associated element into a `<fieldset disabled>` and moving it between fieldsets: hook order
   (`formDisabledCallback` vs `connectedCallback`) and `isEffectivelyDisabled` inside the first `reinit()` (E-05).
   `forms.spec` FO02 toggles an existing fieldset only.
3. `:state(ready)` matching in Chromium, and `removedCallback` timing in a hidden tab (setTimeout fallback).
4. `<form>` reset / restore: `formResetCallback` / `formStateRestoreCallback` are not provided by core. Confirm whether that
   is intended (SPEC §6.6 is silent).

# Core code review — 2026-11-03

A cold review of `@keenmate/web-components-core` at `cfca3df` (rc18 work in progress), done as if the reviewers knew nothing beyond the package's purpose. Six reviewers each took one slice. Each read the code first, then confirmed suspected bugs with throwaway vitest probes, which were deleted afterwards. No source file was changed. The two most serious findings (E-01, L-01) were reproduced again independently while this summary was being merged.

**Detailed reports** (failure scenario, probe and suggested fix for every finding): [`2026-11-03/`](2026-11-03/)

| Slice | Report | Findings |
|---|---|---|
| `BlissElement` (`src/element/bliss-element.ts`) | [01-element.md](2026-11-03/01-element.md) | E-01 … E-23 |
| inputs, converters, responsive, events, before-callbacks | [02-inputs.md](2026-11-03/02-inputs.md) | I-01 … I-18 |
| environment, theme, motion, element-size, global, overlay | [03-environment-overlay.md](2026-11-03/03-environment-overlay.md) | V-01 … V-19 |
| dom helpers, positioning | [04-dom-positioning.md](2026-11-03/04-dom-positioning.md) ⚠ its line numbers are wrong; the corrected ones are below | D-01 … D-29 |
| actions, menu, search | [05-actions-menu-search.md](2026-11-03/05-actions-menu-search.md) | A-01 … A-27 |
| logging, cem, testing, public API, coverage map | [06-logging-cem-api.md](2026-11-03/06-logging-cem-api.md) | L-01 … L-25 |

**Totals:** about 135 findings: 6 High, about 45 Medium, about 60 Low, the rest Nit. One test-gap list per slice.
**Confirmed:** about 75 were reproduced with a probe. The rest come from reading the code or need a real browser; each one is marked in its report.

---

## 1. The six High findings

| ID | Where | What happens | Status |
|---|---|---|---|
| **E-01** | `element/bliss-element.ts:347-358` | An invalid `motion` attribute in markup wipes out every input attribute after it during upgrade. The write-back runs inside `#withoutReflect`, and the browser's attribute-reaction replay for the remaining attributes runs while `#reflecting` is true, so those calls are dropped. `<x motion="bogus" label="hi">` → `label === ''`. | Confirmed (twice) |
| **V-01** | `environment/environment.ts:474-483` (+ `bliss-element.ts:459-472`) | `subscribe()` fires the listener before returning the unsubscribe. If that first call throws, the listener stays subscribed for good. In `BlissElement`, a throwing first `environmentChanged()` leaks 5 media-query listeners, skips the theme/size/viewport subscriptions, and `ready` / `whenReady()` never fire. | Confirmed |
| **A-01** | `menu/open-menu.ts` (submenu open) | Hovering a submenu whose children all resolve hidden creates its `anchor()` (with live `autoUpdate`) after `collapseFrom` has already run. The anchor is never destroyed, and it leaks again on every hover. | Confirmed |
| **D-01** | `dom/render-loader.ts:137-141` | `remove()` works out "nodes the loader added" when it runs, not when the loader was rendered, so it also deletes the component's own rows (or a second loader) appended after the loader was drawn. | Confirmed |
| **D-02** | `positioning/popover.ts:72`, `positioning/tooltip.ts:71` | The default container is `document.body`. Inside a modal `<dialog>` (top layer) the portaled panel renders under the dialog and is inert, so dropdowns and tooltips are unusable in modals. | Needs a browser (follows from the top-layer spec) |
| **L-01** | `logging/global-logging.ts:59-62` | `window.components.logging.setLogLevel('verbose')` stores the bad level before checking it. From then on, every later `createLoggers()` throws at module eval, so any lazily loaded component, from any copy of core, fails to load. | Confirmed (twice) |

---

## 2. Cross-cutting themes

The findings cluster into a few root causes. Fixing each root cause once is cheaper and safer than fixing about 135 items one by one.

### T1 — Throwing user code wedges or leaks (the biggest class)

Core calls component hooks, listeners and callbacks without a consistent "isolate and log" policy. Some paths catch errors (the attribute path, theme, environment fan-out). Others don't, and those leave half-applied state behind.

| ID | Sev | Path |
|---|---|---|
| V-01 | High | first call to an environment/viewport listener (above) |
| E-03 | Med | a throwing `connect()`: no `ready`, no subscriptions until a DOM move |
| E-02 | Med | a retried `reinit()` that calls `this.flush()` recurses without bound |
| E-06 | Med | a throwing `toAttribute` in the deferred-reflect loop skips the first build; `whenSettled()` hangs |
| E-07 | Med | a throwing `update(partial)` loses its keys, so `config` and the DOM drift apart |
| E-12 | Low | `destroy()` called from inside `connect()` or a hook still subscribes |
| E-14 | Low | a throwing `disabledChanged()` on a retry flush skips activation |
| E-09 | Low | a throwing `validate` escapes the property setter, the pre-upgrade lift and the responsive refresh |
| I-06 | Low | `toObject` / `toValue` reflection throws on circular data or BigInt after the value is already applied |
| V-06 | Med | `element-size.ts:454-470` — one throwing size listener stops the whole ResizeObserver fan-out |
| V-07 | Low | `motion.ts:79-85` — one throwing page-motion listener stops the rest and throws at the assigner |
| D-05 | Med | `dom/microtask-scheduler.ts:20-25` — a throwing task drops the rest of the batch; it's a public export |
| D-14 | Low | `positioning/anchor.ts:164` — no `.catch` on `computePosition`, so callback errors become unhandled rejections |
| A-15 | Low | a rejected `runAction` on a close-on-click menu item is an unhandled rejection; `runAction` rejects if `emitAction` throws |
| A-16 | Low | a throwing `closeCallback` propagates out of `handle.close()` and out of document listeners |
| I-04 | Med | `runBeforeCallbackSync`: an async guard returning `false` is treated as "continue"; a rejected Promise is unhandled |
| L-01 | High | an invalid level poisons the page (above) |

**Missing helper:** a single `notifyAll(listeners, value, logCtx)` / `safeInvoke(fn, …)` that every fan-out uses: a throwing listener is logged through `coreLog` and the rest still run. `BlissElement`'s activation also needs one rule: a throwing hook never blocks `ready`, the remaining subscriptions, or the balancing teardown.

### T2 — State that is still per copy of core

Same class of bug as the `ALL_GROUPS` / scroll-lock / breakpoints fixes that just went in.

| ID | Sev | What |
|---|---|---|
| V-02 / L-11 | Med | `global/instances.ts:13` — the live-instance registry is a module `Map`, so `getInstances()` / `getRegisteredTags()` only see the importing copy. `logger-registry.ts` `BY_TAG` has the same problem. |
| V-03 | Med | `global/register-component.ts:110-130` — a second copy registering an already-defined tag silently replaces `window.components[tag]`: wrong `version()`, `getInstances()` returns `[]`, `logging` is removed, no warning. |
| D-03 / D-19 | Med/Low | `dom/adopt-styles.ts:23-25` — each copy keeps its own "already adopted" map and never checks the root, so a sheet dropped by an `adoptedStyleSheets` reassignment is never re-adopted, and each bundled copy adopts MOTION/MENU CSS again. A sheet cached for one document throws `NotAllowedError` in an iframe. |
| L-02 | Med | `logging/log-core.ts` `setLogPersistKeyPrefix` is a module variable. CORE loggers read storage at import, so the prefix never reaches them (they read the old key and write the new one). |
| L-09 | Med | one CORE logging bundle per copy: `coreLogging.setCategoryLevel` only reaches its own copy. |
| L-12 | Med | `testing/fixtures.ts` — `uniqueTag`'s counter is per copy (two copies both hand out `bliss-test-0`), and `defineOnce` silently accepts a different constructor. |
| V-08 | Low | a page that replaces `window.components` after load loses the live `motion` / loader / responsive accessors. |
| L-10 / V-17 | Med | the `globalThis[Symbol.for(key)]` state pattern is hand-written 7 times with 3 key styles, and only theme's key carries a version. With components on mixed rc versions, the first-loaded core decides the state's shape for every copy. |

**Missing helper:** `sharedState<T>(key, version, init)` (one key scheme, `@keenmate/web-components-core:<name>@<shape-version>`). Add `publishPageSetting(name, …)` for the non-enumerable `window.components.*` accessors; today that is written 4 times with 4 different behaviours (L-18). Then move every module-level registry onto it.

### T3 — Upgrade and attribute ordering

| ID | Sev | What |
|---|---|---|
| E-01 | High | (above) |
| E-04 | Med | `motion` / `themeSource` assigned before upgrade are never lifted; the own property hides the accessor for good |
| E-11 | Low | the pre-upgrade guard also drops real `setAttribute()` calls made after upgrade but before the first connect |
| E-05 | Med | a `formDisabledCallback` before the first connect runs `update()` before `reinit()` (simulated; real-browser order unverified) |
| E-10 | Low | `setAttributes({ shouldDefer:false, … })` builds twice |
| E-17 | Low | core-owned properties (`motion`, `themeSource`, `shouldDefer`, `responsive*`, …) are listed in 4 places with no shared table, and they have already drifted (E-04) |

**Missing helper:** one internal table of core-owned properties and attributes (name, attribute, parse, lift-pre-upgrade, setAttributes support). It drives `observedAttributes`, `attributeChangedCallback`, the pre-upgrade lift and `setAttributes`.

### T4 — Lifetime and leaks

A-01 (High, above), D-07 (tooltip whose trigger is removed while visible stays mounted with `autoUpdate` running), D-16 (`show()` still works after `destroy()`; `popover.destroy` depends on `this`), E-08 (`whenReady()` never resolves after `destroy()`), E-12, L-15 (the logging bundle set and perf spans grow without bound), V-16 (dead `active` map in `active-overlay.ts`).

**Missing helper (internal):** a subscriptions bag (`this.#subs.add(unsub)` / `.disposeAll()`) instead of 9 hand-paired unsubscribe fields (E-18).

### T5 — Converters: lenient and inconsistent parsing

| ID | Sev | What |
|---|---|---|
| I-02 | Med | `toInt` / `toFloat` accept trailing junk silently: `"12px"`→12, `"1.9"`→1, `"1e3"`→1, `"0x10"`→0, `"1,5"`→1. The attribute path accepts `"Infinity"` but the property path rejects it. |
| I-01 | Med | plain `toEnum(values)` turns a missing attribute into `null`, so a row `default` never applies and the dead-default check (which skips `null`) never warns. `el.x = null` is rejected. |
| I-09 | Low | `toText`: attribute `""` resets to the default but property `""` is rejected; `shouldTrim` only applies to attributes |
| I-10 | Low | `toList`: no escaping; `[]` reflects `""`, which re-parses to the default; `"   "` → `['']` |
| I-11 | Low | `toBytes` accepts `"1.2.3mb"` but has no `k/m/g/t` units, so dropzone forked its own parser |
| I-12 | Low | trim and case rules differ per converter (`toEnum` is case-sensitive and untrimmed while `toBool` trims and lowercases; `shouldTrim` defaults differ) |
| I-07 | Low | `shouldNullOnInvalid` no longer nulls anything; it now just means "nullable" |
| I-08 | Low | no reset-to-default by property; `undefined` is handled differently per converter; a property-only input stays "explicit" for good, so page responsive rules can't reach it again |
| I-13 | Low | assigning a non-function to an `on<Name>` twin silently clears it |
| I-14 | Low | `clearableConfigKeys` has no consumers in any component and misclassifies `toValue` / `toCustom` |

**Proposal:** one documented parsing contract for all converters (trim always; numbers must be the whole string; case-insensitive enums; `''` handled the same way on both paths), plus a property-path reset (`el.x = undefined` → default).

### T6 — Overlay, menu, popover and tooltip interaction model

| ID | Sev | What |
|---|---|---|
| V-09 | Med | no nesting: a child overlay (a context menu inside a dropdown, same group) dismisses its parent; there's no shared "Escape closes only the topmost" stack and no focus-restore helper |
| D-09 | Med | `popover` has no outside-click / Escape / overlay-group dismissal, so every component and `/menu` writes its own |
| D-08 | Med | tooltip: no `aria-describedby`, no Escape, can't hover onto it; mouseleave hides it while the trigger still has focus |
| D-10 | Med | the `popover` preset silently drops object `offset`, `maxHeight`, `maxWidth`, `flipPadding`, `arrow`, `autoUpdateOptions`, the fixed-CB option and the callbacks |
| A-03 | Med | the menu's document-capture keydown swallows Enter/Space/arrows/Home/End and fires letter shortcuts even when focus is in an unrelated input; Tab anywhere closes a pinned menu |
| A-02 | Med | inside a `renderMenu` custom menu, Tab closes the menu, so a custom form with 2+ fields is unusable |
| A-05 | Med | no RTL: submenus always open `right-start`, and → / ← are not mirrored |
| A-08 | Med | no submenu hover intent: crossing a sibling on the way to a submenu collapses it |
| A-10 | Low | with two menus open, one Escape closes both (`stopPropagation` instead of `stopImmediatePropagation`); pinned menus skip the overlay group |
| A-09 | Low | a keep-open refresh that hides every root item leaves an empty menu box open |
| A-21 / A-22 | Nit | disabled items can't be reached by keyboard; menu levels have no accessible name; a loading submenu has no `aria-busy` |
| V-12 | Low | `dismissAllOverlays(undefined)` dismisses only the ungrouped group, while a call with no argument dismisses every group |
| V-11 | Low | the pinned scroll lock removes the desktop scrollbar with no padding compensation, so content shifts sideways |

**Proposal:** one overlay stack in `/overlay` (shared page-wide; push/pop, a parent/child relation, Escape and outside-click routed to the topmost, focus restore). `popover`, `tooltip` and `/menu` all join it. This is a design decision; see §5.

### T7 — Security and text handling

| ID | Sev | What |
|---|---|---|
| **A-04** | Med | `search/highlight.ts` `wrapRanges` on "trusted HTML" puts `<mark>` inside entities and tags. The default `escape` does nothing, so the documented `wrapRanges(r.text, r.ranges)` is an **XSS path**, and core ships no HTML escaper. |
| A-14 | Low | `case-insensitive` only lowercases: `İstanbul` doesn't match `istanbul`, `Straße` doesn't match `STRASSE` |
| A-13 | Low | stripping every combining mark (`\p{M}`) wipes Indic vowel signs (`किताब` == `कतब`); ligatures, full-width forms and NBSP aren't folded |
| A-11 / A-12 | Low | word boundaries are checked per UTF-16 code unit; regex highlights split surrogate pairs (no `u` flag) |

**Missing helper:** `escapeHtml()`. `wrapRanges` should escape by default; trusted HTML needs a separate API that maps text offsets to DOM ranges.

### T8 — Positioning correctness

| ID | Sev | Where | What |
|---|---|---|---|
| D-06 | Med | `positioning/containing-block.ts:161` | the drift culprit is searched from the reference, not the panel, so a portaled panel's containing block is never found |
| D-04 | Med | `dom/scroll-container.ts:154` | `stopAt` with no inner scroller falls back to `el.scrollIntoView()`, which moves the outer scroller and the page |
| D-11 | Med | `dom/scroll-container.ts:154-159` | the `scrollIntoView` fallback still scrolls `overflow:hidden` clip wrappers (needs a browser) |
| D-12 | Low | `containing-block.ts` (composed walk) | the walk skips the slot, so a slotted floating element misses a transformed wrapper around the slot |
| D-13 | Low | `containing-block.ts` | the fixed-CB option ignores the top layer (`:popover-open`, `:modal`) |
| D-17 | Low | `anchor.ts:29-33` | theme inheritance copies only `data-theme`, once, and never clears it; core's `readThemeSignal` also handles `data-bs-theme` and `.dark` / `.light` |
| D-18 | Low | `scroll-container.ts:101,167-170` | `scroll-padding: 10%` is read as `10px` |
| D-23 / D-24 | Low | `containing-block.ts:39-62, 84-100` | `contain: paint/layout` is ignored; a culprit with a 2px+ border is missed (border box vs padding box) |
| D-25 | Low | `anchor.ts` | `driftCallback` with `strategy:'absolute'` reports drift on every frame |
| D-27 | Nit | `anchor.ts:47` | the arrow offset uses `offsetWidth` for left/right placements (should be `offsetHeight`) |
| D-15 | Low | `tooltip.ts:99-125` | follow-cursor: a focus or `show()` reuses the stale cursor position |
| D-20 / D-22 / D-26 | Low/Nit | `adopt-styles.ts`, `css-var-lint.ts:22,31`, `throttle.ts:20-37` | the style slot's `'last'` position doesn't win the cascade as documented; the var-lint regex cuts at `_` / non-ASCII, counts names in comments, and folds case; throttle uses `Date.now()` |

### T9 — Responsive, environment and motion edge cases

I-05 (responsive overrides skip `getBatchValuesCallback`, so a rule setting `mode` doesn't set the inputs that mode implies), I-15 (a responsive `isDisabled` never reflects, so the host isn't natively disabled), I-16 / I-17 (validation written twice; the page-map warning repeats per element), V-04 (`<html data-motion>` does nothing unless some BlissElement lives in that root), V-05 (`classifyDevice` uses `innerHeight`, so an on-screen keyboard can flip a landscape tablet to `mobile`), V-10 (the page-wide motion level beats a nearer `<section data-motion>`), V-13 (breakpoint tokens are read and locked in before lazy CSS applies), V-14 / V-15 (keyboard-inset and element-size robustness).

### T10 — Actions

A-06 (Med: a labelled divider at the top, i.e. a group heading, is dropped), A-07 (Med: the busy guard is keyed only on the item object, so one instance blocks another and string items are never guarded), A-17 (an `aria-busy` the trigger already had is removed), A-18 (a value returned by `beforeActionCallback` is ignored, unlike the generic before-callback contract), A-19 (`runAction` doesn't check `isDisabled`), A-20 (no `isToggle` on `ResolvedActionItem`), A-25 (a `null` item throws).

### T11 — CEM generator

L-04 (Med: the preset excludes `**/index.ts`, where every component calls `registerComponent()`, so tag recognition never fires and components duplicate `customElements.define`), L-05 (Med: data merged by bare class name across modules), L-06 (Med: type/default inference gaps — `toList` itemType, `toBool` / `toText` / `toEnum` defaults, missing `| null`), L-07 (Med: spread rows, class expressions, `static get inputs()` and subclasses with no own table are silently skipped), L-08 (Med: manifests lack core's own public API — `release`, `destroy`, `whenReady`, `whenSettled`, `flush`, `validity`, …), L-19 (multi-line `//` comments and JSDoc tags are lost).

### T12 — Logging

L-01 (High), L-02, L-09 (T2), L-03 (Med: instance debug/trace go to `console.debug`, which Chrome hides by default), L-14 (`Logger.setLevel()` persists to localStorage by default with no public clear), L-16 (instance `disableLogging()` only clears the override, while the bundle-level one silences), L-17 (three level normalizers that disagree), L-23 (a top-level `createLoggers('CORE')` side effect under `sideEffects: false`).

---

## 3. Naming conventions

House rules: booleans use an `is/should/has/can` prefix. A `*Callback` suffix marks a state-affecting hook (it can veto or replace). Events and notifications get no suffix.

| Problem | Where | Proposal |
|---|---|---|
| Notification-only hooks named `*Callback` | `closeCallback` (menu), `objectTermCallback` (search), `placedCallback`, `computedCallback`, `driftCallback` (positioning) | rename to `onClose`, `onPlaced`, … or document an exception for imperative-API options (decide once) |
| Hooks that do affect state but lack the suffix | `renderItem`, `renderMenu`, `prepareItem`, `defaults` (menu) | add `*Callback`, or document that render hooks are exempt |
| Same concept spelled two ways | `renderLoadingCallback` (instance) vs `renderLoaderCallback` (page-wide) | pick one |
| A name that no longer describes the behaviour | `shouldNullOnInvalid` (it now means "nullable") | `isNullable` |
| Same name, two meanings | instance `disableLogging()` (clears the override) vs bundle `disableLogging()` (silences) | make the instance one silence, and add `resetLogging()` |
| Private vs protected clash | `#isFormDisabled` (combined state) vs `isFormDisabled` (fieldset only) | rename the private one `#isEffectivelyDisabledCache` or similar |
| Internal booleans without the prefix | `flipEnabled`, `frozen`, `open`, `visible`, `constructableOk`, `useFixedCB` | prefix them (internal, no API impact) |
| Mixed lifecycle vocabulary | `removedCallback` / `destroyCallback` vs `connect` / `disconnect` / `reinit` | document the rationale (the platform `*Callback` vs component hooks) or align |
| Verb-less factory | `menuDivider()` | `createMenuDivider()` or keep it as a value constant |
| Pre-`labels` leftovers | `loadingText` (menu) | move to `labels` |
| Wrong SPEC references | `actions/index.ts:4`, `resolve.ts:176`, `types.ts:22` cite §12.11 (Search); Actions is §12.12 | fix |
| Inconsistent shared-state keys | `km-scroll-lock`, `km-overlay-all-groups`, `@keenmate/web-components-core:breakpoints`, … | one scheme via `sharedState()` (T2) |

---

## 4. Missing helpers (collected)

| Helper | Replaces / fixes | Public? |
|---|---|---|
| `sharedState(key, version, init)` | 7 hand-written `globalThis[Symbol.for]` states (T2, L-10) | internal (maybe public for pure-css) |
| `publishPageSetting(name, …)` | 4 different `window.components.*` publishers (L-18, V-08) | internal |
| `notifyAll` / `safeInvoke` | every unprotected fan-out (T1) | internal |
| a subscriptions bag | 9 hand-paired unsubscribe fields in BlissElement (E-18) | internal |
| a core-owned properties table | 4 drifting lists (E-17, E-04) | internal |
| `hasDom()` | about 25 inline `typeof document` checks; `hasDom` / `hasDocument` both exist (L-25) | internal |
| `parseJsonAttribute(raw, warn)` | duplicated JSON parse-with-warn (I-16, L-25) | internal |
| `escapeHtml()` + safe `wrapRanges` | the XSS path (A-04) | **public** |
| overlay stack + `restoreFocus()` | nesting, Escape routing, per-component dismissal (V-09, D-09, A-10) | **public** |
| `popover` dismissal options (`shouldCloseOnOutsideClick`, `shouldCloseOnEscape`, `overlayGroup`) | every component and `/menu` writing its own (D-09) | **public** |
| `isToggle` on `ResolvedActionItem` | the menu-only computation (A-20) | **public** |
| `toBytes` units (`k/m/g/t`, `kb/mb`, binary) | dropzone's fork (I-11) | **public** |
| `/testing`: `captureConsole()`, `resetPageState()`, `waitForEvent()` / `spy.next()` | helpers every component suite re-implements (L-13) | **public** |

---

## 5. Test coverage

There is no coverage provider installed, so the map is reasoned from imports (see [06 § coverage map](2026-11-03/06-logging-cem-api.md#test-coverage-map)). Every slice has a test-gap section with concrete scenarios. The common patterns:

1. **Throwing paths are almost entirely untested.** No unit test covers a throwing `connect()`, `update()`, `validate`, `toAttribute`, listener, scheduler task, `closeCallback` or `runAction`. This is where most of the bugs in T1 live.
2. **Cross-copy tests exist only for the three modules fixed this week.** `vi.resetModules()` + re-import should be a standard test for every module holding page state: instances, register-component, logging, adopt-styles, motion listeners, theme observers, responsive page rules, and `uniqueTag`.
3. **Upgrade-order behaviour is tested only in jsdom.** E-01 / E-04 / E-11 / E-05 depend on the browser's custom-element reaction queue and need e2e fixtures: markup with an invalid core attribute first, pre-upgrade `motion` / `themeSource` / `onReady`, appending into a `<fieldset disabled>`.
4. **Converter edge cases.** Numbers (`"12px"`, `"1.9"`, `"1e3"`, `" 5 "`, `"Infinity"`), `toList` round-trips, `toBytes` units, `toText` `''`. `inputs.spec.ts` has no numeric, list or bytes cases at all; `nullclear.spec.ts` has 2 tests.
5. **The constructable-stylesheet path never runs** (jsdom always takes the `<style>` fallback). It needs a fake `CSSStyleSheet` in unit tests, or an e2e check.
6. **Browser-only positioning:** popover/tooltip in `dialog.showModal()`, a transform/contain ancestor with `driftCallback`, `freeze` while scrolling, arrow after a flip, `matchWidth`, `maxHeight`, a tooltip in a shadow root.
7. **Menu interaction:** RTL, hover intent, custom `renderMenu` + Tab, focus in an unrelated input, two concurrent menus, all-hidden submenu (A-01).
8. **Search i18n:** Turkish `İ`, `ß`, astral letters, combining marks, NBSP, highlight on HTML labels.
9. **CEM:** `cem/config.ts` has no test. Missing: same class name in two modules, spread rows, class expressions, `static get inputs()`.
10. **SSR:** nothing imports the modules with `window` / `document` undefined. Add a node-environment vitest file that imports every entry point.
11. **Public exports with no direct unit test:** `resolveFromAttribute`, `resolveFromProperty`, `withComponentContext`, `dom/composed-tree.ts`.

Suggested infra: add `@vitest/coverage-v8` (devDependency) with a `npm run test:coverage` script, so later reviews can measure coverage instead of reasoning about it.

---

## 6. Packaging and docs

- L-22: `/cem` types import `typescript`, but it isn't declared as an optional peer dependency. There is no `engines` field and no `./package.json` export, and `CemPackageDoc` isn't exported.
- L-23: import-time side effect (`createLoggers('CORE')`) under `sideEffects: false`.
- L-24: about 60 runtime exports aren't in the README; `src/cem/CLAUDE.md`'s core-declared list omits `motion`.
- E-21, V-18, D-20, A-24: stale headers and JSDoc. `observeEnvironment` docs say it fires on viewport-size changes, but it doesn't. "One page-wide ResizeObserver" is really one per copy. The registry doc says "neither can clash". The SPEC section numbers are wrong.
- E-23(4): SPEC §6.6 doesn't say that components own `formResetCallback`. The components already implement it, so this is docs only (see the decision in §7).

---

## 7. Proposed fix order (for the plan)

1. **rc18 blockers (safe, no API change):** E-01, V-01, L-01, D-01, A-01, D-05, plus the rest of T1 behind a `notifyAll` / `safeInvoke` helper. Each fix gets its regression test.
2. **Cross-copy state (T2):** add `sharedState()` + `publishPageSetting()`, then move instances, register-component, adopt-styles, the logging prefix and the CORE bundle, and `uniqueTag` onto them, each with a `vi.resetModules()` test.
3. **Upgrade ordering (T3):** the core-owned properties table; fixes for E-04, E-11, E-10; e2e fixtures for the reaction-queue cases.
4. **Converter contract (T5):** may change behaviour for odd markup (`"12px"` becomes invalid). Decide before rc18 or hold it for 1.0.
5. **Security (A-04):** `escapeHtml` and a safe `wrapRanges` default.
6. **Positioning and DOM correctness (T8),** plus D-02 (dialog / top layer) and D-10 (popover option forwarding).
7. **Overlay stack and interaction model (T6):** the largest design item; needs a short SPEC section first.
8. **CEM (T11), logging (T12), naming (§3), docs (§6):** the renames are breaking, so do them while core is still in rc.
9. **Test infrastructure:** coverage provider, SSR import test, cross-copy test template.

### Decisions needed from you before planning

- ~~Converter strictness (T5)~~ **DECIDED 2026-11-03: strict in rc18.**
  - `toInt` / `toFloat` (and `toBytes`, `toList` int items) must match the whole string. Junk (`"12px"`, `"1.9"` for an int, `"1e3"`, `"0x10"`, `"1,5"`) warns and keeps the previous value, so the attribute and property paths agree.
  - **New `toCssLength()` converter** for values only passed to CSS: a bare number becomes px, a length string is checked with `CSS.supports('width', v)` (regex fallback for SSR / jsdom), and an invalid value warns and keeps the previous one.
  - No runtime rem→px resolver.
  - Follow-up per component (not core): audit size-like inputs. Values used in math stay `toInt` and their docs say "pixels"; values only written to a style or CSS variable move to `toCssLength`. Candidates: ms `badge-height`, `virtual-scroll-item-height`, `*-tooltip-offset`; treeview `tooltip-offset`, `context-menu-*-offset`, `drop-zone-max-width`, `virtual-scroll-item-height`.
- ~~`*Callback` on notifications (§3)~~ **DECIDED 2026-11-03: rename to `on*`, no aliases (BREAKING note).**
  - `closeCallback` → `onClose`, `placedCallback` → `onPlaced`, `computedCallback` → `onComputed`, `driftCallback` → `onDrift`, `objectTermCallback` → `onObjectTerm`.
  - One rule for the whole library: `on*` means you're told; `*Callback` means you decide (cancel / replace / provide).
  - The same rule applied the other way: the menu's value-returning hooks gain the suffix (`renderItem` → `renderItemCallback`, `renderMenu` → `renderMenuCallback`, `prepareItem` → `prepareItemCallback`), matching `renderLoadingCallback`.
  - Components update their 11 call sites in their next pass.
- ~~Overlay stack (T6)~~ **DECIDED 2026-11-03: build it in core, as a recursive tree** (modal → dropdown → context menu → submenu, any depth).
  - **Step 1 (rc18):** a parent relation in the `km-overlay-activate` protocol. It's backwards compatible: an overlay that doesn't name a parent behaves exactly as today.
  - **Step 2 (after a SPEC section):** Escape / outside-click routing and focus restore through the page-wide stack (shared state). `popover` / `tooltip` / `/menu` join via `shouldCloseOnEscape`, `shouldCloseOnOutsideClick`, `overlayGroup`.
  - The rules:
    1. The parent is found automatically: the nearest open overlay whose panel contains the trigger (composed walk across shadow roots and portals). An explicit parent overrides it.
    2. Opening never dismisses ancestors. Group exclusivity applies to everything except the new overlay's ancestors.
    3. Escape closes only the deepest open overlay, one level per press.
    4. An outside click closes everything above the overlay that was clicked (outside everything → the whole chain).
    5. Closing a parent closes its subtree, deepest first. Focus returns to the opener of the overlay that remains on top.
  - The pure-css modal registers as an overlay, so it becomes the parent automatically.
- ~~D-02 dialogs~~ **DECIDED 2026-11-03: A now, B later.**
  - **A (rc18, no API change):** the default container becomes the nearest open modal `<dialog>` / `:popover-open` around the trigger (composed walk), else `document.body`. This applies to popover, tooltip and menu.
  - **B (later, opt-in `strategy: 'top-layer'`):** the Popover API (`popover="manual"`), built on the overlay stack's open order.
- ~~`formResetCallback` / `formStateRestoreCallback`~~ **DECIDED 2026-11-03: no core change.** E-23(4) was a core-only view. The form-associated components already implement the platform `formResetCallback` directly: multiselect resets to the markup's `selected` options, daterangepicker to its `value` attribute, dropzone clears its files. Treeview and grid aren't form-associated. Action: SPEC §6.6 notes that components own `formResetCallback`, and that `formStateRestoreCallback` is intentionally absent (hidden-input convention, no `setFormValue` state).

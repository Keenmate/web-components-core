# Changelog

All notable changes to `@keenmate/web-components-core` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **`dismissAllOverlays()` now reaches every component.** `ALL_GROUPS` was a plain `Symbol()`, so
  each bundled copy of core had its own wildcard and a dismiss from one component (e.g. the
  command palette) didn't close another's dropdown. It is now `Symbol.for('km-overlay-all-groups')`.
  Reported by pure-css.
- **`lockBodyScroll()` shares one lock across components.** The ref count and the saved body
  style were module variables, so two components with their own copies of core could unlock
  each other: closing a multiselect sheet restored page scroll under an open date picker. The
  state now lives on `globalThis[Symbol.for('km-scroll-lock')]` (exported type `ScrollLockState`),
  a documented shape pure-css can join.
- **`configureBreakpoints()` applies to every component.** The breakpoint table was a module
  variable, so a call through the app's copy of core left every component's own copy on
  768 / 1024. The table is now shared on `globalThis`, and the call fires `km-breakpoints-change`
  on `document` (new export `BREAKPOINTS_CHANGE_EVENT`) so components already watching the
  environment re-resolve their breakpoint.
- **An invalid `motion` attribute no longer wipes out the attributes after it.** With
  `<x motion="bogus" label="hi">` in markup, writing back the kept level drained the browser's
  queue of the remaining initial attributes while the reflect guard was on, so `label` and every
  later attribute were dropped at upgrade. The guard now skips only the attribute core is writing.
  The same applies to any write-back or reflection during upgrade.
- **Code that throws no longer leaves an element half-activated.** A throwing `connect()` or first
  `environmentChanged()` / `viewportChanged()` / theme hook used to skip the remaining
  subscriptions and the `ready` announcement (`whenReady()` hung), and a throwing first
  environment listener leaked the page's shared media-query listeners. Activation now runs every
  step, announces `ready`, and rethrows the first error afterwards. Also:
  - a `flush()` called from inside `reinit()` / `update()` is a no-op (a retried `reinit()` that
    called it recursed without bound);
  - the keys of an `update(partial)` that threw are applied again on the next flush;
  - a converter whose `toAttribute` throws (circular data, BigInt) leaves the attribute alone
    instead of throwing out of the setter or skipping the first build;
  - a `validate` that throws counts as an invalid value (warn, keep the previous one);
  - `destroy()` called from inside `connect()` or a hook stops the rest of the activation;
  - `whenReady()` settles when the element is destroyed before it was ready;
  - a throwing `disabledChanged()` on a retried build no longer skips activation.
- **One throwing listener no longer silences the others:** `observeEnvironment` / `observeViewport`
  (including the immediate first call, which now never leaks the subscription),
  `observeElementSize`, page-wide `window.components.motion`, and the microtask scheduler, which
  used to drop every task after a throwing one in the same batch.
- **`window.components.logging.setLogLevel('verbose')` no longer breaks the page.** The bad level
  was stored before it was checked, so every component loaded afterwards (from any copy of core)
  threw at import. It now throws at the call, and nothing is stored. A bad level left by an
  older copy is ignored. New export: `isLogLevel()`.
- **`renderLoader()`'s `remove()` keeps nodes added after the loader.** It worked out "what the
  loader added" when `remove()` ran, so rows the component rendered before removing the loader,
  or a second loader, were deleted too. It now removes only what the render added.
- **Menus:** hovering a submenu whose children are all hidden no longer leaks its positioning
  (a live `autoUpdate` per hover). A rejected `runAction` on an item that closes the menu, and a
  throwing `closeCallback`, are logged instead of escaping.
- **`runAction()`:** a throwing `action` event handler is logged and `runAction` still resolves
  `true`; an `aria-busy` the trigger already had is put back afterwards.
- **`anchor()`:** a throwing `placedCallback` / `computedCallback` / `driftCallback` /
  `beforeComputeCallback` is logged and the others still run; a rejected `computePosition` is
  logged instead of becoming an unhandled rejection. *pure-css port affected.*
- **`runBeforeCallbackSync()`:** a returned Promise that rejects is reported instead of being
  left unhandled, and the warning now says that resolving it to `false` cannot cancel.

### Changed

- **`lockBodyScroll()` pins `<body>`** (`position: fixed` at minus the scroll offset, plus
  `overflow: hidden`) instead of only `overflow: hidden`, which iOS Safari ignores for touch
  scrolling. The last release restores the body's inline styles and jumps back to the saved
  position instantly, even under `html { scroll-behavior: smooth }`.
  **Other code that pins `<body>` itself** (pure-css's modal / panel lock) must join the shared
  state — count on `globalThis[Symbol.for('km-scroll-lock')]`, pin only on 0→1 and unpin only on
  1→0. Two independent pinning locks released out of order leave the page stuck pinned.

### Docs

- SPEC §12.9: pinned scroll lock and the cross-bundle state; §12.9 and README: changing the
  breakpoints at runtime moves only components' `env.breakpoint` — change them in SCSS
  (`$base-breakpoint-*`) so pure-css's `@media` rules agree.
- `src/positioning/CLAUDE.md`: pure-css ports `anchor.ts` / `containing-block.ts`; flag changes
  as "pure-css port affected".

## [1.0.0-rc17] - 2026-11-02

### Changed — BREAKING

- **`scrollIntoContainer()` option `revealContainer` → `shouldRevealContainer`** (boolean options
  use `is` / `should` / `has` / `can`). Same behaviour; rename the key. New in rc16, so nothing
  outside core used it yet.

### Added — motion level (SPEC §12.16)

- **`motion` on every `BlissElement`** — `'auto'` (default) | `'none'` | `'snappy'` | `'smooth'`
  (attribute, property, reflects, `setAttributes()`), plus the page-wide `window.components.motion`
  and a `data-motion` attribute that works on any element (`<html>`, a section). Core writes the
  resolved level to `data-motion` on the host and adopts one small stylesheet into the document (and
  into any shadow root a component lives in) that maps the level onto the shared
  `--base-duration-*` / `--base-scroll-behavior` tokens — so every component that animates through
  them follows, with or without base-css-variables on the page. **The OS reduced-motion setting
  always wins**, even over `motion="smooth"`. Exports: `MOTION_VALUES`, `MOTION_PRESETS`,
  `MOTION_CSS`, `MOTION_ATTRIBUTE`, `MOTION_DATA_ATTRIBUTE`, `adoptMotionStyles`, `getPageMotion`,
  `observePageMotion`, type `Motion`. The CEM plugin documents `motion` on every component.

## [1.0.0-rc16] - 2026-11-02

### Changed — BREAKING

- **`toBool(mode)` requires its mode.** `toBool()` with no argument used to mean `'presence'`,
  where ANY attribute value — `x="false"` included — is `true`; nobody reading `toBool()` expects
  that. Pick one: `'default-false'` (the usual flag: `x="false"` → `false`), `'default-true'`,
  `'tristate'`, or `'presence'` (the native rule — for `disabled` / `readonly`, where the browser
  itself reads the attribute by presence). No KeenMate component used the bare form. New
  exported type `BoolMode`.

### Added — input-table check: dead `default`

- **The once-per-class table check warns when a row's `default` can never apply**: the converter
  answers a missing attribute with a concrete value that differs from it (the converter's answer
  wins; `default` fills in only for `undefined`) — e.g. `toBool('default-false')` with
  `default: true` starts `false`, `toText()` with `default: 'Hello'` starts `''`. A `null` answer
  is exempt (the null-clear "unset, the engine decides" sentinel). Warn-only; no behaviour change.

### Added — container scroll (SPEC §12.15)

- **`scrollIntoContainer(el, options)` / `findScrollContainer(el, options)`** (main index) — bring
  an element into view by scrolling the one container around it, never the page
  (`scrollIntoView()` scrolls every ancestor, so a search jump or keyboard move made the page
  jump). The walk crosses shadow roots and slots; `<html>` / `<body>` are never a container.
  `block` / `inline` (`nearest` default, `start` / `center` / `end`; `inline` is RTL-aware),
  `behavior`, `container` (skip the search), `stopAt`, `axis: 'y' | 'x' | 'both'`,
  `revealContainer` (also bring an off-screen container into the viewport). Honours the
  container's `scroll-padding` and the element's `scroll-margin`; nothing to move → no
  `scrollTo()` call; no container → the page gets the same request
  (`scrollIntoView({ block, inline, behavior })`) and `null`. An element inside an iframe is
  measured against the iframe's own document. Replaces
  the private copies in web-treeview / web-multiselect and daterangepicker's `scrollIntoView` calls.

## [1.0.0-rc15] - 2026-11-01

### Added — responsive rules: page / per-tag / instance partial configs per device class / breakpoint (SPEC §6.7)

- **Every `BlissElement` with an input table** takes responsive rules — partial configs in a map
  with two explicit axes, `{ device?: { <deviceClass>: … }, breakpoint?: { <breakpoint>: … } }`
  (`ResponsiveMap`), or computed by a callback (`ResponsiveCallback`, ctx
  `{ env, deviceClass, breakpoint, element, component, config }`):
  `window.components.responsive` / `.responsiveCallback` (page-wide, non-enumerable accessors shared
  across bundled core copies), `window.components[tag].responsive` / `.responsiveCallback` (per tag),
  `el.responsive` (+ JSON attribute `responsive='{"breakpoint":{"mobile":{…}}}'`) / `el.responsiveCallback` (instance).
- **Map axes.** `device` is keyed by `classifyDevice` (capability first, then the short side — a mouse
  device is `desktop` at any width); `breakpoint` by the window-width bucket (768 / 1024 lines). Within
  one map the breakpoint entry applies first, the device entry over it (device wins on the same key) —
  e.g. iPad portrait (`tablet`, 768 wide = `mobile` bucket) takes `device.tablet` over
  `breakpoint.mobile`; a desktop window narrowed below 768 takes `breakpoint.mobile`. Any other
  top-level key (a device-keyed `{ mobile: … }` map) warns once per element and is ignored.
- **Precedence**, key by key: global map → global callback → per-tag map → per-tag callback →
  instance attributes/properties → instance map → instance callback. An instance `null` (callback
  result or the map's current entry on either axis) ignores every page rule.
- `this.config` and the property getters are the **effective** config; `ctx.config` is the base.
  Overrides never reflect and never count as explicit; core now tracks "explicitly set" per instance
  (attribute present / property assigned; removing the attribute clears it).
- Values go through each input's converter (invalid → warn + skip); unknown / reserved keys warn
  (silently skipped in the page-wide rules). A throwing callback is logged and ignored.
- Re-run on discrete environment changes, any layer change and base changes; while any CALLBACK layer
  applies also on continuous viewport-size changes (`observeViewport`, throttled), so
  `ctx.env.viewportWidth <= 600` re-evaluates between breakpoint lines (maps stay on the discrete channel —
  device class and breakpoint are both discrete, so a breakpoint-only map flips when a desktop window
  is resized across a line). The result is diffed and only
  changed keys are staged, as one batch (`update` / `reinit`). The first build already gets the
  rules. The environment is observed only while some layer is set (the viewport channel only while a
  callback layer is).
- `registerComponent()` adopts a `window.components[tag]` object the page created before the script
  loaded (keeps the object and its `responsive` / `responsiveCallback`).
- Types `ResponsiveMap`, `ResponsiveMapAxis`, `ResponsiveContext`, `ResponsiveCallback` exported from the main entry.

### Added — CEM: core-declared inputs in every manifest (SPEC §12.6)

- `blissInputsPlugin()` now adds the inputs core declares on every element — attribute `defer` ↔
  `shouldDefer`, `theme-source` ↔ `themeSource`, the `ready` event, and (classes with an input table)
  attribute `responsive` ↔ `responsive` + property `responsiveCallback` — with type and description,
  so custom-elements.json / web-types / VS Code data list them. A component's own declaration of the
  same name wins. Exported: `withCoreDeclared`, `CORE_DECLARED_INPUTS`, `CORE_DECLARED_EVENTS`;
  `ExtractedClass.hasInputTable`.

### Added — breakpoint lines from the base tokens

- On the first browser snapshot the environment reads `--base-breakpoint-mobile` /
  `--base-breakpoint-tablet` from the root element (`768px` or unitless; absent / unparsable → the
  default). `configureBreakpoints()` still wins.
- The discrete environment channel (`observeEnvironment` / `environmentChanged`) also fires when
  `classifyDevice()` flips inside one width bucket (a foldable opening from 390 to 720 px).

### Changed — BREAKING (responsive)

- **Default breakpoints are `{ mobile: 768, tablet: 1024, desktop: Infinity }`** (was `mobile: 640`) —
  the pure-css `$mobile-breakpoint` / `$tablet-breakpoint` lines. `classifyDevice()` (600 px short
  side) is unchanged.
- **`MobilePresentation` → `Presentation`** (`'auto' | ResolvedPresentation`), no alias. Components
  rename their `mobile-presentation` input to `presentation`.
- **`resolveMobilePresentation()` removed** — use `resolvePresentation(mode, env, map?)`.
- `getBatchValuesCallback` receives the **base** config (no responsive overrides) as its second argument.

### Added — shared loader: `renderLoader()` + page-wide `renderLoaderCallback` (SPEC §12.14)

- **`renderLoader(host, containerElement, context, { label, prefix, renderLoadingCallback? })`**
  — the one way a component draws a loading state. Precedence: instance
  `renderLoadingCallback` > page-wide `window.components.renderLoaderCallback` > default
  `<span class="<prefix>-loader">`. The container always gets `role="status"` +
  `aria-label` (the given label). Returns an idempotent remove function (runs the hook's
  optional returned cleanup, removes the added nodes, restores `role` / `aria-label`). A
  throwing hook is logged and the default loader is drawn.
- **`window.components.renderLoaderCallback`** — typed (`RenderLoaderCallback`, ctx
  `{ component, context, containerElement, element, label }`), a non-enumerable accessor
  (enumerating `window.components` still yields tags only), shared across bundled core
  copies; a value the page set earlier as a plain property is adopted.
- Core ships no loader CSS: components copy the drawing rule (SPEC §12.14) using their
  `--<prefix>-loader-*` tokens chained to base-css-variables' `--base-loader-*`.

### Changed — menu disabled fade follows the contract default

- **`--km-menu-disabled-opacity` defaults to `0.65`** (was `0.5`): the fallback of
  `var(--base-disabled-opacity, …)` now equals the contract's value, so a disabled menu item
  looks the same with or without `@keenmate/base-css-variables`. The menu has no transitions or
  animations (nothing to chain to `--base-duration-*`).

### Added — form validity API + `setFormatError()` (SPEC §6.6)

- **`BlissElement` exposes constraint validation** for form-associated classes:
  `validity`, `validationMessage`, `willValidate`, `checkValidity()`,
  `reportValidity()`, read through `ElementInternals`. A non-form-associated class
  answers "no constraint" (`undefined` / `''` / `false` / `true` / `true`) without
  attaching internals.
- **Protected `setFormatError(error, message?, anchor?)`** — non-null marks the
  host invalid (`setValidity({ customError: true }, message, anchor)`; message
  falls back to the error's message, then a generic text; a rejected anchor is
  dropped with a warning); `null` clears it. Blocks form submission unless
  `<form novalidate>`. For a value a component can't produce (a throwing
  `getValueFormatCallback`).

### Added — `getLiveValue` live property getter (SPEC §4.1)

- **`InputDef.getLiveValue(el)` — live property getter** (SPEC §4.1). For an input
  whose state the component changes after assignment (tree nodes, grid rows,
  added-new options), the generated getter returns `getLiveValue(el)` once the
  element has built; it falls back to the stored value before the first build,
  while that input's write is staged but not applied, after a failed `reinit()`,
  and when the callback returns `undefined`. The setter path and `this.config`
  (the assigned value) are unchanged. A non-function `getLiveValue` is flagged by
  the input-table sanity check.

### Changed — BREAKING (v2 naming unification)

- **`/search`: `SearchCallbackContext` has ONE term** — `term` is now the prepared
  term (`getSearchTermCallback` `target: 'callback'` result, else the typed text;
  typed via the new `TTerm` generic); the separate `searchTerm` field is gone.
  **`SearchEntry.item` → `data`** (`item` is reserved for action items).
- **`el.defer` → `el.shouldDefer`** (boolean `should*` prefix; the attribute stays
  `defer`). A subclass input with configKey `shouldDefer` owns the property.
- **`/menu`: `OpenMenuOptions.onClose` → `closeCallback`; `/search`
  `PrepareSearchTermOptions.onObjectTerm` → `objectTermCallback`** (`on*` is reserved for
  event twins).
- **`BeforeCallbackResult.isCancelled` → `isRejected`** (`runBeforeCallback` /
  `runBeforeCallbackSync` / `runBeforeCallbackEager`): a before-callback *rejects*
  an operation before it starts; "cancel" is reserved for stopping a running one.
  The throw log now reads "treated as reject".
- **`/dom`: `createStyleSlot({ className })` → `{ cssClass }`** (`StyleSlotOptions`).
- **`/menu`: `OpenMenuOptions.className` → `cssClass`** — the same name as the
  item-level `cssClass` (and `createTooltip`).
- **`/positioning` option callbacks off the `on*` prefix** (`on*` is reserved for
  event twins, SPEC §12.5): `anchor` / `createPopover` `onBeforeCompute` →
  `beforeComputeCallback`, `onPlaced` → `placedCallback`, `onComputed` →
  `computedCallback`, `onDrift` → `driftCallback`; `createTooltip` `onBeforeShow` →
  `beforeShowCallback`.
- **Overlay coordination event `km-overlay-activated` → `km-overlay-activate`**
  (single act = `<domain>-<verb>`, no past tense); `OVERLAY_ACTIVATED_EVENT` →
  `OVERLAY_ACTIVATE_EVENT`, `OverlayActivatedDetail` → `OverlayActivateDetail`.
  Components bundling an older core keep the old name, so mixed-version pages don't
  close each other's overlays until all are rebuilt.

### Changed — `ready` fires asynchronously (SPEC §6.3)

- The `ready` event, the `ready` attribute / `:state(ready)`, `isReady` and
  `whenReady()` now all flip on the **microtask** after the first build +
  `connect()`, not synchronously inside it — `el.addEventListener('ready', …)` right
  after `document.createElement` / append / the import no longer misses it. A
  microtask, not `requestAnimationFrame`: rAF stalls in hidden tabs. Code that read
  `isReady` synchronously right after append must `await el.whenReady()`.

### Fixed — `isDisabled` must reflect; `isFormDisabled` is fieldset-only (SPEC §6.4)

- The browser calls `formDisabledCallback(true)` for a form-associated element's
  OWN `disabled` attribute too, so `isFormDisabled` used to read `true` for it and
  a non-reflecting `isDisabled` got stuck disabled (`el.isDisabled = false` left the
  attribute). `isFormDisabled` now reports the fieldset side only (ancestors read
  while the own attribute is set), and the contract is that the `isDisabled` input
  (attribute `disabled`) reflects — the input-table check warns when a
  form-associated class declares a non-reflecting `disabled` input. The old
  "`el.disabled` keeps the author's value" wording is gone.

### Added — `destroy()` in `BlissElement` (SPEC §6.5)

- Public **`destroy()`**: runs `disconnect()` if active, cancels the pending flush
  and the `removedCallback` check, then the protected **`destroyCallback()`** hook;
  readonly **`isDestroyed`**. Idempotent. A destroyed element is inert — a
  reconnect warns via the element's logger and never rebuilds. Components with
  their own `destroy()` (web-multiselect, web-editor, web-dropzone) should move
  their cleanup into `destroyCallback()`.

### Added — fieldset-aware disabled state (SPEC §6.4)

- `BlissElement` implements **`formDisabledCallback`** once (form-associated
  elements). Protected **`isFormDisabled`**, **`isEffectivelyDisabled`**
  (`isDisabled` input OR a disabled `<fieldset>`) and the **`disabledChanged(isDisabled)`**
  hook (fires on a flip of the merged state on a built element; not for a rebuild).
  web-dropzone's hand-written `formDisabledCallback` should move onto it.

### Added — `defer` / `release()` / `ready` for every component (SPEC §6.3)

- **`defer`** (global attribute, always observed, + reflecting `el.shouldDefer`) holds the
  first build — no `reinit()`/`update()`/`connect()` — while options, callbacks and
  listeners are wired. **`release()`** (or removing `defer`) runs the first build
  once with everything set so far. Latched.
- **Readiness**: after the first live build (`reinit()` + `connect()`) the host gets
  the `ready` attribute and `:state(ready)`, the core-declared **`ready` event**
  (+ `onReady` twin) fires once, `isReady` turns `true`, `whenReady()` resolves.
- BREAKING for components with their own gate/announcement (web-multiselect,
  web-daterangepicker `defer` + `ready()` + `is-ready`; web-editor `is-ready`;
  web-treeview `data-ready`): they must drop it in their v2 pass — until then
  core's `ready` fires in addition to theirs.

### Added — `removedCallback()` lifecycle hook

- **`BlissElement.removedCallback()`** (protected, no-op default): fires after
  `disconnect()` when the element is still detached at the next animation frame
  (macrotask fallback where rAF is unavailable or the tab is hidden) — a real
  removal, not a move. A synchronous DOM move never fires it. Opt-in: the
  post-disconnect check is scheduled only for subclasses that override the hook.
  Re-adding the element after it fired is a fresh activation: `connect()` runs as
  usual (no forced `reinit()`; a subclass that tore its structure down rebuilds it in
  `connect()`).

### Fixed — page-wide menu theming (`/menu`)

- **Three-layer CSS variables.** Every menu value now reads
  `var(--_km-menu-X, var(--km-menu-X, var(--base-…, <default>)))`: the component's
  per-instance variable (mapped onto the private `--_km-menu-*` with no fallback) →
  the page-wide `--km-menu-*` → `--base-*` → default. Before, components mapped
  `:host { --km-menu-bg: var(--wtv-context-menu-bg); }`, which is guaranteed-invalid
  when the component variable is unset and shadowed a `:root { --km-menu-bg }`, so
  page-level menu theming never reached menus inside components. **Components now
  set only `--_km-menu-*`** (and leave their own menu variables unset by default).

### Added

- **`--km-menu-hover-color`** — item text colour on hover / focus / open submenu
  (default unchanged; danger / toggled items keep theirs).
- **`component-variables.manifest.json`** — the `--km-menu-*` / `--base-*` variable
  list (usage, fallback, default), shipped and exported as
  `./component-variables.manifest.json`; a unit test keeps it in sync with the stylesheet.
- `.km-menu__item` no longer sets `color: inherit` (it inherits anyway).

### Changed — BREAKING (interaction model)

One shape for events, callbacks and clickable items across every KM component
(`docs/interaction-model-plan.md`).

- **`on<Name>` event properties receive the detail, not the `CustomEvent`.** The
  property declared by `static events` is now the event's *twin*: `emit()` calls
  it with the detail object, then dispatches the DOM event carrying the same
  object. It is no longer a listener — use `addEventListener` / `on()` for that.
  Migration: `el.onSelect = (e) => e.detail.option` → `el.onSelect = (d) => d.option`.
- **Events are no longer `composed`.** `dispatch()` and `emit()` default to
  `bubbles: true, composed: false`: events fire on the host and bubble through the
  page, but don't escape an enclosing component's shadow root. Pass
  `composed: true` (per call or per `EventDef`) where crossing is intended.
- **Every `emit()` detail carries the component context**: `controller` and
  `element` (non-enumerable — invisible to `JSON.stringify` / `Object.keys`), plus
  the `eventContext()` extras. An `emit()` with no detail now delivers `{}` + context
  instead of `undefined`.
- **`/search` `SearchCallbackContext`** gains `term` (raw) and `signal` — the
  single argument of a component's `searchCallback(ctx)`. `SearchTermContext` gains
  `term` — the single argument of `getSearchTermCallback(ctx)`.

### Changed

- **BREAKING — `runAction` runs the built-in BEFORE the `action` event** (#15). The
  order is now `beforeActionCallback` (veto) → item `onClick` → built-in → `action`
  event + `onAction` twin (was: … → `onClick` → event → built-in). The event is a
  notification after the fact: a listener sees the state the built-in left — after
  web-grid `delete` the row is already gone from `items`, after `add` the new row is
  present, after `move-*` the new order is in place. To prevent a built-in, use
  `beforeActionCallback` (returning `false`), not the event. A built-in that throws
  is logged (`UI` / `CORE:ACTIONS`) and the event **still fires** — the activation
  happened and listeners re-read the actual state. **Review note:** listeners that
  read the *pre*-action state in the event (e.g. "the row about to be deleted") must
  now take it from the detail's surface context (`row`, `node`, …), which is captured
  before the built-in runs.
- **BREAKING — `/actions` toggle state renamed `isActive` → `isToggled`** (no alias):
  `ActionItem.isActive` → `isToggled`, `getIsActiveCallback` → `getIsToggledCallback`,
  `ResolvedActionItem.isActive` → `isToggled`, the menu modifier `__item--active` →
  `__item--toggled` (and its color variable `…-active-color` → `…-toggled-color`).
  Meaning: the thing the item toggles is ON (Bold while the caret is in bold, "Show
  hidden" checked). Buttons keep `aria-pressed`. **`openMenu()`** renders an item that
  defines its toggle state (`isToggled`, `getIsToggledCallback`, or a `defaults`
  `isToggled`) as `role="menuitemcheckbox"` + `aria-checked="true|false"` instead of
  `menuitem` + `aria-pressed`; the keyboard treats it like any item.
- **BREAKING — shared menu prefix `bliss-` → `km-`** (no alias): `/menu` classes
  `.bliss-menu*` → `.km-menu*`, custom properties `--bliss-menu-*` → `--km-menu-*` (still
  falling back to `--base-*`). `km-` is the prefix reserved for shared UI rendered by
  core (menu, future tooltip …) — not a component prefix.
- **An invalid attribute value now warns and keeps the previous value**, the same
  rule as the property path. `el.setAttribute('page-size', 'abc')` on a
  `page-size` of 25 used to reset it silently to the default; it now warns
  (`rejected invalid value for attribute page-size="abc" (not a number); keeping
  previous value`) and stays 25. In markup the previous value is the default, so
  the result is unchanged there — only the warning is new. An input with
  `shouldReflect` writes its current value back to the attribute. A rejected
  attribute no longer counts as explicit for `getBatchValuesCallback`, so
  `<web-grid mode="excel" edit-trigger="bogus">` gets the preset's `editTrigger`.
  A converter that throws while parsing also keeps the previous value now (was:
  the default). Removing an attribute still resets to the default.
- **Default log level is `warn`** for every logger bundle (component bundles and
  core's own `CORE`): errors and warnings are visible out of the box,
  `enableLogging()` adds info/debug, `disableLogging()` silences everything. A
  level persisted in `localStorage` still wins.
- **Instance log line format** is now `[MULTISELECT:UI] #country  <message>` — the
  tag is no longer repeated after the namespace; `#<id>` or `#<n>` when the
  element has no id. The id is read per line (no longer memoized on first log).
  Elements whose tag has no logging bundle log through `CORE:ELEMENT` as
  `web-grid#main`; `this.log` for such a tag no longer no-ops.
- **Core's own messages go through loggers — no direct `console` calls.**
  Input-validation warnings (were `[BlissElement] <tag> …` via `console.warn`,
  deliberately bypassing logging), throwing `on<Name>` twins, action / menu /
  `before*Callback` errors and theme warnings are logged through the element's
  instance logger (`INIT` for input validation, `UI` for actions / menus / twins;
  the bundle's first category when it lacks that name), else the new `CORE`
  bundle (`CORE:ELEMENT` / `ACTIONS` / `MENU` / `THEME`). They are therefore
  silenced by `disableLogging()`. `resolveActionItem` / `resolveMenuEntries` /
  `getMenuChildren` / `runBeforeCallback*` take an optional trailing `logSource`
  (defaults to the `ctx`, used when it carries the component as `element`).

### Added

- **`setCategoryLevel` accepts the namespaced category** as it prints in the console
  (`window.components['web-grid'].logging.setCategoryLevel('GRID:DATA', 'debug')`) as
  well as the bare one (`'DATA'`). The namespace must be the bundle's (case-insensitive);
  anything else is ignored.
- **`window.components.logging` — the page-wide logging switch.** A non-enumerable
  key (tag enumeration is unaffected) with `enableLogging(level?)` /
  `disableLogging()` / `setLogLevel(level)` / `getCategories()`, applied to every
  bundle on the page (all components + `CORE`, across bundled core copies) and to
  bundles created later. A later per-component call wins for that component;
  per-instance overrides still apply on top. Also exported as
  `getGlobalLogging()`; `coreLogging` / `CORE_LOG_CATEGORIES` expose core's own
  bundle, `DEFAULT_LOG_LEVEL` the default, and `LoggerBundle` gains `namespace`.

- **Shared menu — `@keenmate/web-components-core/menu`** (SPEC §12.13). `openMenu(entries,
  ctx, { at, host, runAction, onClose, renderItem, renderMenu, … })` renders `/actions`
  menu entries (HTML icon, escaped label / shortcut, danger / toggled / disabled, named
  dividers, `cssClass`), submenus incl. lazy `getChildrenCallback` with a loading row,
  positions every level through `/positioning` `anchor()` (cleaned up on close), dismisses
  on outside press / scroll / wheel / window blur / another KM overlay (`registerOverlay`),
  runs item shortcut keys, and implements the WAI-ARIA menu keyboard model (↑↓ wrap
  skipping dividers + disabled, Home/End, →/Enter into a submenu, ←/Esc back to the parent
  item, Enter/Space run, Esc/Tab close, roving focus, `menu` / `menuitem` / `separator`
  roles, `aria-haspopup` / `aria-expanded` / `aria-disabled`). `shouldFocusFirst` /
  `focusFirst()` for keyboard opens, `returnFocusTo` on close. Shared `km-menu*` BEM
  classes styled by `--km-menu-*` custom properties defaulting to the `--base-*`
  tokens, adopted into the host root (`adoptStyles`, `@layer component`).
- **`anchor()` `offset`** also takes the object form `{ mainAxis, crossAxis, alignmentAxis }`
  (`AnchorOffset`).
- **`Converter.fromAttribute` gets an optional 4th argument, `reportInvalid(reason?)`**,
  which every built-in `to*` factory calls for an unusable present value. A
  custom converter that doesn't call it keeps the old silent-fallback behaviour.
  `toCustom(parse)` passes it to `parse` as a 2nd argument.
- **`BlissElement`**: `controller` getter + `createController()` hook (the public
  facade, built once), `eventContext()` hook, `withContext(target)`; second type
  parameter `BlissElement<TEvents, TController>`. Event-table lint warns on a
  composed native event name (`copy`, `input`, `pointerdown`, …).
- **`runBeforeCallback` / `runBeforeCallbackSync`** — the one `before*Callback`
  contract: `false` cancels, `undefined` continues, a value continues with it; a
  throw cancels and is logged; the sync variant warns on a returned `Promise`.
  `runBeforeCallbackEager` answers synchronously for a sync hook and returns a
  `Promise` only for an async one (keeps sync flows sync).
- **`withComponentContext`, `ComponentContext`, `EmitDetail`** (main entry).
- **`@keenmate/web-components-core/actions`** — `ActionItem`, `MenuItem`,
  `MenuDivider`, `MenuEntry`, `ActionEventDetail`; `resolveActionItem`,
  `resolveMenuEntries`, `getMenuChildren`, `menuDivider`, `isMenuDivider`,
  `normalizeActionItems`, `readActionDataset`, and `runAction` (fixed order:
  `beforeActionCallback` → `onClick` → built-in → `action` event; busy guard).
- **`InputDef.getBatchValuesCallback(value, config)`** — an input that also sets
  others (a preset such as web-grid's `mode`). The returned `{ configKey: value }`
  map is staged in the same batch, each value through its own converter;
  inputs set explicitly in that batch win, whatever the order. One level only.
  SPEC §6.2.

### Changed — BREAKING (naming review, no aliases)

Public names brought in line with the house conventions: boolean options take an
`is` / `should` / `has` / `can` prefix, `*Callback` marks a function whose return value is
used, `on*` marks a notification, teardown is `destroy()`, hooks are `*Changed`.

| Where | Old | New |
|---|---|---|
| `InputDef` (every input table) | `reflect` | `shouldReflect` |
| `BlissElement` | `static themeContext` | `static hasThemeContext` |
| `BlissElement` | `resized(size)` hook | `sizeChanged(size)` |
| `BlissElement` | `isRTL` getter, `directionChanged(isRTL)` | `isRtl` |
| `BlissElement.runHook` options | `onError` | `errorCallback` |
| `anchor()` / `createPopover()` | `flip` | `shouldFlip` |
| `anchor()` / `createPopover()` | `autoUpdate` | `shouldAutoUpdate` (`autoUpdateOptions` unchanged) |
| `anchor()` / `createPopover()` | `beforeCompute` | `onBeforeCompute` |
| `anchor()` | `fixedContainingBlock` | `shouldUseFixedContainingBlock` |
| `createTooltip()` | `followCursor` | `shouldFollowCursor` |
| `observeEnvironment` / `observeViewport` / `observeElementSize` / `observeThemeContext` | `immediate` | `shouldFireImmediately` |
| environment types | `ObserveOptions` | `ObserveEnvironmentOptions`; new `ObserveThemeContextOptions` |
| `OverlayHandle` | `dispose()` | `destroy()` |
| overlay | `presentationContext()` | `createPresentationContext()` |
| css-var lint | `declaredCssVars()` | `extractDeclaredCssVars()` |
| `resolveEnumAttribute` options | `caseInsensitive` | `isCaseInsensitive` |
| `/search` `prepareSearchTerm` options | `prepare` | `getSearchTermCallback` |

Attributes, events and CSS are unchanged — only the JS API of components built on core.

### Fixed

- **`setAttributes()` no longer drops an unknown key silently.** A key that is neither an
  input's `configKey` nor its attribute name used to be skipped without a word — web-treeview's
  performance page kept passing `data` after the input became `nodes` and got an empty tree, no
  error. It now warns (`setAttributes: "data" is not an input of <web-treeview> …; skipped`,
  INIT logger) and the other keys still apply. The core-declared properties (`shouldDefer` /
  `defer`, `themeSource` / `theme-source`, `responsive`, `responsiveCallback`) are now accepted
  — they were silently dropped too.
- **`el.form` no longer throws on an element that isn't form-associated.** A real browser throws
  reading `ElementInternals.form` there ("not a form-associated custom element"; jsdom doesn't); the
  getter now returns `null` without touching (or attaching) internals, like the validity members.
- **A throwing environment / theme listener no longer stops the others.** `observeEnvironment`,
  `observeViewport` and `observeThemeContext` log the error (`CORE:ELEMENT` / `CORE:THEME`) and keep
  notifying, so one bad callback can't freeze other components' responsive rules or theme.
- The `OpenMenuOptions.runAction` doc comment gave the wrong order; it's `beforeActionCallback` →
  `onClick` → built-in → `action` event, like `runAction()`.
- **`toEnum({ shouldNullOnInvalid: true })` without a `default` accepts `null` on the property
  path.** `null` is that input's unset value, but only removing the attribute cleared it —
  `el.x = null` was rejected with a warning and kept the old value. Now both clear it (and a
  reflected attribute is removed); an unknown string is still rejected.
- **A throwing `reinit()` / `update()` no longer wedges the element.** The error still reaches
  whoever flushed, but `whenSettled()` waiters now resolve (they used to hang), a failed
  `reinit()` is retried on the next flush or reconnect (it used to be skipped for good, leaving
  later changes to `update()` a structure that was never built), and `connect()` runs only once
  a build succeeded — `disconnect()` only if `connect()` ran.
- **A row's `default` applies when the converter has no default of its own.**
  `{ converter: toInt(), default: 5 }` used to resolve to `undefined` (at construction, on
  attribute removal, and for an unparsable value) while the CEM manifest documented `5`.
- **`mount(html, { container })`** (`/testing`) returns the newly mounted element; it returned
  the container's first child, which is wrong when the container already has children.
- **`findHighlightRanges`** no longer returns overlapping ranges when several matches fall in
  one multi-character fold (`s` in `Straße` gave `[4,5]` twice — once per `s` of `ß`).
- **`anchor()`** (`/positioning`) ignores a `computePosition` result that resolves after
  `destroy()` — it used to still move the panel and fire `onPlaced` / `onComputed` /
  `onDrift`. `update()` is a no-op once destroyed.
- **`data-theme` inheritance for portaled layers crosses shadow roots.** A popover or tooltip
  anchored inside a component's shadow DOM now picks up `data-theme` from the page around the
  host.
- **`fixedContainingBlock`** now detects the individual transforms (`translate`, `scale`,
  `rotate`, and those in `will-change`), and no longer treats `filter` / `backdrop-filter` as a
  containing block on WebKit, where it isn't — matching Floating UI.
- **`observeKeyboardInset` cleanup** cancels a queued frame, so closing an overlay right after
  opening it no longer re-applies the inline `height` / `top` afterwards.
- **Environment:** a resize frame queued before the last unsubscribe no longer re-caches a
  stale snapshot for `getEnvironment()`, and `configureBreakpoints()` re-resolves the
  breakpoint when only `observeViewport` subscribers are live.
- **A rejected pre-upgrade property no longer blocks the initial attribute.** `<x mode="b">`
  with `el.mode = 'bogus'` set before upgrade resolved to the default; it now takes `b`.
- **`toList` / `toObjectArray` defaults are no longer shared between instances** — each resolve
  gets its own array, so mutating one element's array can't change another's.
- **`toValue` reflection** removes the attribute for a value JSON can't represent (a function)
  instead of writing the string `"undefined"`.
- **`lockBodyScroll()`** is a no-op instead of throwing when called before `<body>` exists.

### Internal

- More shared internal helpers: `dom/throttle.ts` (leading + trailing, replaces the copies in
  environment and element-size) and `dom/once.ts` (the run-once unsubscribe guard, five copies).
  `observeEnvironment` / `observeViewport` share one subscribe path. Converters share
  `scalarToAttribute` / `parseJson`, and `toInt` / `toFloat` one numeric core. `BlissElement`'s
  pre-upgrade lift and reflection guard are single private helpers; the logger's three
  localStorage accesses go through one.
- Removed the unused `getRootLogger` and the internal `TABLET_MIN_SHORT_SIDE` re-export from
  `overlay/presentation.ts` (the public export from the root index is unchanged). Marked
  `resolveFromAttribute`, `resolveFromProperty`, `normalizeEventDefs` and `defaultEventProperty`
  `@internal` in their docs (still exported).
- Shared internal helpers: `dom/frame-scheduler.ts` (per-frame coalescing with `cancel()`,
  now used by environment and keyboard-inset) and `dom/composed-tree.ts` (`composedParent`
  / `composedClosest`, now used by theme, anchor and containing-block).
- Docs: `loglevel` is vendored (`src/logging/log-core.ts`), not a dependency — CLAUDE.md,
  the logging notes, SPEC §12.1 and the README said otherwise.

### Internal — example pages on the shared devkit

- **Example pages and e2e run on the shared devkit** — `@keenmate/web-components-devkit` (dev
  dependency only) serves the example pages and drives Playwright: dev server on port 15000 (core's
  registry block; was 12400, web-commandpalette's), `npm run build:examples` builds a static site into
  `dist-examples/`, and every page gets the kit's light / dark / auto theme switch, chapter nav and
  copy-link buttons. The private `examples-shared.css`, `examples-chapter-nav.js` and
  `examples-copy-link.js` are gone. The package build is unchanged (`npm run build`, tsc); plain
  `vite build` is refused (`kmwc.library: false`) so it can't wipe `dist/`. Nothing new ships in the tarball.
- **New example pages for the core itself** — `IN · Reactive inputs` (input table, converters,
  invalid values, reflection, update vs reinit, batching, `whenSettled()` / `flush()`, presets, live
  getters), `LC · Lifecycle` (reinit / connect / ready, `defer` + `release()`, DOM moves,
  `removedCallback`, `destroy()`, throwing hooks) and `RS · Environment & responsive rules` (live
  device class / breakpoint, discrete vs continuous channels, `resolvePresentation`, responsive maps
  and callbacks with the full precedence chain), each on real `BlissElement` demo elements with e2e.
- **More example pages** — `IA · Events & interaction` (`emit()` + `on<Name>` twins, before-callbacks,
  `/actions` with the `runAction` order, `/menu` context / dropdown menus with keyboard and theming),
  `FO · Forms` (form association, `isDisabled` vs `<fieldset disabled>`, validity API +
  `setFormatError`) and `PG · Page-wide controls` (`window.components` registry, logging, the shared
  loader hook, style injection).
- **e2e runs on dedicated fixture pages** — every spec targets a minimal page under `test/` (styled by
  `test/test-fixtures.css`, no example chrome, test-only elements), never the example pages; the only
  exception is `e2e/examples.spec.ts`, a smoke test of the example site. `test/COVERAGE.md` maps each
  behaviour to its spec + fixture, `test/NOTES.md` records what testing turned up.
- **Example pages use only the devkit's classes** (devkit `^1.0.0-rc06`) — logs (`.log-panel` +
  `.log-line` tones / timeline cells), readouts, grids, tables, pills, notes and native form fields
  come from the kit; page CSS is left only for the demo drawings, on `--kmwc-*` tokens, so every page
  works in dark mode and fits a 320 px phone. IN04 gained an animated diagram of reading state
  without vs with `await whenSettled()`.
- **Examples container image** — `Dockerfile` / `nginx.conf` / `.dockerignore` generated by
  `kmwc sync`; `make image-build` / `image-run` (port 15010); Plausible analytics on the built site.

## [1.0.0-rc14] - 2026-10-22

### Added

- **Search primitives — `@keenmate/web-components-core/search` (`src/search/`, SPEC §12.11).**
  The built-in search rules web-multiselect 2.6.0-rc02 shipped, moved here so every component
  with a search box matches (and highlights) the same way. Pure, DOM-free, no dependencies;
  a separate subpath, not re-exported from the root.
  - `normalizeSearchText(text, behavior?)` — `normalized` (default: case and diacritics
    ignored, `ł ø đ ð ħ ı ß æ œ ς` folded), `case-insensitive`, `exact`; NFC in every mode.
  - `findTextMatches` / `matchesText` for `contains`, `equals`, `starts-with`, `ends-with`,
    `word-starts-with`, `word-ends-with`; `findRegexMatches`, `statelessRegex`.
  - `prepareSearchTerm(term, { behavior, match, regex, prepare?, onObjectTerm? })` →
    `ActiveSearchTerm`, with `createRegexCompiler()` keeping the last valid typed pattern;
    `matchesSearchTerm(term, match, prepared, raw)` (values may be lazy).
  - `findHighlightRanges(label, term, opts)` → `{ text, ranges }` (ranges index into the
    returned NFC text) and `wrapRanges(text, ranges, { open, close, escape })`.
  - Types: `SearchBehavior`, `SearchMatch`, `SearchTermContext`, `PreparedSearchTerm`,
    `SearchEntry`, `SearchCallbackContext` (the shared `searchCallback(term, signal, context)`
    convention), `ActiveSearchTerm`, `SearchRange`, `HighlightResult`.
- **`examples-search.html`** (chapter code `SE`): behavior × match playground, `normalizeSearchText`
  side by side, every match mode on one term, why highlight returns `{ text, ranges }`, a
  part-number `prepare` callback, and the `searchCallback` context with identity-stable `entries`.
- `docs/search-migration-plan.md` — the multiselect → core → treeview plan.

## [1.0.0-rc13] - 2026-10-21

### Added

- **Theme context — dark / light detected once and mirrored onto every component
  (`src/environment/theme.ts`, SPEC §12.10).** Replaces the components'
  `:host-context(.dark)`-style rules, which Firefox doesn't support and Safari only
  partly (so a Tailwind `<html class="dark">` page got a light component there).
  - **Detect once, reuse:** the page (`<html>`, then `<body>`; `data-theme`, then
    `data-bs-theme`, then `.dark` / `.light`) is detected once and cached; one shared
    `MutationObserver` re-detects only on a signal-attribute change, and subscribers
    hear only real changes. A swapped `<body>` (Turbo / htmx) is re-attached.
  - **Forcing:** `setThemeMode('dark' | 'light' | 'auto')` forces every component
    (observers pause while forced); per-instance `data-theme` on a component still wins.
  - **`theme-source`:** a global attribute / `themeSource` property on every
    `BlissElement` — a selector, `closest`, or an `Element` — to read the theme from
    a section instead of the page. Components sharing a source share its cache and
    observer.
  - **`BlissElement`:** mirrors the effective scheme onto the host as
    `data-context-theme="dark|light"` and calls the new opt-in `themeChanged(scheme)`
    hook; `static themeContext = false` opts out.
  - State lives on `globalThis` (`Symbol.for`), so multiple bundled copies of core
    share one mode and one observer per element.
  - Exports: `setThemeMode`, `getThemeMode`, `getThemeContext`,
    `observeThemeContext`, `readThemeSignal`, `resolveThemeSource`,
    `THEME_CONTEXT_ATTRIBUTE`, `THEME_SOURCE_ATTRIBUTE`, and the types `ColorScheme`,
    `ThemeMode`, `ThemeSource`, `ThemeListener`.
- **`examples-theme.html` + `<theme-card>` demo component** (chapter code `TH`): page
  detection with a live observer counter, `setThemeMode()`, per-instance `data-theme`,
  and `theme-source` on a section.

### Changed

- **`observedAttributes` always includes `theme-source`** (alongside `dir`). Tests
  that assert the exact list need the extra entry.

## [1.0.0-rc12] - 2026-10-10

### Added

- **Canonical engine-config assembly (`collectEngineConfig`, `BlissElement.engineConfig`).**
  `src/inputs/engine-config.ts` exports `collectEngineConfig(config, { exclude })` — a shallow copy
  of the merged config with `exclude` keys removed and **every `null` preserved** — and
  `BlissElement` exposes the protected `engineConfig(exclude?)` wrapper. This is the one correct way
  to turn the input bag into the object a component hands its engine, replacing the per-component
  null-handling loops that had drifted into three copies of the same latent bug.
- **Clearability derivation from the input table (`clearableConfigKeys`, `deriveClearableKeys`,
  `isClearableConverter`, `isClearableInput`).** `src/inputs/clearable.ts` derives — from the
  existing converter contract, with no new converter metadata — which `configKey`s legitimately
  carry `null` (a nullable `toText`, tristate `toBool`, `toFunction`, a `shouldNullOnInvalid` enum,
  or a `default: null` row). Exposed on `BlissElement` as the protected `clearableConfigKeys` getter;
  retires hand-maintained per-component null-exception lists.
- **SPEC §6.1 — the `BlissElement` ↔ engine null-clear contract.** Documents the two absent-
  sentinels (`null` = cleared/reset, `undefined` = not-in-batch/leave-alone), the component-side
  `engineConfig()` assembly pattern, and the three engine-merge field categories.
- **`examples-nullclear.html` + `<nullclear-card>` demo component** (`examples-nullclear-card.ts`,
  chapter code `NC`): shows `collectEngineConfig` preserving `null` at the data level, then a live
  `BlissElement` driving a stub engine with the real `!== undefined` merge — bug (old delete-null
  loop) vs fix (`engineConfig`) side by side. `e2e/examples.spec.ts` smoke-tests both paths.

### Changed

- **BREAKING (engine authors): a cleared nullable input now reaches the engine as a present `null`,
  not an absent key.** Previously every KM component stripped `null` while assembling its engine
  config (`if (value === null) delete cfg[key]`), so clearing a nullable input — e.g.
  `removeAttribute('focused-node-class')` or `el.focusedNodeClass = null` — was silently a no-op and
  the stale value stuck. Core now preserves the `null`, so the clear travels through and the field
  resets. Engine merges must treat a present `null` as a real value:

  ```ts
  // BEFORE — per component, dropping the clear (the bug):
  const cfg = { ...this.getConfig() };
  for (const k of Object.keys(cfg)) if (cfg[k] === null && k !== 'theme') delete cfg[k];
  this.#engine.update(cfg);

  // AFTER — core preserves null; the engine resolves it:
  const cfg = this.engineConfig(NON_ENGINE_KEYS); // nulls intact
  Object.assign(cfg, partial);
  this.#engine.update(cfg);
  ```

  ```ts
  // Engine merge — treat null as a real value, per field:
  if (updates.focusedNodeClass !== undefined) this._focusedNodeClass = updates.focusedNodeClass;        // clearable: null clears
  if (updates.iconClass        !== undefined) this._iconClass        = updates.iconClass ?? DEFAULT_ICON; // defaulted: null → default
  ```

  Keep the `!== undefined` guard — it is what skips untouched keys, and a cleared key now arrives
  *present with `null`*, so it passes the guard and lands. A field that is neither clearable nor
  `?? DEFAULT`-guarded (a raw `this._x = updates.x` later dereferenced) will now receive `null` where
  it used to receive nothing — a latent bug the old drop-the-null behavior hid; fix the merge, do
  **not** re-drop the null. Migrate each component by deleting its null-strip loop and calling
  `engineConfig(...)`; verify every nullable field's set→clear transition in that repo's e2e.

## [1.0.0-rc11] - 2026-10-08

### Added

- **`matchWidth: 'max'`** (`src/positioning/anchor.ts`, `MatchWidth` in
  `types.ts`). Completes the width-matching set: `'min'` floors the panel to the
  reference width (grows for wider content), `'exact'` pins it, and the new
  `'max'` caps it to the reference width (shrinks for narrower content) — i.e.
  `min(reference, content)`, the mirror of `'min'`. Flows through `createPopover`
  unchanged. Note it sets `max-width` to the *reference* width, distinct from the
  existing `maxWidth` option which caps to the *available viewport* width.
- **e2e test suite (`e2e/`) + fixture pages (`test/`), driven by Playwright over
  a vite dev server.** Core is a library with no component to mount, so the
  specs exercise the `/positioning` helpers against real layout and a real
  `@floating-ui/dom` in a real browser — proving where a tooltip actually lands,
  which the jsdom unit suite (mocked floating-ui, no layout) cannot. The first
  spec (`e2e/tooltip.spec.ts`) is the regression guard for the follow-cursor fix
  above (stationary-hover anchoring, pointer tracking, basic hover + focus).
  New scripts: `dev` (vite on port 12400), `test:unit`, `test:e2e`,
  `test:e2e:ui`, `test:e2e:headed`, `test:e2e:install`. `npm test` remains the
  vitest unit suite. Added `createTooltip` unit coverage for the
  seed-on-`mouseenter` behaviour in `src/positioning/positioning.test.ts`.
- **Manual example site (`npm run dev`) + `<tooltip-card>` demo component**,
  structured like the web-multiselect examples so the KM family reads
  consistently: a cards landing (`index.html`) rendered from a page registry, a
  shared `examples-shared.css`, and the two self-initializing helper scripts
  (`examples-chapter-nav.js` — a floating "jump to chapter" nav; and
  `examples-copy-link.js` — per-section deep-link buttons). Each example page
  (`examples-tooltip.html`, `examples-popover.html`, `examples-anchor.html`) is
  built from `.card` sections whose `<h2>` carries an **XXYY chapter code**
  (`TT01`, `PO01`, `AN01`, …) for quick navigation, and drives the `/positioning`
  helpers with live controls — including `<tooltip-card>`
  (`examples-tooltip-card.ts`), a real `BlissElement` that wires `createTooltip`
  through the `connect()`/`reinit()`/`disconnect()` lifecycle so the helpers can
  be eyeballed without one of the five shipping components. Demo-only — not
  published (`files` ships `dist/` only). `e2e/examples.spec.ts` smoke-tests the
  pages so they can't silently rot.

### Fixed

- **Follow-cursor tooltips no longer mis-position on a stationary hover**
  (`src/positioning/tooltip.ts`). The pointer-tracking `mousemove` listener was
  attached only inside `show()` — which runs *after* the show delay. A pointer
  that entered the trigger and then stayed still (the normal "hover to read"
  case) fired no `mousemove` during the delay, so the cursor rect was still
  undefined when `show()` ran and the follow-cursor `VirtualElement` fell back
  to the trigger's full rect — pinning the tooltip to the trigger's corner
  instead of the cursor. The cursor rect is now seeded from the `mouseenter`
  event and tracking begins immediately, so there is always a valid cursor rect
  before the first position. `hide()` now always detaches the listener (covers a
  pointer that leaves before the delay elapses, which would otherwise leak the
  listener), and `onMouseMove` only re-positions while visible.

## [1.0.0-rc10] - 2026-09-09

### Added

- **Cross-component overlay coordination — `registerOverlay`, `notifyOverlayActivated`,
  `dismissAllOverlays`, `onOverlayActivated`, `ALL_GROUPS`** (`src/overlay/active-overlay.ts`,
  exported from the package root). A framework-agnostic "one overlay open at a time" primitive:
  floating overlays across every KM component — and any *external* popover (Svelte, plain DOM,
  another framework) — dismiss each other when one opens. There is a single coordination channel:
  a `document` CustomEvent `km-overlay-activated` (namespaced like `km-log`) carrying
  `{ source, group }`, so **nothing has to import core to participate** — outside code can both
  trigger dismissal (dispatch the event, or `notifyOverlayActivated()`) and observe it
  (`addEventListener`, or `onOverlayActivated()`). `source` is an opaque `===` token so an opener
  never dismisses itself. **Groups** (`registerOverlay(onDismiss, group)`) scope coordination:
  opening a group-`A` overlay dismisses only other group-`A` overlays, ungrouped overlays share one
  default group, and `dismissAllOverlays()` crosses every group via the exported `ALL_GROUPS`
  wildcard. SSR-safe (no-op without `document`). This is the basis for the single-active-dropdown
  behaviour being wired into web-multiselect and web-daterangepicker.

## [1.0.0-rc09] - 2026-08-27

### Added

- **`observeViewport(cb)` + `BlissElement.viewportChanged(env)` — a throttled,
  continuous viewport-size channel** (`src/environment/`, SPEC §12.9). The
  environment observable now splits by cadence: `environmentChanged` stays the
  *discrete* channel (fires only on a `breakpoint`/`orientation`/pointer/hover/
  `isTouchPrimary` flip), while the new `viewportChanged` hook streams raw
  `viewportWidth`/`viewportHeight` changes **throttled to ~30 ms
  (`VIEWPORT_THROTTLE_MS`), leading + trailing** — for layouts that reflow
  *within* a device class (e.g. a desktop window shrinking narrow) without a
  breakpoint crossing. Both are opt-in (override-gated) and ref-counted over the
  same shared listeners, so an element that overrides only `environmentChanged`
  pays zero per-resize cost.
- **`observeElementSize(el, cb)` + `BlissElement.resized(size)` — per-element size
  reactivity** (`src/environment/element-size.ts`, SPEC §12.9). The element-box
  companion to `viewportChanged`: reflow to the component's *own box* (a picker in
  a narrow sidebar on a wide monitor), not the window. Backed by a **single,
  shared, page-wide `ResizeObserver`** fanned out per target, so N components pay
  for one observer. Fires with the real laid-out border box after connect, then on
  box changes, **throttled to ~30 ms (leading + trailing)** with identical-size
  dedup; opt-in (override-gated) and SSR-safe. **Prefer CSS container queries**
  (`container-type: inline-size` + `@container`) for *presentational* reflow —
  `resized()` is for *structural* reflow that needs a JS decision (a different
  number of rendered children, a `reinit()` input).

### Changed

- **`environmentChanged` no longer fires on raw viewport-size changes.**
  `viewportWidth`/`viewportHeight` were removed from the discrete equality gate,
  so a desktop drag-resize that crosses no breakpoint stops waking every
  subscriber ~60×/s. Components that relied on `environmentChanged` for live
  width should override `viewportChanged` instead; discrete breakpoint/orientation/
  capability flips are unaffected. The snapshot still carries the live width for
  synchronous `getEnvironment()` reads.

## [1.0.0-rc08] - 2026-08-24

### Added

- **`presentationContext(presentation)` + `PresentationContext` — shared render-context
  presentation flags** (`src/overlay/presentation.ts`). Builds `{ presentation, isFullscreen,
  isModal }` from a `ResolvedPresentation` so every component surfaces the *same* shape into
  its render callbacks (letting a custom renderer show rich content on the desktop floating
  panel and a leaner variant in the phone fullscreen sheet) instead of each re-deriving the
  booleans. Spread it into the per-item context handed to a consumer's callback; it reflects
  whatever the component's current `setPresentation` value is.

## [1.0.0-rc07] - 2026-08-20

### Added

- **`classifyDevice(env)` — shared, capability-based device classification**
  (`src/environment/`, SPEC §12.9). Returns `'mobile' | 'tablet' | 'desktop'`
  (`DeviceClass`) from the live environment: capability decides first (a
  non-`isTouchPrimary` device is always `desktop`, at *any* window width — so a
  narrowed desktop window keeps a floating dropdown, never a fullscreen sheet),
  and only touch-primary devices consult the size line (shorter viewport side
  below `TABLET_MIN_SHORT_SIDE` (600) ⇒ `mobile`, else `tablet`). This is a
  distinct axis from the width-only `EnvironmentSnapshot.breakpoint`; it's the one
  every KM component must agree on. `TABLET_MIN_SHORT_SIDE` now lives in
  `src/environment/` (still re-exported from the overlay module for its historical
  import path).
- **`resolvePresentation(mode, env, map?)` — overridable class→presentation policy**
  (`src/overlay/`). Splits the *policy* (which presentation a class gets) from the
  *classification* (`classifyDevice`), because it legitimately differs per
  component. `auto` classifies the device and looks it up in `map`, falling back
  per-class to `DEFAULT_PRESENTATION_MAP` (`{ mobile: 'fullscreen', tablet:
  'floating', desktop: 'floating' }`); a forced mode is returned as-is. Pass only
  the classes you override — e.g. `{ tablet: 'modal' }`. `MobilePresentation` /
  `ResolvedPresentation` gain a **`modal`** tier, and `PresentationMap` /
  `DEFAULT_PRESENTATION_MAP` are exported.

### Deprecated

- **`resolveMobilePresentation(mode, env)`** is deprecated in favour of
  `resolvePresentation` (+ `classifyDevice`). It's kept as a thin wrapper with its
  original binary `'floating' | 'fullscreen'` signature (equivalent to
  `resolvePresentation` with the default map; never returns `modal`), so rc06
  consumers are unaffected. To be removed at 1.0.

## [1.0.0-rc06] - 2026-08-19

### Added

- **Writing-direction (RTL) support in `BlissElement`.** The base now always observes
  the global `dir` attribute (in addition to the input-derived ones) and routes a
  runtime change to a new opt-in **`directionChanged(isRTL)`** hook — the RTL analogue
  of `environmentChanged`, letting a component re-mirror its live DOM on an app-wide
  RTL/LTR switch without a rebuild. Fires only for post-connect `dir` changes on the
  element itself (the initial direction is read by the first build; an ancestor-only
  `dir` flip isn't observed). Also adds a protected **`isRTL`** getter that resolves the
  effective CSS `direction` (accounting for `dir` on the element, an ancestor, `<html>`,
  or a CSS rule). No-op by default, so components that don't override the hook are
  unaffected beyond `observedAttributes` now including `dir`.

## [1.0.0-rc05] - 2026-08-18

### Added

- **Overlay / fullscreen presentation primitives** (`src/overlay/`, SPEC §12.9):
  the shared presentation convention §12.9 deferred to the daterangepicker PR,
  now in core so every KM component agrees on what "a phone" is and how a
  fullscreen sheet behaves.
  - **`resolveMobilePresentation(mode, env)`** — a pure, DOM-free function
    mapping a `mobile-presentation` setting (`'auto' | 'floating' | 'fullscreen'`)
    against an `EnvironmentSnapshot` to a concrete `'floating' | 'fullscreen'`.
    `floating`/`fullscreen` are forced; `auto` is the reactive rule — fullscreen
    when the device is touch-primary **and** its *shorter* viewport side is below
    the tablet boundary (orientation-robust, so a landscape phone still reads as a
    phone). Exposes `TABLET_MIN_SHORT_SIDE` (600 CSS px, the Material `sw600dp`
    line) as the single tunable knob, plus the `MobilePresentation` /
    `ResolvedPresentation` types. Feeds a component's `environmentChanged()` hook.
  - **`lockBodyScroll()`** — a ref-counted `document.body` overflow lock returning
    a release function. The first lock stashes and hides `overflow`; the last
    release restores it, so several overlays open at once stay correct and a
    nested lock never clobbers the original value. SSR-safe (no-op release
    without `document`); the returned release is idempotent.
  - **`observeKeyboardInset(panel)`** — pins a `position: fixed` fullscreen sheet
    above the soft keyboard by tracking `window.visualViewport` (writing inline
    `height`/`top`, coalesced to one write per frame). On iOS Safari and Android
    Chrome the keyboard overlays the layout viewport (`dvh` unchanged), so a flex
    column reflows to the visible area instead of hiding its list behind the
    keyboard. SSR-safe / no-op where `visualViewport` is unavailable; cleanup
    detaches the listeners and clears the inline styles.

## [1.0.0-rc04] - 2026-08-09

### Added

- **Environment detection** (`src/environment/`, SPEC §12.9): a zero-dep,
  SSR-safe, ref-counted observable over `matchMedia` + `resize` for device,
  viewport, and orientation. `getEnvironment()` (sync read),
  `observeEnvironment(cb, { immediate? })` (subscribe; fires immediately then on
  change), and `configureBreakpoints(map)` (redefine the width buckets). The
  `EnvironmentSnapshot` reports `pointer`, `hasCoarsePointer`, `canHover`,
  **`isTouchPrimary`** (`coarse && !hover` — the "phone/tablet" signal, honest in
  landscape where width alone lies), `orientation`, `viewportWidth`/`Height`, and
  the resolved `breakpoint`. Detection is feature-detection, not UA sniffing.
- **OS hint** on the snapshot: `os`
  (`ios`/`android`/`macos`/`windows`/`linux`/`unknown`) plus `isApple` /
  `isAndroid`. This is the one UA/Client-Hints-derived field (there is no media
  query for OS identity) — constant per session, with the iPadOS-masquerades-as-
  macOS correction via `maxTouchPoints`. Documented as a hint for OS-specific
  quirks, not a behavior gate (prefer `isTouchPrimary`).
- **`BlissElement.environmentChanged(env)` hook**
  (`src/element/bliss-element.ts`): overriding it opts the element into the
  environment observable — the base subscribes on every connect and unsubscribes
  on every disconnect (elements that don't override attach no listeners). Fires
  immediately with the current snapshot on connect, then on every change (a DOM
  move re-subscribes; an orientation flip re-fires). Motivating case: a component
  can flip to a fullscreen presentation on touch-primary devices instead of a
  focus-stealing floating panel.
- Logging: `setLogPersistKeyPrefix` / `getLogPersistKeyPrefix` and a `LOG_LEVELS`
  export (with a `LogLevelName` type) for the vendored engine — the persisted
  per-logger level key is namespaced (`km-log:…`) instead of `loglevel`'s bare
  global key.

### Changed

- **Logging engine vendored — `loglevel` is no longer a runtime dependency**
  (`src/logging/log-core.ts`). `@keenmate/web-components-core` now ships with a
  single runtime dependency (`@floating-ui/dom`, used only by `/positioning`);
  consumers no longer pull `loglevel` transitively. `loglevel` is CommonJS and its
  ESM interop for `log.levels` was awkward under the package's `Bundler`
  resolution + `verbatimModuleSyntax`; the vendored engine preserves named
  loggers, per-level gating, and the ordering-safe `%c` colour prefix. No API
  change to `createLoggers()` / `createPerfLogger()`.

## [1.0.0-rc03] - 2026-08-04

### Added

- **`anchor({ maxWidth })`** (`src/positioning/anchor.ts`): a width-cap option
  symmetric with the existing `maxHeight`. Adds a floating-ui `size()` middleware
  that caps the floating element's `max-width` to the space available on the
  resolved side — `true` for no inset, `{ padding }` to inset from the viewport
  edges — so a user-resizable dropdown/popover can't be dragged past the viewport
  edge (and long content wraps instead of overflowing horizontally). Mirrors
  `maxHeight`; only sets `max-width`. (First consumer: `<web-dropzone>`'s
  resizable compact-mode popover.)

## [1.0.0-rc02] - 2026-08-03

### Added

- **`BlissElement` form association** (`src/element/bliss-element.ts`): a public
  `get form(): HTMLFormElement | null` and a protected, lazily-attached
  `get internals(): ElementInternals | null`. Form-associated custom elements
  (`static formAssociated = true`) participate in a form but — unlike native
  controls — get no `.form` property for free; the browser records the
  association only inside `ElementInternals`. Core now re-exposes it so `el.form`
  and `event.target.form` resolve like a native input (host frameworks such as
  Phoenix LiveView route form changes by reading `target.form`). `attachInternals()`
  runs once, on first `internals`/`form` access, and is memoized — subclasses
  must read `this.internals` rather than calling `attachInternals()` themselves.
  Degrades to `null` when `attachInternals` is unavailable (SSR / older jsdom).

## [1.0.0-rc01] - 2026-08-03

### Added

- **Reactive input model** (`src/inputs/`): `Converter` / `InputDef` types and
  the `to*` converter factories — `toEnum`, `toInt`, `toFloat`, `toText`,
  `toBool`, `toBytes`, `toList`, `toCustom`, `toFunction` — each owning both the
  attribute parse path and the property validate path from one definition.
- **`BlissElement`** base class (`src/element/`): SSR-safe, table-driven
  `observedAttributes`, attribute + property reactivity through one pipeline,
  coalesced batching (`setAttributes()`, `batch()`, `flush()`), optional
  attribute reflection, pre-upgrade property capture, and the `reinit()` /
  `update(partial)` subclass hooks (opt-in, no-op by default). The input table is
  opt-in.
- **`BlissElement.flush()`** — apply pending input writes synchronously, now
  (running the resulting `reinit()`/`update()` before it returns). The escape
  hatch for **imperative methods** that read or mutate live state built from
  inputs: a loose property write coalesces on a microtask, so a synchronous
  method called right after (e.g. `el.setSelected(…)` following `el.options = …`)
  would otherwise run against pre-write state. Calling `this.flush()` at the top
  of such a method preserves the "set property, then call method" ordering
  without forcing consumers to `await whenSettled()` between the two.
- **Element lifecycle** (build-once + activate/deactivate, Lit's model): opt-in
  `connect()` / `disconnect()` hooks fire on every connect/disconnect for live
  resources (listeners, observers, floating-ui `autoUpdate`). A DOM move
  re-activates without rebuilding; `reinit()` runs only on first connect or an
  `on:'reinit'` change. Config changed while detached is applied on reconnect
  before `connect()`.
- Typed `dispatch()` (composed + bubbling by default) and idempotent, SSR-safe
  `define()`.
- DOM utilities (`src/dom/`): `resolveEnumAttribute`, `createMicrotaskScheduler`.
- **Always-on invalid-input warnings**: `BlissElement` emits `console.warn` for
  rejected property values and for converters that throw (falling back to the
  input's `default`). Deliberately bypasses the logger so it surfaces even when
  logging is disabled.
- **Dev-time input-table validation**: once per class, `BlissElement` warns (never
  throws) on a malformed `static inputs` table — duplicate `configKey`, duplicate
  `attribute`, `reflect: true` without an `attribute`, or `reflect: true` without
  `converter.toAttribute`.
- **Global registration** (`src/global/`, SPEC §12.3): `registerComponent(tag,
  elementClass, { config, logging?, shouldAutoDefine? })` publishes a component to
  the `window.components` global, defines the element (idempotently, auto by
  default), and flattens a `createLoggers()` bundle into the `logging` controls —
  replacing the block every shipping component copy-pasted (and drifted). Paired
  with a **live-instance registry**: `BlissElement` auto-tracks its connected
  instances per tag (add on connect / remove on disconnect; a DOM move re-tracks
  without duplicating), exposed via `getInstances(tag)` / the entry's
  `getInstances()` and `getRegisteredTags()`. The returned elements are the
  per-instance handles for a devtools overlay.
- **Per-instance logging** (SPEC §12.3): `BlissElement` exposes `this.log` — an
  instance logger per category of the tag's `createLoggers` bundle (wired by
  `registerComponent`'s `logging` option), each line prefixed with a `tag#id`
  handle (the element's `id` when set, else a `tag#n` counter) and gated by the
  more verbose of the type-level level and the instance's own
  override. `element.enableLogging(level?)` / `disableLogging()` /
  `isLoggingEnabled` toggle logging for ONE element while its type stays silent
  — the Ctrl-Alt-C overlay case. New `LoggerBundle.forInstance(id, getOverride)`
  factory and `InstanceLogger` type; components should prefer `this.log.<CAT>`
  over the shared type-level loggers.
- **Callbacks & events model** (`src/element/`, SPEC §12.5): one unified
  primitive for each of the two kinds the naming convention separates. **Events**
  — a `static events` table (bare name or `EventDef`), a typed `emit(name,
  detail)` (checked against `BlissElement<TEvents>`'s event map, per-event
  bubbles/composed overrides), and a managed `on<Name>` handler property
  (default `on` + PascalCase) that (de)registers a real listener so
  `el.onSelect = e => e.detail.option` equals `addEventListener('select', …)`
  and receives the `CustomEvent`; plus a typed `on(name, handler)` returning an
  unsubscribe. **`*Callback` hooks** — `runHook(key, ctx, { whenUnset, onError? })`
  owns the plumbing (unset→neutral, single-ctx arg, `Promise.resolve`
  normalization, rethrow-on-error unless `onError` supplied); the discriminated
  result contract stays per-component. Dev-time lint (warn-only) for duplicate /
  non-kebab event names and `on<Name>`↔input collisions. Event-name string
  standardization across components is deferred to each component's next major.
- **Logging** (`src/logging/`, SPEC §12.1): `createLoggers(namespace, categories?)`
  returns categorized `NAMESPACE:CATEGORY` loggers over `loglevel`, each with a
  color-coded `%c` prefix; `DEFAULT_CATEGORIES` (`INIT/DATA/UI`), redefinable and
  extendable; `enableLogging()` (defaults to `debug`) / `disableLogging()` /
  `setLogLevel()` / `setCategoryLevel()`. Plus the opt-in `createPerfLogger()`
  (`start`/`end`/`measure`/`summary`/`clear`).

- **Rich-data converters** (`src/inputs/converters.ts`, SPEC §5): `toValue`,
  `toObjectArray`, and `toObject` — the property-first analogue of `toFunction`
  for arrays/objects. The property path IS the shape check (`validate`), and a
  JSON attribute path applies when the input declares an `attribute` (malformed /
  wrong-shape → `default`; reflects as JSON). `toObjectArray` takes an optional
  per-item `validateItem` and defaults to `[]`; `toObject` requires a non-null,
  non-array object. Resolves the multiselect migration's gap #2 — the
  hand-written `toObjectArray()` moves into core.
- **`BlissElement.whenSettled()`** (SPEC §12.7): a first-class "await the
  reactive pipeline" signal. Resolves once every staged input change has flushed
  and its `reinit()`/`update()` has run (immediately when nothing is pending;
  after the coalescing microtask for loose property assignments; already-settled
  after `setAttributes()`/`batch()`; on the next connect for changes staged while
  detached). Deterministic read-after-write for tests and consumers alike.
- **Testing utilities** (`@keenmate/web-components-core/testing`, SPEC §12.7):
  runner-agnostic DOM fixtures (pure DOM, zero deps) — `mount(html|element)` with
  tracked `cleanup()`, `mountBeforeUpgrade()` for the pre-upgrade capture path,
  `uniqueTag()` / `defineOnce()`, `nextTick()` / `nextFrame()`, and
  `listen(target, type)` → an `EventSpy` for asserting §12.5 emits without a
  mocking library. Exposed as a separate subpath so it never enters the runtime
  bundle.
- **CEM tooling** (`@keenmate/web-components-core/cem`, SPEC §12.6): a
  `@custom-elements-manifest/analyzer` plugin (`blissInputsPlugin`) that reads the
  `static inputs` / `static events` tables so the manifest is generated from the
  single source of truth — structure from each row + its converter (attr↔prop,
  type, default, `reflect`, enum members), prose from optional `description` /
  `deprecated` fields on the row (or a leading comment). Ships with a shared
  analyzer config preset (`blissAnalyzerConfig`) and a pure, unit-tested extractor
  (`extractBlissClass`). Build-time only — no runtime dependency (the analyzer
  injects `typescript`).
- **CEM: `cssVariablesFromManifestPlugin()`** — a build-time analyzer plugin that
  reads a KeenMate `component-variables.manifest.json` and injects its variables
  into each custom-element declaration as `cssProperties`, so the VS Code /
  JetBrains editor-integration generators emit CSS-variable autocomplete
  (`vscode.css-custom-data.json` + `web-types.json`) for a component's `--*`
  theming surface. The manifest is the single source of truth (hundreds of
  entries), so this beats hand-annotating each variable as an `@cssproperty` JSDoc
  tag. Options: `manifestPath` (default `component-variables.manifest.json`,
  resolved from the analyzer cwd) and `include: 'component' | 'base' | 'both'`
  (default `'component'`). Retires the identical local plugin web-multiselect had
  hand-rolled; web-daterangepicker + web-treeview (same manifest shape) get the
  autocomplete by adding one line to their configs. The minimal Node built-in
  typings it needs live in `src/cem/node-builtins.d.ts` so core keeps no global
  `@types/node` dependency.
- **`InputDef` / `EventDef` doc metadata**: optional `description` and
  `deprecated` fields, read by the CEM tooling and otherwise ignored at runtime.
- **`InputDef.type` doc override** (SPEC §12.6): an optional string that replaces
  the converter-derived manifest type. The converter gives the structural type
  (`toEnum`→union, `toInt`→`number`, …), but it can't express a precise callback
  signature or generic — every `toFunction()` is just `Function`. Set `type:
  '(node: TreeNode<T>) => boolean'` to publish the exact TS text. Runtime-ignored,
  docs-only; multi-line `description` strings (template literals) already carry
  rich markdown prose verbatim.
- **Positioning** (`@keenmate/web-components-core/positioning`, SPEC §12.2): a
  floating-element positioning module over one pinned `@floating-ui/dom` (ends
  the 1.5/1.7 version drift across the five components). `anchor()` — the
  low-level primitive (`'fixed'` default, `offset→size→flip→shift` middleware,
  `matchWidth: 'min'|'exact'`, `lockPlacement` (`true` | `'freeze'`),
  `beforeCompute` per-frame hook, `autoUpdate`, `data-theme` inheritance for
  portaled layers per C-CS-10, and a `platform` escape hatch) — plus
  `createTooltip()` (hover/focus, delay, `followCursor` via a `VirtualElement`,
  `onBeforeShow`, and a `ShadowRoot` container for shadow-scoped tooltip CSS) and
  `createPopover()` (portaled dropdown/panel, width-match, placement lock).
  Exposed as a separate subpath so `@floating-ui/dom` stays out of the base
  import graph.
  - `lockPlacement: 'freeze'` flips once on the first computation, then pins the
    resolved placement (dropdown "open where it fits, then don't jump"); `true`
    keeps the initial placement via flip's `fallbackStrategy`.
  - `beforeCompute` runs each frame before positioning — publish the reference's
    measured width to a CSS var (themeable panel width) before `shift`/`size`
    measure, or clamp min/max width.
  - `anchor()` also takes `arrow` (adds floating-ui's `arrow()` middleware and
    positions the arrow element on the resolved side each frame), `maxHeight`
    (viewport-height-capping `size()` so a panel scrolls internally instead of
    overflowing), `flipPadding`, `autoUpdateOptions` (forwarded to `autoUpdate`,
    e.g. `{ elementResize: false }` to avoid a resize→reposition→re-hover loop),
    and `onComputed({ x, y, placement })`. Together these let a component with a
    bespoke popover/tooltip (arrow + height-cap + drift check, like
    web-daterangepicker's calendar and day/badge tooltips) route entirely through
    `anchor()` instead of hand-rolling `computePosition`.
  - `createTooltip`'s `onBeforeShow` lets a tooltip dismiss a related one that
    would overlap; a `ShadowRoot` container keeps tooltips in the shadow tree so
    they inherit component tooltip styling and `--*` vars.
  - Re-exports floating-ui's base `platform` object (alongside the `Platform`
    type). A component building a custom platform for the `anchor({ platform })`
    escape hatch (`{ ...platform, getOffsetParent }`) can now do so through core
    instead of taking a second, independently-versioned `@floating-ui/dom`
    dependency — core owns the one pinned version.
  - `createPopover` now forwards the full relevant `anchor` surface: `platform`,
    `beforeCompute`, `flip`, `shift`, `autoUpdate`, and `lockPlacement: 'freeze'`
    (widened from `boolean`). Previously the preset lacked these, forcing its own
    headline consumers (the multiselect dropdown, daterangepicker calendar) down
    to the low-level `anchor()`; the preset can now serve them directly.
- **Fixed-positioning containing-block helpers + drift diagnostic**
  (`src/positioning/containing-block.ts`): `getFixedPositionOffsetParent(el)` — a
  `getOffsetParent` for `anchor`'s `platform` hatch that omits `contain` /
  `container-type` (which browsers don't reliably honour for `position: fixed`);
  and `detectFixedDrift({ panel, reference, expectedX, expectedY, offsetParent })`
  → `DriftReport | null`, which verifies a fixed panel landed where it was placed
  (translating the expectation into viewport space) and, if it drifted, names the
  likely CB-establishing ancestor + its CSS. Plus `findContainingBlockCulprit` /
  `describeContainingBlockProps`. Generalizes the diagnostic web-multiselect had
  hand-rolled so every portaled component can warn about the same CSS gotcha; the
  branded message + once-guard stay with the consumer.
- **`anchor()` first-class `fixedContainingBlock` + `onDrift`** — sugar that
  retires the identical custom-platform + drift-check boilerplate both
  web-multiselect and web-daterangepicker hand-built. `fixedContainingBlock: true`
  makes core build `{ ...platform, getOffsetParent: () =>
  getFixedPositionOffsetParent(floating) }` internally — always resolving the
  offset parent from the **floating** element (never the reference, which can
  itself be a fixed CB, e.g. a badge cell with `transform` on hover, and whose
  containing block differs from a portaled panel's). An explicit `platform` still
  wins. `onDrift(report)` runs `detectFixedDrift` against that same frame each
  placement and fires only when the panel actually drifted, handing the component
  a `DriftReport` to brand its own warning — no more scraping the resolved offset
  parent out of the platform closure. Both components now anchor with
  `{ fixedContainingBlock: true, onDrift }` and their local platform/drift plumbing
  is deleted.
- **Style injection** (`src/dom/adopt-styles.ts`, SPEC §12.8): two zero-dep
  helpers for the shadow-root CSS plumbing every component re-rolls.
  `adoptStyles(root, ...cssStrings)` adopts static shared stylesheets (one cached
  `CSSStyleSheet` per unique string, shared across instances; `<style>` fallback;
  SSR-safe; dedup per root) — the `main.css?inline` case. `createStyleSlot(root,
  { position?, className? })` → `{ set, clear, destroy }` is a per-instance,
  replaceable `<style>` slot for the `customStylesCallback` case (consistent
  position, so re-setting replaces rather than stacks; `<style>`-based so user
  `@import` works). Free functions, not `BlissElement` methods — core stays
  render-agnostic.
- **CSS-var lint helpers** (`src/dom/css-var-lint.ts`, SPEC §12.8 — the third leg
  alongside `adoptStyles` / `createStyleSlot`): `extractConsumedCssVars(css,
  prefix)`, `declaredCssVars(css, prefix)`, `suggestCssVars(name, known)`, and the
  convenience `lintCssVars(css, { prefix, consumed })` → `CssVarFinding[]`. Catch
  the silent-failure class where injected CSS (a `customStylesCallback`) *sets* a
  `--prefix-*` variable the component's stylesheet never *reads* (a typo like
  `--ms-badge-text-background` for `--ms-badge-text-bg`), with token-overlap typo
  suggestions. Pure and bundler-agnostic on purpose — NO dev-mode gating and NO
  `console`; the consumer decides when to run it (under its own dev flag) and how
  to report. Generalizes the helper web-multiselect had hand-rolled for `--ms-`.

### Changed

- `toText` gained an `isNullable` option: `toText({ isNullable: true })` resolves
  an absent or empty attribute to `null` (an optional string) instead of `''`, so
  callers can tell "unset" from "empty". `null` is the same absent-sentinel
  `toEnum`'s `shouldNullOnInvalid` uses; `null` is accepted on the property path
  (to clear), `''` is still rejected. Non-nullable `toText` is unchanged.
  `isEmptyAllowed` and `isNullable` are orthogonal (keep `''` vs. set the unset
  sentinel to `null`). Surfaced by the multiselect pseudo-migration, where ~20
  attributes are `string | null`.
- **Converter option names now follow the house boolean-naming convention**
  (`is`/`should` prefixes, matching the components' own `isGroupsAllowed` /
  `shouldKeepSearchOnClose`): `toText`/`toList` `trim` → `shouldTrim`, `toText`
  `allowEmpty` → `isEmptyAllowed`, `toEnum` `nullOnInvalid` → `shouldNullOnInvalid`.
  `toList`'s options were also spelled out for intent: `of` → `itemType`, `sep`
  → `separator`, `count` → `requiredCount` (an exact fixed-length check; leaves
  room for future `minRequiredCount` / `maxAllowedCount`). Remaining options
  (`default`, `min`, `max`) are unchanged. Pre-1.0, applied without a
  deprecation shim.
- SPEC §6/§11.3: the single `applyConfig(partial)` hook was split into
  `reinit()` (full rebuild; first connect and any `on: 'reinit'` change) and
  `update(partial)` (in-place patch of changed `on: 'update'` keys). A batch that
  touches any reinit input calls `reinit()` only — the rebuild reads full
  `this.config`, so the update partial is suppressed.
- SPEC §12.1 amended: `loglevel-plugin-prefix` dropped; core depends on
  `loglevel` only and does the colored `%c` prefix in a `loglevel` methodFactory
  (ordering-safe), avoiding the plugin's browser `%c` ordering bug.
- **`toFunction()` now accepts `null` / `undefined`** (value type `Converter<F |
  null>`), so a callback can be CLEARED by assignment — `el.onThing = null`,
  exactly like a DOM event-handler property. Previously the property validator
  rejected anything non-callable, so a callback could never be unset once set.
  Surfaced by the multiselect pseudo-migration (`el.customStylesCallback = null`).

### Fixed

- **`getFixedPositionOffsetParent` no longer returns the element itself.** The
  walk started at the element, so an `el` that itself establishes a fixed
  containing block (e.g. a badge cell with `transform: scale(...)` on hover) was
  returned as its own offset parent — and a component passing it as Floating UI's
  `getOffsetParent` then got element-relative coordinates that render off-screen
  once applied as `position: fixed`. It now starts at the parent (an element is
  never its own containing block). Surfaced by web-daterangepicker badge tooltips.
- **Pre-upgrade property now wins over the initial attribute (dual-path
  inputs).** A property assigned before the element was defined
  (`el.disabledDates = […]` then `customElements.define(...)`) was lifted in the
  constructor, but the browser replays the initial `attributeChangedCallback`s
  *after* the constructor — so an initial attribute (`disabled-dates="…"`) for
  the same key clobbered the lifted property. `BlissElement` now records the
  configKeys carrying a pre-upgrade value and skips that *initial* attribute for
  them, restoring the conventional lazy-property-upgrade guarantee; post-connect
  `setAttribute()`s still react normally. Surfaced by the web-daterangepicker
  migration (its `disabledDates`/`monthNames`/`weekdayNames`/`*Member` inputs are
  genuinely dual-path); multiselect never hit it because its rich `options` is
  property-only.
- **CEM: `toEnum` unions now resolve through `as const` and a shared members
  const.** The extractor only matched a bare `ArrayLiteralExpression`, so the two
  forms components actually use — `toEnum(['a','b'] as const, …)` and
  `toEnum(SHARED_PLACEMENTS, …)` — fell back to `string` instead of the member
  union. It now runs the argument through the same `resolveArrayLiteral` used for
  the input/event tables (peeling `as const` and following identifiers).
- **CEM: `registerComponent()` is now recognized as a custom-element
  definition.** The stock analyzer only understands `customElements.define()`, so
  a component registered via core's `registerComponent()` (SPEC §12.3) produced a
  plain class declaration — no `customElement: true`, no `tagName`, no
  `custom-element-definition` export. `blissInputsPlugin` now detects the call
  (unwrapping an `as`-cast class argument) and fills those in. New exports:
  `parseRegisterComponentCall`, `extractRegistrations`, `ExtractedRegistration`.

### Decided

- `toText` (not `toStr`) for the string converter (SPEC §11.1).
- `configKey` (not `key`) for the input-def option key (SPEC §11.2).
- `toBool` accepts a permissive vocabulary (`true/1/yes/on` · `false/0/no/off`,
  case-insensitive); an unrecognized explicit value falls back to the mode
  default, like an absent attribute.
- Store/satellite pattern stays dropzone-local for now (SPEC §11.4).
- Removing an attribute resets that input to its `default` and is reactive
  (absent == default), consistent with construction and the converter layer.

[Unreleased]: https://github.com/keenmate/web-components-core/commits/prod

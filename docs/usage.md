# Usage — @keenmate/web-components-core

The full API of the library: the input model, the `BlissElement` base class, the page-wide
helpers and every subpath. The [README](../README.md) is the landing page; theming lives in
[theming.md](theming.md), worked examples in [examples.md](examples.md), keyboard / ARIA /
focus in [accessibility.md](accessibility.md).

> **[`SPEC.md`](SPEC.md) is the source of truth** for design intent. This file is the tour;
> read the relevant SPEC section before changing behavior. How the pipeline coalesces bursts
> is in [`reactivity-and-batching.md`](reactivity-and-batching.md).

Contents: [The two load-bearing ideas](#the-two-load-bearing-ideas) ·
[`BlissElement`](#blisselement--the-base-class) ·
[Environment & presentation](#environment--presentation-device--viewport--orientation) ·
[Responsive rules](#responsive-rules-page--per-tag--instance) ·
[Motion level](#motion-level-none--snappy--smooth) ·
[Global registration](#global-registration-windowcomponents) · [Logging](#logging) ·
[Style injection](#style-injection) · [Container scroll](#container-scroll) ·
[Positioning](#positioning-keenmateweb-components-corepositioning) ·
[Menu](#menu-keenmateweb-components-coremenu) · [Search](#search-keenmateweb-components-coresearch) ·
[Testing](#testing-keenmateweb-components-coretesting) ·
[Editor metadata](#editor-metadata-keenmateweb-components-corecem) · [API index](#api-index) ·
[Commands](#commands)

The theme context (`data-context-theme`, `setThemeMode()`) and menu theming are in
[theming.md](theming.md).

## The two load-bearing ideas

### 1. One reactive input table

Every public input — attribute, complex property, or callback — is a single
`InputDef` row. There is **no central switch statement**: dispatch is just
`def.converter.fromAttribute(raw)`. A new input type is a new converter created
anywhere (core or a component), never a core edit.

```ts
import { BlissElement, toEnum, toInt, toText, toFunction, type InputDef } from '@keenmate/web-components-core';

const INPUTS: readonly InputDef[] = [
  { configKey: 'selectionMode', attribute: 'selection-mode',
    converter: toEnum(['single', 'multiple'], { default: 'single' }), on: 'reinit' },
  { configKey: 'maxHeight', attribute: 'max-height',
    converter: toText({ default: '20rem' }), on: 'update' },
  { configKey: 'minSearchLength', attribute: 'min-search-length',
    converter: toInt({ min: 0, default: 1 }), on: 'update' },
  // property-only (no attribute): callbacks and rich data
  { configKey: 'getValueCallback', converter: toFunction(), on: 'reinit' },
];
```

**Typing the properties (one line, every component).** Core installs each row's property on the
instance at runtime, so TypeScript can't see it. Every component types them the same way — an
interface with the element class's name, merged into the class (declaration merging), extending
the component's element config type (the one its responsive rules already target):

```ts
export class WebTreeViewElement<T = any> extends BlissElement<TreeViewEvents> { /* … */ }
// every input as a typed property: el.dropZoneMaxWidth, el.isDisabled, …
export interface WebTreeViewElement<T = any> extends TreeViewElementConfig<T> {}
```

The config type lists exactly the input rows (`configKey` → value type), nothing else; the class
declares no member of the same name (the input-table check warns, it would be dead). Rulebook
C-CA-16 checks the merge exists.

Each row declares **what a change triggers** via `on`:

- `update` — patch in place (default)
- `reinit` — requires a full rebuild
- `none` — store only, don't react (e.g. event callbacks)

### 2. The `Converter<V>` owns parsing *and* validation

One converter per input handles the attribute path (`fromAttribute`: raw string
→ validated `V`), the property path (`validate`: is this JS-assigned value
acceptable?), and optional reflection (`toAttribute`). Correctness lives in one
place so it can't drift across the three spots it used to.

The `to*` factory library sets both paths from the same inputs:

| factory | for |
| --- | --- |
| `toEnum(values, { default?, isNullable? })` | fixed string set |
| `toInt({ min?, max?, default?, isNullable? })` / `toFloat(...)` | numbers; `isNullable` = absent / empty → `null` (unset) |
| `toText({ shouldTrim?, isEmptyAllowed?, isNullable?, default? })` | strings (`isNullable` → optional string, absent/empty ⇒ `null`) |
| `toBool('default-false' \| 'default-true' \| 'tristate' \| 'presence')` | booleans — mode required; `'presence'` is the native rule (`x="false"` is still `true`), meant for `disabled` / `readonly` |
| `toBytes({ default? })` | human sizes (`"10mb"`) |
| `toList({ itemType?, separator?, requiredCount?, shouldTrim?, default? })` | delimited lists |
| `toCustom(parse, { validate?, toAttribute? })` | bespoke parsers |
| `toFunction()` | property-only callbacks |
| `toValue({ validate?, default? })` | rich value (property = validate, attribute = JSON) |
| `toObjectArray({ validateItem?, default? })` | array of rich items (e.g. `options`); default `[]` |
| `toObject({ validate?, default? })` | plain non-array object |

> Boolean options follow the house convention (`is`/`should`/`has`/`can`
> prefixes): `shouldTrim`, `isEmptyAllowed`, `isNullable`.

## `BlissElement` — the base class

`BlissElement` wires both entry points (attribute + property) through the *same*
pipeline, so everything is reactive by construction. It is SSR-safe, computes
`observedAttributes` from the input table, coalesces bursts into a single update,
and provides typed event dispatch. The input table is **opt-in** — a subclass
without `static inputs` still gets the SSR-safe base plus typed events (`emit()` /
`on()`), which is how `web-grid` uses it while keeping its own config-object API.

```ts
class WebMultiSelect extends BlissElement {
  protected static override inputs = INPUTS;

  protected override reinit() { /* full rebuild — reads this.config */ }
  protected override update(partial: Record<string, unknown>) { /* patch just the changed keys */ }
  protected override connect() { /* start listeners / observers / timers */ }
  protected override disconnect() { /* stop what connect() started */ }
}
```

**Lifecycle** (build-once + activate/deactivate, Lit's model):

- **`reinit()`** — first connect, and any batch touching an `on: 'reinit'` input.
  In a mixed batch, reinit dominates (it rebuilds from full `this.config`, so the
  `update` partial is suppressed).
- **`update(partial)`** — a batch with only `on: 'update'` changes.
- **`connect()` / `disconnect()`** — every connect/disconnect, for live
  resources. A DOM move re-activates **without rebuilding**, so transient UI
  state survives. Keep them balanced.
- **`destroy()`** (public) — final teardown: runs `disconnect()` if active,
  cancels pending work, then the protected **`destroyCallback()`** hook for the
  component's own cleanup; `el.isDestroyed` turns `true`. Idempotent. A destroyed
  element is inert — re-inserting it warns and never rebuilds.

**Defer / release / ready** (every component): `<x-comp defer>` (or `el.shouldDefer =
true` before connect) holds the first build — no `reinit()`/`update()`/`connect()`
— while you wire options, callbacks and listeners; **`el.release()`** (or removing
`defer`) then builds **once** with everything in place. Order: `defer` →
`release()` → `reinit()` → `connect()` → **`ready`**. After the first build the host
gets the `ready` attribute and `:state(ready)`, the `ready` event (+ `onReady`
twin) fires once, `el.isReady` turns `true`, and **`await el.whenReady()`**
resolves — all on the microtask after the build, so a `ready` listener added right
after `createElement` / append / the import still catches it. Latched — a later
`defer` never re-holds.

```css
x-comp[defer]:not([ready]) { min-height: 2.5rem; visibility: hidden; }
```

**Refused values are reported** (every component): an invalid attribute or property
value warns and keeps the previous value, and fires **`input-rejected`** (+
`onInputRejected`) before the write returns, so a framework wrapper can surface it or
revert its bound value. `setProperties()` returns the same list:

```js
el.addEventListener('input-rejected', (e) => {
  e.detail; // { configKey: 'limit', attribute: 'limit', value: 'abc', reason: 'expected an integer', kept: 50, source: 'attribute' }
});
const rejected = el.setProperties({ limit: 'x', colour: 'red' }); // [{ configKey: 'limit', … }, { configKey: 'colour', … }]
```

**Disabled**: core implements `formDisabledCallback` for form-associated elements.
A component reads `this.isEffectivelyDisabled` (its `isDisabled` input OR a
disabled ancestor `<fieldset>`) in `reinit()` and applies flips in the
**`disabledChanged(isDisabled)`** hook. The `isDisabled` input (attribute `disabled`)
**must reflect** (`shouldReflect: true`) — the browser disables a form-associated
element by its own `disabled` attribute, so a non-reflecting input would stay
disabled after `el.isDisabled = false` (core warns). A fieldset never writes
`el.isDisabled`.

Batch many changes into one reinit/update with `setProperties({ ... })` or
`batch(() => { ... })`. A `setProperties()` key that isn't an input (configKey or
attribute name, or a core-declared `shouldDefer` / `themeSource` / `responsive*`) warns and
is skipped — a renamed or misspelled key is never dropped silently. To await the pipeline deterministically — in a test or
before reading rendered state — use **`await el.whenSettled()`**: it resolves
once every staged change has flushed and its `reinit()`/`update()` has run
(immediately when nothing is pending).

## Environment & presentation (device / viewport / orientation)

Width buckets (`env.breakpoint`) default to `mobile ≤ 768`, `tablet ≤ 1024`, `desktop` — the
pure-css lines — and follow the base tokens `--base-breakpoint-mobile` / `--base-breakpoint-tablet`
when the page defines them (read until found, at the latest when the page has loaded);
`configureBreakpoints()` overrides both. Changing the
tokens at runtime moves only the components' buckets, not pure-css's compiled `@media` rules —
change the breakpoints in SCSS (`$base-breakpoint-*`) so both agree.

Components that swap a floating panel for a fullscreen sheet (or a modal) on
smaller devices share one signal instead of each re-deriving "what is a phone."

**React to the device** by overriding `environmentChanged(env)` — the base
subscribes on connect and unsubscribes on disconnect (no listeners unless you
override it), fires immediately with the current snapshot, then on every
pointer / hover / orientation / viewport change. For a one-off synchronous read,
call `getEnvironment()`.

**Classify, then present — two separate concerns:**

- **`classifyDevice(env)` → `'mobile' | 'tablet' | 'desktop'`** is the *shared*
  classification every component must agree on. **Capability decides first:** a
  non-touch device is always `desktop` at *any* width — so a **narrowed desktop
  window keeps its floating dropdown, never a fullscreen sheet**. Only touch
  devices consult the 600px short-side line (`mobile` below it, `tablet` at/above).
  This is a different axis from the width-only `env.breakpoint` (a landscape iPad
  is `breakpoint: 'desktop'` yet `deviceClass: 'tablet'`).
- **`resolvePresentation(mode, env, map?)` → `'floating' | 'modal' | 'fullscreen'`**
  is the *per-component policy*. `mode` is the author setting (`'auto'` |
  `'floating'` | `'modal'` | `'fullscreen'`); a forced value wins, and `'auto'`
  classifies the device and looks it up in `map`, falling back per-class to
  `DEFAULT_PRESENTATION_MAP` (`mobile → fullscreen`, tablet/desktop → `floating`).
  You list only the classes you change:

```ts
protected override environmentChanged(env: EnvironmentSnapshot) {
  // "on a tablet, use a modal" — phone & desktop keep the defaults:
  this.setPresentation(resolvePresentation(this.mode, env, { tablet: 'modal' }));
}
```

**Need a rule *finer* than the class** — e.g. "desktop, but under 800px show a
modal"? The `map` is class-keyed, so drop to `classifyDevice(env)` and read the
current width off the snapshot yourself (`env.viewportWidth`):

```ts
protected override environmentChanged(env: EnvironmentSnapshot) {
  if (this.mode !== 'auto') return this.setPresentation(this.mode);
  const cls = classifyDevice(env);
  this.setPresentation(
    cls === 'mobile'        ? 'fullscreen' :
    cls === 'tablet'        ? 'modal'      :
    env.viewportWidth < 800 ? 'modal'      :   // desktop, narrow
                              'floating',      // desktop, wide
  );
}
```

Rule of thumb: **class-only policy → `resolvePresentation(mode, env, map)`;
width-aware → `classifyDevice(env)` + your own branch.** For the fullscreen tier,
`lockBodyScroll()` and `fitToVisibleViewport(panel)` handle page-scroll locking
and keeping the sheet above the soft keyboard. See [SPEC §12.9](SPEC.md) for
the full rationale (why 600px, capability over width). The author-facing setting
type is `Presentation` (`'auto' | 'floating' | 'modal' | 'fullscreen'`).

### Phone sheet session (scroll lock + keyboard inset + Back)

The one way a full-screen sheet / modal runs while open — never a component's own `pushState()`
(rulebook C-RO-6), never the three pieces wired by hand:

```ts
import { startSheetSession } from '@keenmate/web-components-core';

// on open (fullscreen / modal tier), once the panel is mounted
this.#sheet = startSheetSession(panel, {
  backCallback: () => this.close('back'),          // phone Back closes it
  // one level up instead: call this.#sheet.rearmBack() from inside backCallback
});

// on EVERY close (✕, Escape, a pick, Back, disconnect — ending twice is a no-op)
this.#sheet?.end();
```

It locks page scroll (`lockBodyScroll`), tracks the virtual keyboard (`fitToVisibleViewport`), holds one
history entry for the whole page (`claimBackEntry`; closing any other way gives it back one task later, and
the page keeps its scroll position), and warns once when an ancestor with `transform` / `filter` / … traps
the fixed panel in its own box. `shouldLockScroll` / `shouldFitToVisibleViewport` /
`shouldCheckContainingBlock: false` switch a piece off; the three helpers stay exported for anything else.

### Modal session (dialog / centered picker / full-screen sheet)

A **modal** blocks the page until it closes. `startModalSession` is the one way a component runs its own
modal panel ([SPEC §12.19](SPEC.md)) — never a hand-written Tab trap or backdrop listener:

```ts
import { startModalSession, Z_INDEX } from '@keenmate/web-components-core';

// on open, once the panel is mounted (its z-index: Z_INDEX.modal)
this.#modal = startModalSession(panel, {
  backdrop: true,                         // core adds a dimmed <div> before the panel; or your own element; omit = none
  dismissCallback: (reason) => this.close(reason),  // 'escape' | 'back' | 'backdrop' | 'overlay' | 'parent'
  trigger: this.#input,                   // focus returns here on end()
  // shouldFitToVisibleViewport: true,    // a FULL-SCREEN sheet: size to the visual viewport
});

// on EVERY close
this.#modal?.end();
```

While open: the page behind is `inert` (clicks, focus and screen readers stay in the panel; overlays mounted
later — a dropdown portaled to `<body>` from inside — still work), Tab cycles inside, focus moves in
(`[autofocus]` → first tabbable → the panel), `role="dialog"` + `aria-modal="true"`, page scroll locked,
Escape through the overlay tree (a dropdown opened inside closes first), the phone Back gesture.
`createFocusTrap(panel, opts)` → `{ release() }` (from `/a11y`) is the trap alone (inert + Tab cycling + focus in / back);
`getTabbables(container)` lists the tabbable elements in flat-tree order (shadow roots and slots included).

**Opened on a press?** A component that opens its modal on `pointerdown` / `mousedown` (to keep the phone
keyboard down) passes `isOpenedByPointer: true`: the tap's own `click`, which arrives a moment later at the same
spot, would otherwise land on the new panel (pick an option) or the backdrop (close it). Opening on `click` or
the keyboard needs nothing. `guardGhostClick(elements, { durationMs, trailingFocus })` → `stop()` is the guard
alone, for a non-modal popup.

### Ready-made dialogs (`@keenmate/web-components-core/dialog`)

The styled, translatable replacement for `window.confirm` / `window.prompt` — never those in a component:

```ts
import { confirmDialog, promptDialog, openDialog } from '@keenmate/web-components-core/dialog';

if (await confirmDialog({ title: 'Delete row?', message: 'This cannot be undone.', isDanger: true, confirmLabel: 'Delete' })) …

const url = await promptDialog({
  title: 'Image URL', value: 'https://',
  validate: (v) => (/^https:\/\/.+/.test(v) ? null : 'Must start with https://'),   // keeps it open + shows the message
});                                                    // null = cancelled

const choice = await openDialog({
  title: 'Unsaved changes',
  message: 'Save before closing?',                     // text (escaped); content: aNode for your own markup
  actions: [{ value: 'discard', label: 'Discard', isDanger: true }, { value: 'save', label: 'Save', isPrimary: true }],
  labels: { ok: 'OK', cancel: 'Cancel', close: 'Close' },   // from your component's labels
}).result;                                             // 'save' | 'discard' | null (✕ / Escape / Back / backdrop)
```

A centered card (a bottom sheet under 480px wide) in its own layer on `<body>` (`container` to move it), over
a backdrop, the shared sheet header on top. `isDismissible: false` = only the buttons close it;
`beforeCloseCallback(value)` returning `false` keeps it open. Danger confirms start focus on Cancel. Theme:
`--km-dialog-*` on `:root` (width, bg, border, radius, shadow, padding, duration), the `--base-*` tokens
underneath; `--km-modal-backdrop-bg` for the backdrop.

### Sheet header (title + close button)

A **sheet** is a panel that covers the page on a phone — a bottom sheet, a side drawer, a full-screen
picker. One header bar for every sheet ([SPEC §12.9](SPEC.md)) — never a component's own ✕ button CSS.
Its variables (`--km-sheet-*`, a component's `--<prefix>-sheet-*`) style that top bar only: the strip
(`header-*`), its title (`title-*`) and the round close button (`close-*`):

```ts
import { adoptStyles, createSheetHeader, SHEET_CHROME_CSS } from '@keenmate/web-components-core';

adoptStyles(this.shadowRoot!, SHEET_CHROME_CSS);          // once, into the root the sheet lives in
const { header, title, close } = createSheetHeader({
  title: this.labels.sheetTitle,                         // null = no title (a search field instead)
  closeLabel: this.labels.close,                         // from the component's labels
  closeCallback: () => this.close('close-button'),
});
header.classList.add('xx__sheet-header');                // your own hooks
// a search field instead of a title: createSheetHeader({ title: null, content: searchField, … })
//   (`content` goes between the title and the close button; give it flex: 1)
panel.prepend(header);
```

Already building the markup? Add `km-sheet-header` / `km-sheet-title` / `km-sheet-close` to your
elements instead (the close is an empty `<button type="button" aria-label="…">`). Theme it per
instance by mapping your variables onto the private layer, with no fallback:

```css
:host {
  --_km-sheet-close-size: var(--xx-sheet-close-size);
  --_km-sheet-header-bg: var(--xx-sheet-header-bg);
}
```

### Full-screen sheet frame (`.km-sheet`)

The phone full-screen sheet PANEL is core's `.km-sheet` class (SPEC §12.9) — never a component's own
`position: fixed; 100dvw × 100dvh; env(safe-area-inset-*)` block. It is a flex column (the header, then
`.km-sheet-body`, the scroller), full-bleed background, content padded out of the safe areas, the modal tier,
pinned by `top` / inline-start (not `inset: 0`: the keyboard inset sets an inline `height`). Every phone sheet is
modal (rule C-CA-19):

```ts
adoptStyles(this.shadowRoot!, SHEET_CHROME_CSS);
panel.classList.add('km-sheet');                         // its anchored / floating classes off
body.classList.add('km-sheet-body');                     // or your own scrolling column (flex: 1; min-height: 0)
panel.replaceChildren(createSheetHeader({ title, closeLabel, closeCallback: () => close() }).header, body);
const session = startModalSession(panel, {
  dismissCallback: () => close(),
  shouldFitToVisibleViewport: true,                     // the soft keyboard shrinks the sheet, not the list
  isOpenedByPointer,                                    // opened on a press
});
const close = () => { session.end(); animateOut([panel], { className: 'km-sheet--closing', doneCallback: () => panel.remove() }); };
```

Theme it like the header: `--_km-sheet-bg` / `-color` / `-z-index` / `-duration` / `-enter-offset` on your host
from your own variables (no fallback); the page sets `--km-sheet-*`. `.km-sheet` is one class in
`@layer component` — drop (or out-rank) your panel's own floating geometry (`max-height`, radius, shadow) in sheet
mode.

## Stacking tiers (`Z_INDEX`)

One z-index scale for every overlay (the `--base-z-*` tokens, SPEC §12.18). Use the constant in CSS you
write from JS, or the same `var()` in a stylesheet:

```ts
import { Z_INDEX } from '@keenmate/web-components-core';

const CSS = `
  .my-dropdown { z-index: ${Z_INDEX.dropdown}; }        /* var(--base-z-dropdown, 7500) */
  .my-sheet    { z-index: ${Z_INDEX.modal}; }           /* a phone full-screen sheet = modal tier */
  .my-sheet .hint { z-index: calc(${Z_INDEX.tooltip} + 1); }
`;
```

`modalBackdrop` 6000 < `modal` 7000 < `dropdown` 7500 < `popover` 7600 < `toast` 8000 < `tooltip` 9000.
Dialogs, sheets and drawers are `modal`, so a dropdown or tooltip opened inside one stacks above it. A
component's own sub-layer is `calc(<tier> + 1)`; no bare numbers like `9999`.

## Form submission (hidden inputs)

Components submit through light-DOM hidden inputs, never `setFormValue` ([SPEC §12.21](SPEC.md)):

```ts
import { createFormInputs, formatFormValue } from '@keenmate/web-components-core';

#form = createFormInputs(this);                 // once

// whenever the value changes
const { value, error } = formatFormValue(selectedValues, this.config.valueFormat, {   // 'json' | 'text' | 'array'
  separator: this.config.valueSeparator,        // 'text'
  callback: this.config.getValueFormatCallback && ((values) => this.config.getValueFormatCallback(this.withContext({ values }))),
});
this.setFormatError(error ?? null, this.labels.valueFormatError);
if (error) this.emit('value-format-error', { error, value: selectedValues });
this.#form.write(this.config.name, value, { isDisabled: this.isEffectivelyDisabled });
// a string → <input type="hidden" name="x">; an array → one <input name="x[]"> per item; no name → none
```

The inputs never get an `id`; `clear()` removes them (`destroyCallback()`).

## Async loading (search-as-you-type, lazy options)

One runner per async source ([SPEC §12.22](SPEC.md)) — never your own abort controller + "is this still the
latest" check:

```ts
import { createAsyncRunner } from '@keenmate/web-components-core';

#search = createAsyncRunner({
  debounceMs: () => this.config.searchDebounce,   // 0 = start at once
  loaderDelayMs: 0,                                // > 0: a fast answer never flashes the loader
  loadingChangeCallback: (isLoading) => this.#renderLoading(isLoading),
  errorCallback: (error) => this.log.DATA.error('searchCallback failed', error),   // never an AbortError
  logSource: this,
});

this.#search.run(
  (signal) => this.config.searchCallback({ term, signal }),   // sync or async
  (items) => this.#renderOptions(items),                      // only the latest run lands
);
this.#search.cancel();                                         // close / disconnect()
```

## Screen-reader announcements

Say what changed when focus doesn't move ([SPEC §12.23](SPEC.md)):

```ts
import { announce } from '@keenmate/web-components-core';

announce(this.labels.resultCount(items.length));                 // polite: "12 results"
announce(this.labels.invalidDate, { politeness: 'assertive' });  // errors only
```

One hidden live region per page, shared by every component; the same text twice is read twice. Your visible
toast or message stays yours — `announce()` is what screen readers hear.

## Labels and locale (`@keenmate/web-components-core/locale`)

Every UI string goes through one seam ([SPEC §12.24](SPEC.md), rulebook D-NC-24):

```ts
import { createLabels, resolveLocaleSettings, getMonthNames, formatNumber } from '@keenmate/web-components-core/locale';

// English only; flat keys `<elementType>.<name>` (buttons, tooltips, ariaLabels, placeholders, headers, labels,
// messages, errors, menuItems, columnHeaders)
const DEFAULT_LABELS = { 'ariaLabels.cancelFile': 'Cancel {name}', 'labels.addNew': 'Add <b>{value}</b>' };

// tag = the component's own name: the prefix of the full keys (`web-dropzone.ariaLabels.cancelFile`)
#labels = createLabels(this, DEFAULT_LABELS, () => this.config.labels, { tag: 'web-dropzone', getLocale: () => this.config.locale });

button.setAttribute('aria-label', this.#labels.text('ariaLabels.cancelFile', { name: file.name })); // text: never escaped
row.innerHTML = this.#labels.html('labels.addNew', { value: typed });                                // HTML: the value is escaped

const { locale, dateFormat, timeFormat, weekStartDay } = resolveLocaleSettings({ locale: this.config.locale });
getMonthNames(locale);                          // from Intl — no language tables
formatNumber(1234.5, { locale });               // '1 234,5' with the page's separators

protected override localeChanged(): void { this.#renderTexts(); }   // a page-wide change: re-render, keep state

// a user callback gets ctx.labels = { text, html } — the same chain (translateCallbacks included), never a plain object
ctx.labels = createLabelsView(this.#labels);   // ctx.labels.html('labels.days', { count })
```

The page sets it once, for every component:

```js
window.components.locale = {
  locale: 'en-US',                       // unset = the browser language
  decimalSeparator: ',',                 // the user's preference, every element
  // ONE flat dictionary keyed `<component>.<elementType>.<name>` — the app's whole translation JSON fits
  labels: { 'web-dropzone.ariaLabels.cancelFile': 'Zrušit {name}', 'web-multiselect.placeholders.search': 'Hledat…' },
};
// components pass counts as numbers: `{count}` shows as `12 345` in Czech

// or delegate to the app's own i18n: the FULL key, the template, the RAW params (12345, for plurals);
// null / undefined = not mine (core uses `labels` / the English default)
window.components.locale = {
  translateCallback: ({ key, params }) => {
    // a label's context arrives as params.ctx; ctx.count = the number to pluralize by (i18next's `count`,
    // which exists() needs too — a key with only _one / _other forms doesn't exist without it)
    const options = { ...params, count: params.ctx?.count };
    return i18next.exists(key, options) ? i18next.t(key, options) : null;
  },
};

window.components.security = { shouldEscapeLabels: true };   // labels are plain text, not HTML
```

Per key: the instance `labels` → the page-wide `labels['<component>.<key>']` (or `translateCallback`) → English.
The instance takes the short key or the full one, and wins over the callback — a key set on the element is never
sent to it (`<web-multiselect labels='{"placeholders.select": "Vyberte zemi…"}'>`).

One element can carry its own `translateCallback` (same shape, asked before the page-wide one; `null` passes the
key on), so a page with a single component needs no `window.components.locale`:

```js
grid.translateCallback = ({ key, params }) => (i18n.has(key) ? i18n.t(key, params) : null);
```

Twins share `<name>`. A screen-reader name or tooltip nobody set follows its customized visible sibling, so
translating only the caption is enough:

```js
window.components.locale = { labels: { 'web-dropzone.buttons.retryFile': 'Zkusit znovu' } };
// ariaLabels.retryFile / tooltips.retryFile (still English built-ins) now read 'Zkusit znovu' too;
// set them explicitly to differ. Visible types (buttons, labels, messages, …) never fall back.
```

Prefer no twin at all: a text button is named by its text, an input by its caption (`aria-labelledby`). Assigning replaces the whole object (it is
frozen); every live component re-renders. `parseNumber(text, { locale })` reads a number the user typed with the
same separators; a group separator counts only in a real group position (`1.234,5` → 1234.5, but `1.5` in `de` is
not a number — never a silent 15). To read numbers your own way, set `parseNumberCallback` (on the element where a
component has one, or page-wide):

```js
window.components.locale = {
  // '1.5' in a German grid → 1.5 instead of "invalid number"; undefined = core's parse
  parseNumberCallback: ({ text, parseDefault }) => parseDefault() ?? (/^\d+\.\d+$/.test(text.trim()) ? Number(text) : undefined),
};
```

## Render callbacks (`renderSlot`)

Every `render*Callback` that returns content is read the same way ([SPEC §12.35](SPEC.md)):

```ts
import { renderSlot } from '@keenmate/web-components-core';

renderSlot(cellEl, () => this.config.renderCellCallback?.(this.withContext({ row, column })), {
  memoKey: `${row.id}@${row.version}@${column.field}`,   // unchanged → the hook isn't even called
  renderDefault: (el) => (el.textContent = format(row[column.field])),
});
// string → HTML · Node → mounted · null / undefined → renderDefault · false → hidden
```

Rows you build as one HTML string use the string form:

```ts
const { html } = renderSlotHtml(() => this.config.renderOptionCallback?.(ctx), () => escapeHtml(option.label));
rowsHtml += `<div class="ms__option" role="option">${html}</div>`;   // false → '' (hidden)
```

## The controller (`createControllerFacade`)

`el.controller` / `detail.controller` is your public API, not your engine ([SPEC §12.34](SPEC.md)):

```ts
import { createControllerFacade } from '@keenmate/web-components-core';

protected override createController(): TreeController {
  return createControllerFacade<TreeController>(() => { this.flush(); return this.#engine; }, {
    methods: ['expandAll', 'collapseAll', 'getNodeByPath'],
    state: { selectedPaths: () => [], focusedNode: null },   // answered before the first build
    writable: ['selectionAnchor'],
    emptyResults: { getNodeByPath: () => null },
  });
}
```

## Icons

Icons on items / options / nodes are data — read them with one rule ([SPEC §12.33](SPEC.md)), first match wins:

1. markup (`'<svg …>'`) → raw;
2. a built-in name (`'close'`, `'chevron'`, `'check'`, … — `BUILT_IN_ICON_NAMES`, the base-css-variables glyphs) →
   masked from `--base-icon-<name>` in `currentColor`; reserved, the page hook never sees it;
3. the element's own `renderIconCallback`, then the page-wide `window.components.renderIconCallback(name, { component,
   element, prefix })` → markup, `null` = not mine (the next one decides);
4. other class names (`'fa-solid fa-folder'`, `'bi-gear'`) → `<i class="<prefix>__icon fa-solid fa-folder" aria-hidden="true">`;
5. anything else (`'🚀'`) → escaped text.

```ts
import { renderIcon, ICON_CSS, adoptStyles } from '@keenmate/web-components-core';

adoptStyles(this.shadowRoot!, ICON_CSS);
cell.innerHTML = renderIcon(item.icon, { prefix: 'grid', host: this });
```

Set it on one element, or once for every component (keen-pure-admin's icon providers):

```js
multiselect.renderIconCallback = (name) => (name === 'moon' ? moonSvg : null); // this element only, asked first
window.components.renderIconCallback = (name) =>
  name.startsWith('lucide-') ? lucideSvg(name.slice(7)) : null; // null → the icon-font / text rules
```

The page hook may be set after the components rendered (load order can't be ensured): components repaint when it
changes. In a component that renders icons, implement the opt-in `iconsChanged()` hook (not called on the first
connect; a change while detached fires on reconnect) — re-render the icons, keep the state:

```ts
protected override iconsChanged(): void { this.#renderIcons(); }   // window.components.renderIconCallback changed
```

Outside a BlissElement: `observeIconHook(listener)` → unsubscribe.

## Clipboard

```ts
import { copyText, readPasteText } from '@keenmate/web-components-core';

const isCopied = await copyText(tsv);             // the Clipboard API, else the execCommand fallback; never throws
cell.addEventListener('paste', (e) => {
  const text = readPasteText(e);                  // text/plain, CRLF → LF
  if (!text) return;
  e.preventDefault();
  this.#pasteBlock(text.split('\n').map((line) => line.split('\t')));
});
```

([SPEC §12.32](SPEC.md))

## Scroll kept across a DOM move

A move (reorder, re-parent) keeps your component's state but the browser resets every scroll position inside it
([SPEC §12.31](SPEC.md)). One line in the constructor:

```ts
import { keepScrollAcrossMove } from '@keenmate/web-components-core';

keepScrollAcrossMove(this, () => [this.#body, this.#sidebar]);   // read on every scroll / reconnect
```

## Typed text (IME-safe)

Listen to what the user typed with `observeTextInput`, not a bare `input` listener — an IME fires `input` for every
half-typed syllable ([SPEC §12.30](SPEC.md)):

```ts
import { observeTextInput, isImeEnter } from '@keenmate/web-components-core';

this.#stopText = observeTextInput(this.#searchInput, (term) => this.#search.run((signal) => this.#load(term, signal), this.#show));
observeTextInput(this.shadowRoot!, (value, e, input) => this.#filter(input.dataset.column!, value), { selector: '.filter-input' });
// ↑ delegated: re-rendered inputs need no re-subscribing
this.#searchInput.addEventListener('keydown', (e) => {
  if (isImeEnter(e)) return;                 // the IME confirming a candidate, not "pick the option"
  if (e.key === 'Enter') this.#pickActive();
});
```

## Layers and drawers

A **layer** is a styled panel outside your component — a drag ghost, drop pads, a "drop files here" cover — that
the component's `overflow` can't clip and its neighbours can't cover ([SPEC §12.29](SPEC.md)):

```ts
import { createLayer } from '@keenmate/web-components-core/positioning';

const layer = createLayer(this, { css: OVERLAY_CSS, className: 'dz-cover', cssVars: ['--dz-overlay-bg'] });
layer.element.innerHTML = this.#labels.html('dropHere');
layer.place(this.getBoundingClientRect());          // viewport coordinates; a transformed container is handled
layer.destroy();
```

The host's theme, font, line height, colour and writing direction come along. Instance tokens set on the host don't inherit into the layer — list the ones its
CSS reads in `cssVars` (their computed values are copied; `syncTheme()` re-reads them). Your `:host` rules beat
core's reset even inside `@layer component`.

A **drawer** is a panel on one edge — the preset classes in `SHEET_CHROME_CSS` plus a modal session (or a panel
session when the page must stay usable, below):

```ts
adoptStyles(this.shadowRoot!, SHEET_CHROME_CSS);
panel.classList.add('km-drawer', 'km-drawer--end');      // --start / --end follow the writing direction; --top / --bottom
const session = startModalSession(panel, { backdrop: true, dismissCallback: () => close() });
const close = () => { session.end(); animateOut([panel], { className: 'km-drawer--closing', doneCallback: () => panel.remove() }); };
```

A **non-modal** drawer (the page stays usable — an upload monitor, an inspector) swaps the session; the rest is
the same:

```ts
import { startPanelSession } from '@keenmate/web-components-core';

const session = startPanelSession(panel, { dismissCallback: () => close(), trigger: button });
// Escape (a dropdown inside closes first), a click outside, Back → dismissCallback; no backdrop / inert / trap
```

## Drag (`createPointerDrag`, `observePageDrag`)

In-page drags that work with a finger, and drop targets that light up while files are dragged over the page
([SPEC §12.28](SPEC.md)):

```ts
import { createPointerDrag, observePageDrag, setDropActiveState } from '@keenmate/web-components-core';

#drag = createPointerDrag(this.#body, {
  getSource: (target) => target.closest('.row'),          // null = not draggable here
  longPressMs: 300,                                       // touch: hold, then drag (moving earlier scrolls)
  beforeStartCallback: ({ source }) => this.#canDrag(source),         // false refuses
  moveCallback: ({ target, x, y }) => this.#showDropIndicator(target, x, y),
  dropCallback: ({ source, target }) => this.#move(source, target),
  cancelCallback: () => this.#hideDropIndicator(),              // Escape
});

// connect() / disconnect()
this.#stopDropActive = observePageDrag({ types: ['Files'], changeCallback: (isDropActive) => setDropActiveState(this, this.internals, isDropActive) });
```

Give your drag image `pointer-events: none` so the hit test sees what's under it.

## Selection (`createSelection`)

One selection model for lists, trees and grids ([SPEC §12.27](SPEC.md)) — the rules users know from a file
manager:

```ts
import { createSelection } from '@keenmate/web-components-core';

#selection = createSelection<string>({
  mode: () => this.config.selectionMode,                    // 'multiple' | 'single'
  getOrderedKeys: () => this.#visibleRows.map((r) => r.id), // display order: a range is what the user sees
  isSelectable: (id) => !this.#rowsById.get(id)!.isDisabled,
  changeCallback: ({ added, removed, values }) => this.emit('selection-change', { added, removed, values }),
});

row.addEventListener('click', (e) => this.#selection.click(id, e));   // click / Ctrl / Shift / Ctrl+Shift
this.#selection.extendTo(nextId);                                      // Shift+Arrow
this.#selection.set(this.config.value, { isSilent: true });            // the value input: no event
```

## Virtual lists (`createVirtualWindow`)

Render only the visible rows of a long list of fixed-height rows ([SPEC §12.26](SPEC.md)):

```ts
import { createVirtualWindow } from '@keenmate/web-components-core';

#virtual = createVirtualWindow(this.#scroller, {          // the overflow: auto element
  getCount: () => this.#rows.length,
  rowHeight: () => this.#rowHeightPx,                     // fixed; a function when density can change
  overscan: 5,
  insetTop: () => this.#stickyHeader.offsetHeight,        // only for a header measured in JS
  render: ({ start, end, window }) => {
    window!.innerHTML = this.#rows.slice(start, end).map((row, i) => this.#rowHtml(row, start + i)).join('');
  },
});

this.#virtual.refresh();                                  // the rows changed
this.#virtual.scrollToIndex(index, { block: 'nearest' }); // keyboard / "go to row"
const index = this.#virtual.indexAt(event.clientY);       // drop target, hover
this.#virtual.destroy();                                  // destroyCallback()
```

Core appends a spacer (the full height) with the row window inside it to the scroller; a `<table>` passes
`hasStructure: false` and sizes its own spacer rows from `offsetTop` / `totalHeight` (`listTop: () =>
thead.offsetHeight` when a header inside the scroller sits above row 0). `getPinned: () =>
[editingIndex]` keeps a row rendered while it's scrolled away (`render` gets `pinned`); `computeVirtualRange()` is
the bare range math.

## Keyboard navigation (`@keenmate/web-components-core/a11y`)

Two patterns for lists, trees, grids and toolbars ([SPEC §12.25](SPEC.md)); the roles, `aria-selected` and the
highlight stay yours:

```ts
import { createActiveDescendant, createRovingFocus } from '@keenmate/web-components-core/a11y';

// A combobox / search field: focus stays in the input, the arrows move a highlighted option.
#nav = createActiveDescendant(this.#input, this.#listbox, {
  getItems: () => [...this.#listbox.querySelectorAll('[role="option"]')],
  activeChangeCallback: (item) => this.#paintHighlight(item),       // your class; aria-activedescendant is core's
  activateCallback: (item) => this.#select(item.dataset.value),     // Enter
});
this.#nav.refresh();                                          // after re-rendering the options

// A toolbar / tree / calendar grid: one tab stop, the arrows move real focus.
#roving = createRovingFocus(this.#grid, {
  getItems: () => [...this.#grid.querySelectorAll('[role="gridcell"]')],
  orientation: 'grid', columns: 7,                            // Left / Right follow the writing direction
  hasTypeahead: false,
  focusItemCallback: (cell) => this.#announceDay(cell),
});
```

Handle your own extra keys (tree expand / collapse, PageUp = previous month) in a keydown listener that runs
first and calls `preventDefault()` — the helpers skip a handled event. `destroy()` in `destroyCallback()`.

## Responsive rules (page / per-tag / instance)

Apps tune what components do per device class / width bucket in one place — no app-side
`observeViewport` + "did it change" bookkeeping. Every `BlissElement` with an input
table takes the same rules ([SPEC §6.7](SPEC.md)):

```js
window.components['web-treeview'].responsive = {
  device:     { mobile: { shouldAlignNodeIcons: false }, tablet: { shouldAlignNodeIcons: true } },
  breakpoint: { mobile: { shouldAlignNodeIcons: false } },
};
// own widths / combinations → callback
window.components['web-treeview'].responsiveCallback = ({ deviceClass, env }) =>
  deviceClass === 'desktop' && env.viewportWidth < 600 ? { shouldAlignNodeIcons: false } : undefined;

window.components.responsive = { device: { mobile: { presentation: 'fullscreen' } } };  // page-wide
el.responsive = { breakpoint: { mobile: { presentation: 'modal' } } };  // instance (also the JSON attribute)
el.responsiveCallback = (ctx) => null;                                   // instance null = ignore the page rules
```

A map has three axes: `device` (keyed by `classifyDevice` — capability first, then the short side; a
mouse device is `desktop` at any width), `breakpoint` (keyed by the window-width bucket, the
768 / 1024 lines) and `container` (keyed by the component's OWN width, below). Within one map the
breakpoint entry applies first, then container, then device — **a later axis wins** on the same key:

| Situation | deviceClass | breakpoint | `shouldAlignNodeIcons` |
|---|---|---|---|
| Phone | `mobile` | `mobile` | `false` — from `device.mobile` |
| Desktop window narrowed below 768 px | `desktop` | `mobile` | `false` — from `breakpoint.mobile` |
| iPad portrait (768 wide) | `tablet` | `mobile` | `true` — `device.tablet` beats `breakpoint.mobile` |

Any other top-level map key (the old `{ mobile: … }` shape) warns once and is ignored.

**`container` — the component's own width.** The same component can be wide in the main content and
narrow in a sidebar on one monitor; `container` is keyed by its own box: `narrow` (< 480px) · `medium`
(< 768px) · `wide`.

```js
window.components['web-daterangepicker'].responsive = {
  container: { narrow: { months: 1, isTodayButtonVisible: false } },   // the picker is < 480px
};
```

```css
/* the lines are CSS variables read at the component, so they inherit */
:root          { --base-container-narrow: 400px; }   /* the whole page */
aside.filters  { --base-container-narrow: 360px; }   /* components in this sidebar */
#trip          { --base-container-narrow: 600px; }   /* one component */
```

It switches live when the box crosses a line (the window doesn't have to change). A callback gets
`ctx.container` and `ctx.width`. Use it for structural changes (the month count, a panel shown or not);
restyling stays in CSS `@container`. No component has its own width-threshold input.

Precedence, key by key: global map → global callback → per-tag map → per-tag callback →
**attributes / properties set on the element** → instance map → instance callback. An attribute on
one element is never overridden by a page rule. `config` / the getters report the effective value;
overrides never reflect to attributes, and a key a rule stops returning goes back to its base
value. Own widths or combinations go in a callback (`ctx.deviceClass`, `ctx.breakpoint`,
`ctx.env.viewportWidth`, …).
Rules re-run on device / breakpoint / orientation flips and rule changes — callbacks also on every
(throttled) viewport-size change — diffed, as one `update()`/`reinit()` batch; the first build already gets them. Set the page rules before the
component scripts load if you like — `registerComponent()` adopts them. Types: `ResponsiveMap<C>`,
`ResponsiveMapAxis`, `ResponsiveCallback<C>`, `ResponsiveContext<C>`, `ContainerSize`.

## Motion level (none / snappy / smooth)

Every component takes `motion="auto | none | snappy | smooth"`; `window.components.motion` sets
the level page-wide and `data-motion` does it for any element and everything inside (a section, the
whole page) — no base-css-variables needed. Components follow through the shared
`--base-duration-*` / `--base-scroll-behavior` tokens; **the OS reduced-motion setting always wins**.
**The closest level wins**: the component's own `motion` → the nearest `data-motion` around it → the
page (core writes `window.components.motion` on `<html data-motion>`) → the component's own speed.
`auto` sets nothing, so the next layer out decides.

```html
<section data-motion="snappy">
  <web-multiselect></web-multiselect>             <!-- snappy -->
  <web-daterangepicker motion="none"></web-daterangepicker>  <!-- its own level wins -->
</section>
<script>window.components.motion = 'none';</script>  <!-- <html data-motion="none">: every component
                                                         left on auto outside the section -->
```

### What `motion` switches off, and switching off one animation

`motion` is the ONE "animate or not" setting — components have no `is…AnimationEnabled` properties.

- **Animates by default; `motion="none"` / OS reduced motion makes it instant:** appear / disappear,
  **expand / collapse** (tree rows, accordions), size changes, highlight fades, smooth scrolling, a
  countdown bar (hidden).
- **`motion` never changes it:** timers (feedback time, debounce, tooltip delay, auto-close keep their
  time) and loaders (keep moving — the only sign something runs).

To switch off just ONE animation, set its duration token to `0s`, anywhere the cascade reaches:

```css
:root            { --wtv-row-animation-duration: 0s; }   /* every tree on the page: rows don't animate */
#files-menu-host { --km-menu-sheet-duration: 0s; }       /* one component's menu sheet */
```

A component's per-animation token defaults to a speed token (`var(--xx-transition-normal)`), so
`motion="none"` and reduced motion still switch it off; a literal time (`0.3s`) would opt it out.

### Reading motion in JS

CSS decides; when JS has to follow, read the resolved value at the element (it depends on where the
element sits — its own `motion`, a section, the page, the OS):

| Helper | Answers |
|---|---|
| `isMotionOff(el)` | decorative motion is off here (`--base-duration-normal` is `0s`) — e.g. don't draw a countdown bar |
| `readScrollBehavior(el, '--xx-scroll-behavior')` | `'smooth'` / `'auto'` for `scrollTo({ behavior })` |
| `readCssDurationMs(el, '--xx-transition-normal', fallback)` | a speed token in ms, for a WAAPI animation |
| `readCssLengthPx(el, '--xx-badge-height', fallback)` | a length variable (`rem`, `calc()`, `var()`) in px |

No component probes `getComputedStyle` for these itself.

### Animating something out (`animateOut`)

Appearing needs no JavaScript: a CSS `@keyframes` on the new element plays when it is inserted.
Disappearing does — the element must stay until its closing animation ends. `animateOut()` adds
the closing class (+ `inert`), waits, then calls you; at a `0s` duration (motion `none`, OS reduced
motion) it calls you at once. Time the keyframes ONLY with the motion tokens:

```css
.xx__row { animation: xx-row-in var(--xx-row-animation-duration, var(--xx-transition-normal)) var(--base-ease-out); }
.xx__row--closing { animation: xx-row-out var(--xx-row-animation-duration, var(--xx-transition-normal)) var(--base-ease-in) forwards; }
@keyframes xx-row-out { from { height: var(--km-exit-height); } to { height: 0; opacity: 0; } }
```

```ts
import { animateOut } from '@keenmate/web-components-core';

const out = animateOut(rows, {
  className: 'xx__row--closing',
  shouldSetHeightVar: true,          // --km-exit-height = each row's height: shrink in the flow
  doneCallback: () => this.#collapse(node), // remove / collapse — never runs after cancel()
});
out.cancel();          // re-expanded mid-close: class + inert come off
await out.finished;    // true after doneCallback, false when cancelled

// Two elements, each its own BEM modifier: doneCallback waits for the longer animation.
animateOut([panel, backdrop], {
  className: (el) => (el === backdrop ? 'xx__backdrop--closing' : 'xx__panel--closing'),
  doneCallback: () => { panel.remove(); backdrop.remove(); },
});
```

`readAnimationMs(el)` is the read underneath: the longest `delay + duration` of the element's
current animations, `0` for none. Never your own `animationend` / `transitionend` wait (rulebook
C-CA-18) — `animateOut` also covers a tab that never fires `animationend` (gives up after the
duration + 50ms).

## Global registration (`window.components`)

`registerComponent` replaces the block every component used to copy-paste (and
drift). It defines the element, publishes build metadata + logging controls to
`window.components[tag]`, and wires `getInstances()` to the live-instance
registry `BlissElement` maintains automatically (added on connect, removed on
disconnect — a DOM move re-tracks without duplicating).

```ts
import { registerComponent, createLoggers } from '@keenmate/web-components-core';

const logging = createLoggers('MULTISELECT'); // categories: INIT / DATA / UI

registerComponent('web-multiselect', WebMultiSelect, {
  config: { name: '@keenmate/web-multiselect', version: '1.0.0', author: 'Keenmate' },
  logging,                 // optional — flattened onto the global entry
  // shouldAutoDefine: true (default) — also exposes an idempotent register()
});
```

From anywhere (console, a devtools overlay, server-rendered code):

```js
window.components['web-multiselect'].getInstances()        // live elements on the page
window.components['web-multiselect'].version()             // build version
window.components['web-multiselect'].logging.enableLogging()
```

The returned elements **are** the per-instance handles — enumerate tags with
`getConnectedTags()`, each tag's instances with `getInstances(tag)`.

## Logging

`createLoggers(namespace, categories?)` returns categorized
`NAMESPACE:CATEGORY` loggers (a vendored `loglevel` port), each with a color-coded prefix.
Categories default to `INIT / DATA / UI` (redefinable / extendable).
`enableLogging()` / `disableLogging()` / `setLogLevel()` / `setCategoryLevel()` / `resetLogging()`
set the level of the whole bundle (i.e. all instances of that component type).

**The closest level wins** — like CSS, and nothing is set by default:

```
element (el.enableLogging) → component type (window.components[tag].logging) → page (window.components.logging) → warn
```

A level means "this level and above": `'warn'` prints warnings and errors. Out of the box only
warnings and errors print; `enableLogging()` (default `debug`) adds info/debug at that layer,
`disableLogging()` sets that layer to `silent`, and `resetLogging()` clears it, so the next layer
out applies again. Because each layer is separate, the order of calls doesn't matter. A level
persisted in `localStorage` (`km-log:NS:CAT`) counts as that category's own level.

### Page-wide switch — `window.components.logging`

The page level, for **every** bundle on the page — each component's plus core's own `CORE`
bundle, including components registered later — wherever a component type has no level of
its own. It is a non-enumerable key, so enumerating `window.components` still yields
component tags only.

```js
window.components.logging.disableLogging();        // page level = silent
window.components.logging.enableLogging('debug');
window.components.logging.setLogLevel('warn');
window.components.logging.resetLogging();          // no page level → the built-in warn
window.components.logging.getCategories();         // ['CORE:ELEMENT', 'MULTISELECT:INIT', …]

// A component type's own level wins over the page level, set before or after it:
window.components['web-multiselect'].logging.setLogLevel('debug');
window.components['web-multiselect'].logging.resetLogging();   // follow the page again
```

Also available in code as `getPageLogging()`.

### Core's own messages

Core never writes to `console` directly. A message with a component behind it
(a rejected input value, a throwing `on<Name>` twin, an action / menu callback
that threw, a bad `theme-source`) goes through **that element's** instance
logger; one without an element uses the `CORE` bundle
(`CORE:ELEMENT` / `CORE:ACTIONS` / `CORE:MENU` / `CORE:THEME`):

```
[MULTISELECT:INIT] #country  rejected invalid value for attribute max-height="abc" (not a number); keeping previous value  300
[CORE:ELEMENT] web-grid#main  rejected invalid value for property "pageSize"; keeping previous value  -5   ← tag has no logging bundle
[CORE:THEME]  setThemeMode: unknown mode "sepia"; expected 'dark', 'light' or 'auto'
```

Input validation logs under `INIT`, actions / menus / event twins under `UI`
(falling back to the bundle's first category when the component redefined its
categories without that name).

### Per-instance logging

`BlissElement` also exposes **`this.log`** — an instance logger per category, gated by the
element's own level when it has one, else its type's / the page's, and emitted via `console`
directly. This lets a devtools overlay make **one element louder — or quieter — than its type**:

```ts
protected override update(partial: Record<string, unknown>) {
  this.log.DATA?.debug('update', Object.keys(partial));
}
```

```js
el.enableLogging();        // this element logs debug and above, whatever its type / the page says
el.enableLogging('error'); // this element: errors only
el.disableLogging();       // this element: nothing
el.resetLogging();         // follow the type / page again
el.isLoggingEnabled;       // has its own level that prints something
```

Each line reads `[NAMESPACE:CATEGORY] #id` — the element's own `id` when set
(read per line, so an `id` assigned later shows up), else a running number. When
the tag has no logging bundle, `this.log` falls back to `CORE:ELEMENT` with the
tag kept in the label (`web-grid#main`):

```
[MULTISELECT:DATA] #country-picker  update  ['maxHeight']
[MULTISELECT:DATA] #1               update  ['searchPlaceholder']
```

**An engine class logs through the element's loggers.** A component's plain-class engine (the date
picker, the tree engine, the upload engine) can't reach `this.log`, so the element hands it over; the
engine falls back to the type loggers only when it runs on its own:

```ts
// engine
type Log = Record<'INIT' | 'DATA' | 'UI', InstanceLogger>;
constructor(opts: EngineOptions & { log?: Log }) {
  this.#log = opts.log ?? loggers;           // the bundle's type loggers (standalone use)
}
// element
this.#engine = new Engine({ ...options, log: this.log as Log });
```

Never import the module-level loggers inside an engine that an element owns: those lines carry no
instance label and ignore `el.enableLogging()`.

## Style injection

Two zero-dep helpers (main index) for the shadow-root CSS plumbing components
re-roll. Core owns the *injection*, not the authoring rules (`@layer` order,
Vite `?inline`) — and stays render-agnostic, so these are free functions, not
base-class methods.

```ts
import { adoptStyles, createStyleElement } from '@keenmate/web-components-core';
import styles from './main.css?inline';

// static, shared across all instances (one cached CSSStyleSheet; <style> fallback)
adoptStyles(this.shadowRoot, styles);

// per-instance user CSS (the getCustomStylesCallback pattern) — one replaceable <style> element
const style = createStyleElement(this.shadowRoot, { cssClass: 'custom-styles' });
style.set(this.config.getCustomStylesCallback?.());  // re-set replaces; falsy clears
```

Every component takes custom CSS from `createCustomStyles()`, **always the same way** (rulebook
C-CA-15 checks it). There is a **page layer** per tag (`window.components['web-treeview'].customStyles`
/ `.getCustomStylesCallback(ctx)`), and the instance's own layer comes after it, so an instance
overrides the shared rules. The canonical adoption:

```ts
// 1. two input rows (both on: 'update'); the callback wins when both are set
{ configKey: 'customStyles', attribute: 'custom-styles', converter: toText({ isNullable: true }), on: 'update' },
{ configKey: 'getCustomStylesCallback', converter: toFunction(), on: 'update' },

// 2. one handle, created on the first build (after the shadow content exists), refreshed per build
#customStyles: CustomStylesHandle | null = null;
#applyCustomStyles(): void {
  if (this.#customStyles) return this.#customStyles.refresh();
  this.#customStyles = createCustomStyles(this, this.shadowRoot!, {   // writes both layers now
    cssClass: 'wtv-custom-styles',              // <prefix>-custom-styles; no `position` (core's default)
    getContext: () => this.withContext({}),
    getInstanceStyles: () => ({ css: this.config.customStyles, callback: this.config.getCustomStylesCallback }),
  });
}
protected override reinit() { /* … build … */ this.#applyCustomStyles(); }
protected override update(partial) {
  if ('customStyles' in partial || 'getCustomStylesCallback' in partial) this.#customStyles?.refresh();
}
protected override destroyCallback() { this.#customStyles?.destroy(); this.#customStyles = null; }
```

No other custom-CSS code in the component: no `createStyleElement`, no own `<style>` / `<link>`
handling. A component that doesn't apply the page layer gets a core warning when a page sets it.

An `@import` in either layer is also linked once in the document `<head>`, because Chromium ignores
`@font-face` inside a shadow root (an icon font would draw boxes). The link is shared by every
instance, removed when the last one stops importing it, and a stylesheet the page already links is
reused, and an element removed from the page (not just moved) gives its links back. The imported
rules then also reach the page. A page that loads those fonts itself turns it off:

```js
window.components.shouldHoistImports = false;                  // every component on the page
window.components['web-treeview'].shouldHoistImports = true;    // one component type (wins)
```

A **managed child** — an element a component mounts and owns (web-dropzone's satellites bound to
one store) — also takes its owner's custom CSS. Its handle names the owner; the owner's layers land
between the child's own (child page → owner page → owner instance → child instance) and follow the
owner's `refresh()` and page writes for either tag:

```ts
this.#customStyles = createCustomStyles(this, this.shadowRoot!, {
  cssClass: 'dz-custom-styles',
  getContext: () => this.withContext({}),
  getInstanceStyles: () => ({ css: this.config.customStyles, callback: this.config.getCustomStylesCallback }),
  getOwner: () => this.#store?.host ?? null,   // read per refresh; null = no owner layers
});
// re-bound to another store → this.#customStyles.refresh()
```

A second root of your own (a `createLayer` overlay) gets the same custom CSS from a second handle that stays out of
the host's shared entry:

```ts
const overlayStyles = createCustomStyles(this, layer.layer.shadowRoot!, { ...sameOptions, shouldShareLayers: false });
// layer closes → overlayStyles.destroy()  (the main handle and the satellites are untouched)
```

## Persisted UI state

What the user arranged — a popover's size, column widths / order — survives a reload the same way in
every component (SPEC §12.17, rulebook C-CA-17). Three input rows and one handle:

```ts
import { createStateStore, toFunction, toText, type LoadStateCallback, type SaveStateCallback } from '@keenmate/web-components-core';

static inputs = [
  // …
  { configKey: 'storageKey', attribute: 'storage-key', converter: toText({ isNullable: true }), on: 'update' },
  { configKey: 'loadStateCallback', converter: toFunction(), on: 'update' },
  { configKey: 'saveStateCallback', converter: toFunction(), on: 'none' },
];

#state = createStateStore<MyState>(this, {
  getKey: () => this.config.storageKey as string | null,
  getLoadCallback: () => this.config.loadStateCallback as LoadStateCallback<MyState> | null,
  getSaveCallback: () => this.config.saveStateCallback as SaveStateCallback<MyState> | null,
  toContext: (data) => this.withContext(data),   // BlissElement: controller + element + extras
});

// when the user finishes arranging:  void this.#state.save({ popoverWidth, popoverHeight });
// when the UI is built:             const saved = await this.#state.load();
```

The page decides where it lives: unset `storage-key` = off; set = `localStorage['km-state:<tag>:<key>']`;
with `loadStateCallback` / `saveStateCallback` the host keeps it (per user, in a database) and gets the
whole state on every save — set both; either one alone already switches localStorage off (core warns). No own `localStorage` code in a component.

## Container scroll

`scrollIntoContainer()` brings an inner element (a row, an option, a day) into view by scrolling
the one container around it — never the page, unlike `scrollIntoView()`. The search walks out of
shadow roots and slots; `<html>` / `<body>` never count. It honours the container's
`scroll-padding` (sticky headers) and the element's `scroll-margin`, and `inline` is RTL-aware.

```ts
import { scrollIntoContainer, findScrollContainer } from '@keenmate/web-components-core';

scrollIntoContainer(row);                                   // nearest, instant
scrollIntoContainer(row, { block: 'center', behavior: 'smooth', shouldRevealContainer: true });
scrollIntoContainer(option, { container: this.listEl });   // known scroller, no search
findScrollContainer(row);                                   // the scroller, or null (page only)
```

No container found → the page is the only scroller and gets the same request
(`el.scrollIntoView({ block, inline, behavior })`), returning `null`. Nothing to move → no
`scrollTo()` call. Virtual lists scroll by index themselves.

## Positioning (`@keenmate/web-components-core/positioning`)

Floating-element positioning over a single pinned `@floating-ui/dom` — one
low-level `anchor()` primitive plus `createTooltip()` and `createPopover()`
presets, replacing the ~15 hand-rolled call sites across the components. A
separate subpath, so `@floating-ui/dom` is only pulled in when you position.

```ts
import { createPopover, createTooltip } from '@keenmate/web-components-core/positioning';

// dropdown/panel — portaled to <body>, width-matched, keeps the theme
const dropdown = createPopover({ reference: input, panel, matchWidth: 'min' });
dropdown.open();   // mount + position + autoUpdate
dropdown.close();  // unmount + stop

// tooltip — hover/focus with a delay; shouldFollowCursor: true to track the pointer
const tip = createTooltip({ trigger, content: 'Help text', delay: { show: 200 } });

// ONE tooltip for many targets (calendar days, grid cells, tree nodes) — delegated over a root
const cellTip = createTooltip({
  trigger: this.shadowRoot,                 // the root the targets live in
  selector: '.xx__cell',
  content: (cell) => cell.dataset.tooltip,  // resolved at every show; null / '' = no tooltip
  container: this.shadowRoot,
  delay: { show: 400 },                     // once; moving to the next cell switches at once
  shouldToggleOnTap: true,                  // touch: a tap toggles (for targets a tap does nothing else on)
});
```

`content` may be a function in both modes; `beforeShowCallback(target)` returning `false` cancels a show;
`arrow` takes an arrow element; `handle.refresh()` re-reads the content of the shown target. Keyboard focus
on a target shows its tooltip, Escape hides it. No component builds its own tooltip layer over `anchor()`.

Motion: hiding **fades out** — the element stays mounted (`pointer-events: none`, class `km-tooltip--hiding`)
until its `opacity` transition ends (timeout fallback = its computed duration), then it is removed; showing again
mid-fade picks up from there. Core adopts `TOOLTIP_CSS` (fade + a 4px slide toward the anchor, entry via
`@starting-style`, `--base-duration-fast`) in `@layer component` with `:where()` selectors, so a component needs
**no** opacity / transition / `@starting-style` rules of its own — and any it keeps win. `data-motion="none"` /
OS reduced motion → instant. `data-placement` on the tooltip is the resolved placement (after flip / shift):

```css
.xx__tooltip[data-placement^="bottom"] { /* drawn below the target: e.g. a direction-aware shadow */ }
```

`anchor(floating, reference, opts)` returns `{ update, destroy }`; options:
`placement` (default `'bottom-start'`), `strategy` (default `'fixed'`), `offset`,
`shouldFlip`, `shift`, `matchWidth: 'min' | 'exact' | 'max'`, `lockPlacement: 'initial' | 'freeze' | false`, `shouldAutoUpdate`,
`inheritThemeFrom` (copies `data-theme` onto portaled layers — C-CS-10), `maxHeight` / `maxWidth`
(cap to the available space; `{ padding, cap: '40rem' }` keeps your own limit as `min(cap, available)`),
`referenceWidthVar` (publish the field width as a CSS variable before each computation: `'--xx-field-width'`
on the panel, or `{ name, element: host }`), `shouldRestorePlacement` (`destroy()` also puts back
`position` / `left` / `top` — for a persistent element you floated for a while), and a `platform`
escape hatch.

## Keyboard shortcuts (`@keenmate/web-components-core/actions`)

An action item's `shortcut` uses ONE syntax: chords joined by `+` (`'Ctrl+D'`, `'Shift+F3'`), `Mod` = ⌘ on
Apple / Ctrl elsewhere (`'Mod+S'`), a sequence separated by a space (`'g f'`); key names are
`KeyboardEvent.key` names (`'Delete'`, `'F2'`, `'ArrowUp'`, `'Plus'`, `'Space'`). Menus show it formatted
and run the item on it while open.

```ts
import { bindShortcuts, formatShortcut, getShortcutKeycaps } from '@keenmate/web-components-core/actions';

// bind: one keydown listener, sequences, skips plain keys while typing, ignores IME composition
const unbind = bindShortcuts(this.shadowRoot!, () =>
  this.toolbarItems.map((item) => ({ shortcut: item.shortcut, run: () => this.runItem(item), isEnabled: () => !item.isDisabled })),
);

formatShortcut('Mod+Shift+Z');   // 'Ctrl+Shift+Z' — Apple '⇧⌘Z'
getShortcutKeycaps('Ctrl+K');       // [['Ctrl', 'K']] — one <kbd> per cap
```

`matchesShortcut(event, 'Ctrl+D')` / `parseShortcut(text)` / `isTypingTarget(event)` are there for a
component's own keydown handler. Modifiers match exactly; a bare single character ignores Shift (`'?'`).
No component parses key combos itself.

## Menu (`@keenmate/web-components-core/menu`)

The shared context / dropdown menu over `/actions` entries: rendering, (lazy)
submenus, positioning, outside-interaction dismiss and the WAI-ARIA menu keyboard.

```ts
import { openMenu } from '@keenmate/web-components-core/menu';

const menu = openMenu(entries, ctx, {
  at: { x: e.clientX, y: e.clientY },  // or an element
  host: this.shadowRoot,                // where it renders (styles adopted there)
  runAction: (item, { triggerElement, sourceEvent }) => this.activate(item, triggerElement, sourceEvent),
  closeCallback: (reason) => { /* sync your state */ },
  returnFocusTo: this.bodyEl,
  shouldFocusFirst: isOpenedFromKeyboard,
  title: row.name,                      // the phone sheet's header + the menu's aria-label
});
menu.close();
```

**Phone: a bottom sheet, for free.** `presentation: 'auto'` (the default) classifies the device
(`classifyDevice()` — the same device class web-multiselect and web-grid use) and looks it up in
`presentationMap` (default `{ mobile: 'sheet', tablet: 'floating', desktop: 'floating' }`), so on
a phone the menu opens as a bottom sheet; on a tablet / desktop nothing changes. The sheet is full width
at the bottom over a backdrop (`env(safe-area-inset-*)`, `dvh`), with a header (`title` + a close
button), rows at least `--base-touch-target-min` (44px) tall; a submenu drills in (it replaces
the list, a Back row on top goes up); page scroll is locked (`lockBodyScroll`). It closes the
same ways as the floating menu plus three:

| Close | `closeCallback` reason | Focus |
|---|---|---|
| a tap on the backdrop (closes on `click`, no click-through) | `'outside-click'` | back to `returnFocusTo` |
| the header's close button | `'close-button'` | back to `returnFocusTo` |
| the phone Back button / gesture (one history entry while open; in a submenu it goes up one level instead) | `'back'` | back to `returnFocusTo` |

Escape goes up one level / closes (`'escape'`), an item runs and closes (`'action'`). No scroll
close (the page is locked). A component needs no code for it; pass `presentation: 'floating'`
to keep the floating menu everywhere (or `'sheet'` to force the sheet, e.g. for a preview).

**Drawer.** `presentation: 'drawer'` is the same sheet as a full-height side panel on `side`
(`'start'` — left in LTR, right in RTL — or `'end'`), `--km-menu-drawer-width` wide
(`min(320px, 85vw)`). Mix them per device class:

```ts
openMenu(entries, ctx, { at: button, presentationMap: { mobile: 'drawer', tablet: 'drawer' }, side: 'end' });
```

While an `'auto'` menu is open a device-class change re-resolves it (sheet ⇄ drawer in place; to /
from floating it closes with `'presentation'`). The sheet and drawer slide in / out on
`--base-duration-medium`, so `motion="none"`, `data-motion` and OS reduced motion turn that off
with no code; keyboard-shortcut hints are hidden on both (the keys still work).

**A component that opens menus** (treeview, grid, editor …) takes the two standard inputs — never
its own presentation attribute — and passes its own strings:

```ts
import { createMenuPresentationInputs, getMenuPresentationOptions, openMenu } from '@keenmate/web-components-core/menu';

static inputs = [...OWN_INPUTS, ...createMenuPresentationInputs()];   // menu-presentation, menu-side
// at open
openMenu(entries, ctx, {
  ...getMenuPresentationOptions(this.config),                       // { presentation, side } (effective config)
  labels: { back: this.labels.back, close: this.labels.close },  // never hard-coded English
});
```

So `<web-tree-view menu-presentation="drawer" menu-side="end">`, the per-tag settings and the
responsive rules (`responsive = { device: { tablet: { menuPresentation: 'drawer' } } }`) work for
every menu host alike. The
strings are `labels.back` (`'Back'`) and `labels.close` (`'Close'`); the look is the
`--km-menu-*` chain (`--km-menu-sheet-*`, `--km-menu-backdrop`, `--km-menu-back-arrow`, see
`component-variables.manifest.json`). A component that styles its menu through `cssClass`: that
class is on every menu level, not on the sheet wrapper (`.km-menu-sheet`).

## Search (`@keenmate/web-components-core/search`)

Built-in search rules shared by every component with a search box: normalization
(`search-behavior`), where the term matches (`search-match`), term preparation, and highlight
mapping. Pure functions, no dependencies; the component keeps its per-item cache.

```ts
import {
  createRegexCompiler, findHighlightRanges, matchesSearchTerm, normalizeSearchText,
  prepareSearchTerm, wrapRanges,
} from '@keenmate/web-components-core/search';

const behavior = 'normalized', match = 'word-starts-with';
const prepared = items.map((i) => normalizeSearchText(i.label, behavior)); // once, not per keystroke
const regex = createRegexCompiler();                                        // one per instance

const term = prepareSearchTerm(typed, { behavior, match, regex });          // 'kru' → { kind: 'text', text: 'kru' }
const hits = items.filter((i, n) => matchesSearchTerm(term, match, prepared[n], i.label));

const { text, ranges } = findHighlightRanges('Český Krumlov', term, { behavior, match });
wrapRanges(text, ranges, { escape });                                       // 'Český <mark>Kru</mark>mlov'
```

`normalized` (default) ignores case and diacritics (`ces` → `Český`, `strasse` → `Straße`),
`case-insensitive` ignores case only, `exact` nothing. Match modes: `contains`, `equals`,
`starts-with`, `ends-with`, `word-starts-with`, `word-ends-with`, `regex` (raw value, no
normalization). Always render the `text` `findHighlightRanges` returns — it is the NFC form the
ranges index into. Also exports the `searchCallback` context convention types
(`SearchCallbackContext`, `SearchEntry`). See SPEC §12.11.

## Testing (`@keenmate/web-components-core/testing`)

Runner-agnostic DOM fixtures (pure DOM, zero deps — vitest+jsdom or a real
browser). Pair them with `await el.whenSettled()` to await the reactive pipeline.

```ts
import { mount, cleanup, listen, uniqueTag, defineOnce } from '@keenmate/web-components-core/testing';

afterEach(cleanup);

it('emits select when picked', async () => {
  const tag = defineOnce(uniqueTag(), MyElement);
  const el = mount<MyElement>(`<${tag} selection-mode="multiple"></${tag}>`);
  const spy = listen(el, 'select');
  el.pick('a');
  await el.whenSettled();
  expect(spy.lastDetail).toEqual({ option: 'a' });
});
```

`mount` / `cleanup`, `mountBeforeUpgrade` (pre-upgrade property capture),
`uniqueTag` / `defineOnce`, `nextTick` / `nextFrame`, and `listen` → an
`EventSpy` (`count` / `events` / `last` / `lastDetail` / `stop()`).

## Editor metadata (`@keenmate/web-components-core/cem`)

A [Custom Elements Manifest](https://github.com/webcomponents/custom-elements-manifest)
analyzer plugin that reads the `static inputs` / `static events` tables, so the
manifest — and the HTML autocomplete/hover editors build from it — is generated
from the single source of truth: **structure** from each row + its converter
(attribute↔property, type, default, `shouldReflect`, enum members), **prose** from
optional `description` / `deprecated` fields on the row. Build-time only.

```js
// custom-elements-manifest.config.js
import { blissAnalyzerConfig } from '@keenmate/web-components-core/cem';
export default blissAnalyzerConfig();
```

The manifest holds the package's public API only: private / protected / `#…` / `_…` members and the modules,
declarations and exports `src/index.ts` doesn't re-export are dropped (`publicApiEntries: [...]` for other entries,
`isPublicApiOnly: false` for the analyzer's full output).

```ts
// a row carries its own help text — no @attr re-declaration to drift
{ configKey: 'selectionMode', attribute: 'selection-mode',
  converter: toEnum(['single', 'multiple'], { default: 'single' }),
  description: 'Whether the user can pick one option or several.' }
```

## API index

Every runtime export by entry point; types ship in the `.d.ts` files. The sections above
explain the main ones; [SPEC](SPEC.md) has the design notes.

### `@keenmate/web-components-core`

The main index is in 13 sections (the comments in `src/index.ts`), one row each:

| # Section | Exports |
|---|---|
| 1 Inputs & converters | `toBool`, `toBytes`, `toCssLength`, `toCustom`, `toEnum`, `toFloat`, `toFunction`, `toInt`, `toList`, `toObject`, `toObjectArray`, `toText`, `toValue`; engine / test code: `resolveFromAttribute` / `resolveFromProperty` (run one value through a row's converter), `collectEngineConfig` (config for an engine, keeping meaningful `null`s), `deriveClearableKeys` / `isClearableInput` / `isClearableConverter` (which inputs a `null` clears) |
| 2 Element, events, registration | `BlissElement`, `INPUT_REJECTED_EVENT` (`'input-rejected'`, a refused write), `define(tag, Class)` (define once), `dispatch(target, name, detail)` (the free event helper under `emit()`), `withComponentContext(detail, controller, element, extras?)` / `COMPONENT_CONTEXT_KEYS` (the non-enumerable `controller` / `element`), `runBeforeCallback` (async; `false` cancels, a value replaces), `runBeforeCallbackSync`, `runBeforeCallbackEager` (stays synchronous for a sync hook), `createControllerFacade(target, spec)` (the frozen public controller over a lazy engine), `runSafely(fn, log)` / `notifyListeners(listeners, value, log)` (call code core doesn't own: a throw is logged, not propagated), `registerComponent(tag, Class, opts)` (`window.components[tag]`), `getInstances(tag)`, `getConnectedTags()` — page-wide, across copies of core |
| 3 Logging | `createLoggers(namespace, categories?)`, `getPageLogging()` (= `window.components.logging`), `getCoreLogging()` / `CORE_LOG_CATEGORIES` (core's own messages), `setLogPersistKeyPrefix` / `getLogPersistKeyPrefix`, `isLogLevel`, `LOG_LEVELS`, `DEFAULT_LOG_CATEGORIES`, `DEFAULT_LOG_LEVEL`, `DEFAULT_ENABLED_LOG_LEVEL`, `createPerfLogger(namespace, { thresholdMs, maxSpans })` (spans + item counts + metadata, `measureAsync`, `count`, `summarize`) |
| 4 Environment | `getEnvironment`, `observeEnvironment`, `observeViewport`, `configureBreakpoints` / `BREAKPOINTS_CHANGE_EVENT`, `classifyDevice` / `TABLET_MIN_SHORT_SIDE`, `observeElementSize`, `createElementSizeObserver(listener)` (`observe` / `unobserve` / `disconnect` — one listener for a changing set of elements, shared observer), `CONTAINER_SIZES` / `CONTAINER_SIZE_TOKENS` / `DEFAULT_CONTAINER_LINES` / `readContainerLines` / `resolveContainerSize` (narrow / medium / wide), `isRtl(el)` (effective writing direction, across shadow roots) |
| 5 Theme, motion, CSS timing | `getThemeContext`, `observeThemeContext`, `setThemeMode` / `getThemeMode` (force dark / light page-wide), `readThemeSignal(el)`, `resolveThemeSource(host, source)`, `THEME_CONTEXT_ATTRIBUTE`, `THEME_SOURCE_ATTRIBUTE`; `getPageMotion`, `observePageMotion`, `adoptMotionStyles(node)`, `MOTION_CSS`, `MOTION_PRESETS`, `MOTION_VALUES`, `MOTION_ATTRIBUTE`, `MOTION_DATA_ATTRIBUTE`; `isMotionOff` / `readScrollBehavior` / `readCssDurationMs` / `readCssLengthPx` / `parseCssTimeMs` (resolved CSS in JS), `animateOut` / `readAnimationMs` / `EXIT_HEIGHT_VAR` (exit animations) |
| 6 Styles & rendering | `adoptStyles(root, ...css)` / `createStyleElement(root)` (style injection), `createCustomStyles` (the `customStyles` input), `extractConsumedCssVars`, `extractDeclaredCssVars`, `lintCssVars` (read vs declared `--prefix-*` names), `suggestCssVars` (likely target of a typo), `renderSlot` / `renderSlotHtml` (a render callback's result: HTML / node / default / hidden, memoized; the string form for string-built rows), `renderIcon` / `ICON_CSS` / `BUILT_IN_ICON_NAMES` / `observeIconHook(listener)` (icon strings: markup / built-in name / page `renderIconCallback` / icon-font classes / text; the page hook's changes — a BlissElement gets them through `iconsChanged()`), `renderLoader(host, container, context, opts)` (loading states), `escapeHtml(text)` |
| 7 Overlays (non-floating; floating panels → `/positioning`) | `Z_INDEX` (stacking tiers), `resolvePresentation` / `DEFAULT_PRESENTATION_MAP` / `createPresentationContext` (floating panel vs fullscreen sheet), `lockBodyScroll()` (shared ref-counted lock), `fitToVisibleViewport(panel)`, `claimBackEntry(onBack)` (phone Back closes the sheet), `startSheetSession(panel, { backCallback })` (scroll lock + keyboard inset + Back + containing-block check, one `end()`), `startModalSession` / `startPanelSession` (modal / non-modal panel; the trap alone is `/a11y` `createFocusTrap`), `guardGhostClick` (a tap's trailing click), `SHEET_CHROME_CSS` / `createSheetHeader()` (the sheet header + close button; `.km-sheet` full-screen frame, `.km-drawer` presets), `registerOverlay` / `notifyOverlayActivated` / `observeOverlayActivation` / `dismissAllOverlays` / `OVERLAY_ACTIVATE_EVENT` / `ALL_OVERLAY_GROUPS` (one overlay open at a time, nesting, Escape routing) |
| 8 Shadow-DOM tree & screen reader | `deepActiveElement()` (the focused element inside shadow roots), `deepElementFromPoint`, `deepClosest(el, selector)` / `isDeepInside(el, container)` (`closest` / containment across shadow roots), `announce(text)` (screen-reader live region) |
| 9 Keyboard & text, clipboard | `observeTextInput` / `isImeEnter` (IME-safe typed text; the shortcut guard `isTypingTarget` is in `/actions`), `copyText` / `readPasteText` (clipboard) |
| 10 Forms, async, persistence | `createFormInputs` / `formatFormValue` (form submission), `createAsyncRunner` (latest-request-wins loading), `createStateStore` / `getStateStorageKey` (persisted UI state) |
| 11 Scrolling, virtual lists, selection | `scrollIntoContainer` / `findScrollContainer` (container scroll), `scrollContainerToBox` / `getScrollTopForBox` (a virtual-list row by index), `keepScrollAcrossMove` (scroll positions across a DOM move), `createVirtualWindow` / `computeVirtualRange` (a virtual list over fixed-height rows; the bare range math), `createSelection` (selected keys + anchor, click / Ctrl / Shift rules) |
| 12 Pointer drag & page drag | `observePageDrag` / `setDropActiveState` (page-wide file drag), `createPointerDrag` (mouse + touch drag) |
| 13 Scheduling & ids | `createMicrotaskScheduler()` (coalesce a burst into one run), `createThrottle(fn, ms)` (leading + one trailing run), `createDebounce(fn, ms)` (`schedule(...args)` / `flush()` / `cancel()`; last call wins, `ms <= 0` = synchronous, `ms` may be a function), `createFrameScheduler(fn)` (one run per animation frame), `createId(prefix)` (page-unique id for ARIA references / `for`) |

### Subpaths

| Entry point | Exports |
|---|---|
| `/positioning` | `anchor`, `createPopover`, `createTooltip`, `findOverlayContainer(trigger)` (where a portaled panel goes), `createLayer(host, opts)` (a styled layer outside the component), `getFixedPositionOffsetParent` / `detectFixedDrift` / `findContainingBlockCulprit` / `describeContainingBlockProps` (fixed containing blocks and drift), `platform` (Floating UI's, for a custom one) |
| `/actions` | `runAction`, `resolveActionItem`, `resolveMenuEntries`, `loadMenuChildren`, `normalizeActionItems` (string shorthand → items), `readActionDataset(trigger)`, `isActionBusy`, `createMenuDivider` / `isMenuDivider`, shortcuts: `bindShortcuts`, `matchesShortcut`, `parseShortcut`, `formatShortcut`, `getShortcutKeycaps`, `isTypingTarget` |
| `/menu` | `openMenu(entries, ctx, opts)`, `MENU_CSS` |
| `/a11y` | `createActiveDescendant(input, listbox, opts)` → `{ active, activeIndex, setActive, move, refresh, destroy }`, `createRovingFocus(container, opts)` → `{ current, currentIndex, focusItem, refresh, destroy }`, `createTypeahead(ms)`, `isPrintableKey`, `TYPEAHEAD_TIMEOUT_MS`, `createFocusTrap(panel, opts)` / `getTabbables(container)` (the focus trap a modal session uses) |
| `/locale` | `createLabels(host, defaults, getOwn, { getLocale })` → `{ template, text, html, all }`, `createLabelsView(labels)` → `{ text, html }` (a callback's `ctx.labels`), `resolveLabel`, `formatLabel`, `resolveLocale`, `resolveLocaleSettings`, `getDateFormat` / `getTimeFormat` / `getWeekStartDay` / `getNumberSeparators`, `getMonthNames` / `getWeekdayNames`, `formatNumber` / `parseNumber`, `getPageLocale` / `getPageSecurity` / `observePageLocale` |
| `/dialog` | `openDialog(opts)` → `{ result, close, panel, body }`, `confirmDialog(opts)` → `Promise<boolean>`, `promptDialog(opts)` → `Promise<string \| null>`, `DIALOG_CSS` |
| `/search` | `normalizeSearchText`, `prepareSearchTerm` / `matchesSearchTerm` / `NO_SEARCH_TERM`, `findTextMatches` / `matchesText`, `findRegexMatches` / `createRegexCompiler` / `createStatelessRegex`, `findHighlightRanges` / `wrapRanges` / `highlightHtml` (`escapeHtml` → main index) |
| `/testing` | `mount`, `mountBeforeUpgrade`, `cleanup`, `defineOnce`, `uniqueTag`, `nextTick`, `nextFrame`, `listen` (event spy), `waitForEvent`, `captureConsole`, `resetPageState` |
| `/cem` | `blissAnalyzerConfig`, `blissInputsPlugin`, `publicApiPlugin` / `keepPublicApi`, `cssVariablesFromManifestPlugin`, `withCoreDeclared` / `CORE_DECLARED_API` / `CORE_DECLARED_INPUTS` / `CORE_DECLARED_EVENTS`, `extractBlissClass` / `extractBlissClasses` / `extractRegistrations` / `parseRegisterComponentCall` |

## Commands

```
npm test            # vitest run (jsdom) — the whole suite
npm run test:watch  # vitest watch mode
npm run typecheck   # tsc --noEmit
npm run build       # tsc → dist/ (ESM + .d.ts), excludes *.test.ts
```

Tests (`*.test.ts`) live next to the code they cover. Source uses explicit `.js`
extensions on relative imports (moduleResolution `Bundler`) and
`verbatimModuleSyntax` (type-only imports must use `import type`).

# @keenmate/web-components-core

The shared foundation for KeenMate's web components. It consolidates the
custom-element plumbing that five shipping components (`web-multiselect`,
`web-daterangepicker`, `web-treeview`, `web-dropzone`, `web-grid`) each used to
re-implement — a reactive input model, a base element class, converters,
categorized logging, and the `window.components` global — into one package so
that correctness lives in a single place and can't drift.

> **[`docs/SPEC.md`](docs/SPEC.md) is the source of truth** for design intent. This
> README is the tour; read the relevant SPEC section before changing behavior.

## What's New in v1.0.0-rc17

**[Release notes](release-notes/1.0.0-rc17.md)** cover the upgrade: the motion level, plus one rename in
the rc16 scroll API.

- **Motion level.** `motion="auto | none | snappy | smooth"` on every component, `window.components.motion`
  page-wide, and `data-motion` on any element (a section, `<html>`) for everything inside, with or
  without base-css-variables. Components follow through the shared `--base-duration-*` /
  `--base-scroll-behavior` tokens; **the OS reduced-motion setting always wins**. Live demo:
  `examples-motion.html`.
- **`revealContainer` → `shouldRevealContainer` (BREAKING).** The `scrollIntoContainer()` option from
  rc16 follows the boolean naming rule; same behaviour.

See [`CHANGELOG.md`](CHANGELOG.md) for the full list.

## What's New in v1.0.0-rc16

**[Release notes](release-notes/1.0.0-rc16.md)** cover the upgrade: one small **breaking** change for
component authors (`toBool` needs its mode), plus container scrolling.

- **Container scroll.** `scrollIntoContainer(el, opts)` brings a row, an option or a day into view by
  scrolling the one container around it — never the page, unlike `scrollIntoView()`. The search for
  the container crosses shadow roots and slots; it honours `scroll-padding` (sticky headers) and
  `scroll-margin`, is RTL-aware, and `revealContainer` also brings an off-screen list into view.
  `findScrollContainer(el)` is the search on its own. Live demo: `examples-scroll.html`.
- **`toBool(mode)` requires its mode (BREAKING).** The bare `toBool()` meant `'presence'`, where
  `x="false"` is `true`. Pick `'default-false'`, `'default-true'`, `'tristate'` or `'presence'` (for
  `disabled` / `readonly` only).
- **Dead defaults warn.** The input-table check now flags a row whose `default` can never apply
  because the converter answers a missing attribute with something else.

See [`CHANGELOG.md`](CHANGELOG.md) for the full list.

## Install

```
npm install @keenmate/web-components-core
```

Runtime dependencies: a single one — **`@floating-ui/dom`**, used only by the
`/positioning` subpath, so it stays out of the base import graph unless you
position. The logging engine is vendored (no `loglevel` dependency).

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
| `toInt({ min?, max?, default? })` / `toFloat(...)` | numbers |
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

**Disabled**: core implements `formDisabledCallback` for form-associated elements.
A component reads `this.isEffectivelyDisabled` (its `isDisabled` input OR a
disabled ancestor `<fieldset>`) in `reinit()` and applies flips in the
**`disabledChanged(isDisabled)`** hook. The `isDisabled` input (attribute `disabled`)
**must reflect** (`shouldReflect: true`) — the browser disables a form-associated
element by its own `disabled` attribute, so a non-reflecting input would stay
disabled after `el.isDisabled = false` (core warns). A fieldset never writes
`el.isDisabled`.

Batch many changes into one reinit/update with `setAttributes({ ... })` or
`batch(() => { ... })`. A `setAttributes()` key that isn't an input (configKey or
attribute name, or a core-declared `shouldDefer` / `themeSource` / `responsive*`) warns and
is skipped — a renamed or misspelled key is never dropped silently. To await the pipeline deterministically — in a test or
before reading rendered state — use **`await el.whenSettled()`**: it resolves
once every staged change has flushed and its `reinit()`/`update()` has run
(immediately when nothing is pending).

## Environment & presentation (device / viewport / orientation)

Width buckets (`env.breakpoint`) default to `mobile ≤ 768`, `tablet ≤ 1024`, `desktop` — the
pure-css lines — and follow the base tokens `--base-breakpoint-mobile` / `--base-breakpoint-tablet`
when the page defines them (read once); `configureBreakpoints()` overrides both. Changing the
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
`lockBodyScroll()` and `observeKeyboardInset(panel)` handle page-scroll locking
and keeping the sheet above the soft keyboard. See [SPEC §12.9](docs/SPEC.md) for
the full rationale (why 600px, capability over width). The author-facing setting
type is `Presentation` (`'auto' | 'floating' | 'modal' | 'fullscreen'`).

## Responsive rules (page / per-tag / instance)

Apps tune what components do per device class / width bucket in one place — no app-side
`observeViewport` + "did it change" bookkeeping. Every `BlissElement` with an input
table takes the same rules ([SPEC §6.7](docs/SPEC.md)):

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

A map has two axes: `device` (keyed by `classifyDevice` — capability first, then the short side; a
mouse device is `desktop` at any width) and `breakpoint` (keyed by the window-width bucket, the
768 / 1024 lines). Within one map the breakpoint entry applies first and the device entry over it —
**device wins** on the same key:

| Situation | deviceClass | breakpoint | `shouldAlignNodeIcons` |
|---|---|---|---|
| Phone | `mobile` | `mobile` | `false` — from `device.mobile` |
| Desktop window narrowed below 768 px | `desktop` | `mobile` | `false` — from `breakpoint.mobile` |
| iPad portrait (768 wide) | `tablet` | `mobile` | `true` — `device.tablet` beats `breakpoint.mobile` |

Any other top-level map key (the old `{ mobile: … }` shape) warns once and is ignored.

Precedence, key by key: global map → global callback → per-tag map → per-tag callback →
**attributes / properties set on the element** → instance map → instance callback. An attribute on
one element is never overridden by a page rule. `config` / the getters report the effective value;
overrides never reflect to attributes, and a key a rule stops returning goes back to its base
value. Own widths or combinations go in a callback (`ctx.deviceClass`, `ctx.breakpoint`,
`ctx.env.viewportWidth`, …).
Rules re-run on device / breakpoint / orientation flips and rule changes — callbacks also on every
(throttled) viewport-size change — diffed, as one `update()`/`reinit()` batch; the first build already gets them. Set the page rules before the
component scripts load if you like — `registerComponent()` adopts them. Types: `ResponsiveMap<C>`,
`ResponsiveMapAxis`, `ResponsiveCallback<C>`, `ResponsiveContext<C>`.

## Theme context (dark / light)

Every `BlissElement` host carries `data-context-theme="dark|light"` when the page
asks for a scheme, so component CSS needs no `:host-context()` (unsupported in
Firefox, partial in Safari):

```css
:host([data-context-theme="dark"])  { color-scheme: dark; }
:host([data-context-theme="light"]) { color-scheme: light; }
/* per-instance forcing, declared last so it wins */
:host([data-theme="dark"])  { color-scheme: dark; }
:host([data-theme="light"]) { color-scheme: light; }
```

Resolution, highest first: `data-theme` on the component (its CSS) →
`setThemeMode('dark' | 'light')` → the component's `theme-source` → the page
(`<html>`, then `<body>`: `data-theme`, `data-bs-theme`, `.dark` / `.light`) →
nothing (the inherited `color-scheme` applies). Detection runs **once** per
watched element and is cached; one shared `MutationObserver` per element
re-detects on a signal change, and components hear only real changes.

```ts
import { setThemeMode, getThemeContext } from '@keenmate/web-components-core';

setThemeMode('dark');  // force every component ('auto' = detect again)
getThemeContext();     // the detected page scheme: 'dark' | 'light' | null
```

```html
<my-el theme-source="closest"></my-el>      <!-- nearest ancestor with a signal -->
<my-el theme-source=".admin-panel"></my-el> <!-- a chosen element -->
```

Override `themeChanged(scheme)` for JS-side theming; `static hasThemeContext = false`
opts a component out. See [SPEC §12.10](docs/SPEC.md) and `examples-theme.html`.

## Motion level (none / snappy / smooth)

Every component takes `motion="auto | none | snappy | smooth"`; `window.components.motion` sets
the level page-wide and `data-motion` does it for any element and everything inside (a section, the
whole page) — no base-css-variables needed. Components follow through the shared
`--base-duration-*` / `--base-scroll-behavior` tokens; **the OS reduced-motion setting always wins**.

```html
<section data-motion="snappy">
  <web-multiselect></web-multiselect>             <!-- snappy -->
  <web-daterangepicker motion="none"></web-daterangepicker>  <!-- its own level wins -->
</section>
<script>window.components.motion = 'none';</script>  <!-- every component left on auto -->
```

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
  config: { name: '@keenmate/web-multiselect', version: '1.0.0', author: 'KeenMate' },
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
`getRegisteredTags()`, each tag's instances with `getInstances(tag)`.

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

Also available in code as `getGlobalLogging()`.

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

## Style injection

Two zero-dep helpers (main index) for the shadow-root CSS plumbing components
re-roll. Core owns the *injection*, not the authoring rules (`@layer` order,
Vite `?inline`) — and stays render-agnostic, so these are free functions, not
base-class methods.

```ts
import { adoptStyles, createStyleSlot } from '@keenmate/web-components-core';
import styles from './main.css?inline';

// static, shared across all instances (one cached CSSStyleSheet; <style> fallback)
adoptStyles(this.shadowRoot, styles);

// per-instance user CSS (the customStylesCallback pattern) — one replaceable slot
const slot = createStyleSlot(this.shadowRoot, { cssClass: 'custom-styles' });
slot.set(this.config.customStylesCallback?.());  // re-set replaces; falsy clears
```

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
```

`anchor(floating, reference, opts)` returns `{ update, destroy }`; options:
`placement` (default `'bottom-start'`), `strategy` (default `'fixed'`), `offset`,
`shouldFlip`, `shift`, `matchWidth: 'min' | 'exact'`, `lockPlacement`, `shouldAutoUpdate`,
`inheritThemeFrom` (copies `data-theme` onto portaled layers — C-CS-10), and a
`platform` escape hatch.

## Menu (`@keenmate/web-components-core/menu`)

The shared context / dropdown menu over `/actions` entries: rendering, (lazy)
submenus, positioning, outside-interaction dismiss and the WAI-ARIA menu keyboard.

```ts
import { openMenu } from '@keenmate/web-components-core/menu';

const menu = openMenu(entries, ctx, {
  at: { x: e.clientX, y: e.clientY },  // or an element
  host: this.shadowRoot,                // where it renders (styles adopted there)
  runAction: (item, { triggerElement, sourceEvent }) => this.activate(item, triggerElement, sourceEvent),
  onClose: (reason) => { /* sync your state */ },
  returnFocusTo: this.bodyEl,
  shouldFocusFirst: isOpenedFromKeyboard,
});
menu.close();
```

### Menu theming

Every menu value resolves, highest precedence first:
**component variable** (one instance) → **`--km-menu-*`** (every menu on the page) →
**`--base-*`** (theme) → literal default.

```css
:root { --km-menu-bg: #fffbe6; }                      /* every menu on the page */
web-tree-view.files { --wtv-context-menu-bg: #eef; }  /* just this tree's menu */
```

A component that renders a menu maps its variables onto the **private**
`--_km-menu-*` layer, with no fallback, and never sets `--km-menu-*` itself:

```css
:host {
  --_km-menu-bg: var(--wtv-context-menu-bg);          /* unset → falls through to --km-menu-bg */
  --_km-menu-hover-color: var(--wtv-context-menu-hover-color);
}
```

The full variable list (with each one's `--base-*` fallback and default) ships as
[`component-variables.manifest.json`](./component-variables.manifest.json)
(`@keenmate/web-components-core/component-variables.manifest.json`).

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

```ts
// a row carries its own help text — no @attr re-declaration to drift
{ configKey: 'selectionMode', attribute: 'selection-mode',
  converter: toEnum(['single', 'multiple'], { default: 'single' }),
  description: 'Whether the user can pick one option or several.' }
```

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

## Learn more

- **[`docs/reactivity-and-batching.md`](docs/reactivity-and-batching.md)** — how
  the pipeline coalesces bursts, `reinit()` vs `update()`, how many times a
  component rebuilds, and the mass-update tools (`setAttributes` / `batch`).
- **[`docs/SPEC.md`](docs/SPEC.md)** — full design intent, the per-component
  divergence this consolidates, and the decisions log.
- **`CHANGELOG.md`** — what's landed.

## License

MIT

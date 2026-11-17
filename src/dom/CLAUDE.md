## Style injection (`src/dom/adopt-styles.ts`, SPEC §12.8 — implemented)

Two zero-dep free functions in the main index (core stays render-agnostic — no
shadow-DOM assumptions in `BlissElement`, so these are NOT methods).
`adoptStyles(root, ...cssStrings)` adopts static shared stylesheets (cached
`CSSStyleSheet` per string, shared across instances, `<style>` fallback,
SSR-safe, dedup per root) — the `main.css?inline` case. `createStyleSlot(root, {
position?, cssClass? })` → `{ set, clear, destroy }` is a per-instance
replaceable `<style>` slot for the `customStylesCallback` case (consistent
position so re-set replaces; `<style>`-based so user `@import` works). Authoring
rules (`@layer` order, `?inline`) stay CSS-guideline, not code — but the component's
own CSS MUST be in `@layer component`, or custom CSS (a `<style>`) loses to it (adopted
sheets cascade after every `<style>`).

`createCustomStyles(host, root, { getContext, getInstanceStyles, cssClass?, position?, getOwner?,
onApply? })` (`src/dom/custom-styles.ts`) → `{ refresh, destroy }`: two slots, page layer
(`window.components[tag].getCustomStylesCallback` > `.customStyles`, accessors installed by
`registerComponent()`) before the instance layer (callback > CSS). Page writes refresh every
live handle of the tag (WeakRef set in shared state). Components call `refresh()` where they
used to set their slot, `destroy()` in `destroyCallback()`. `shouldHoistImports` (default on,
shadow roots only): each `@import` URL is also a `<link data-km-custom-styles>` in the document
head — Chromium ignores `@font-face` in a shadow root; ref-counted per document in shared state,
a page-owned link is reused and never removed. Leading `@import`s per layer only (comments stripped);
a conditional one (`layer()` / `supports()` / media) is a head `<style>` with the whole statement.
Released on real removal too (`watchRemoval`, `src/element/removal-watch.ts`, driven by
BlissElement's removal check). Page decides: `window.components[tag].shouldHoistImports` >
`window.components.shouldHoistImports` (non-enumerable) > the component option.
Managed child (`getOwner?: () => HTMLElement | null`, SPEC §12.8, Q24): two more slots
(`--owner-page`, `--owner`); order child page → owner page → owner instance → child instance.
The owner's CSS = what the owner's own live handle last wrote (shared state `layers`: host →
resolved layers; `dependents`: owner host → child handles, WeakRefs, registered even before the
owner has a handle). Owner `refresh()` / page write for either tag → child refreshes; owner
destroyed / really removed / `getOwner` null or throwing / self → no owner layers. Refresh is
re-entry-guarded (an owner ↔ child cycle can't loop). `onApply` gets only the child's own layers.

## Stacking tiers (`src/dom/z-index.ts`, SPEC §12.18 — implemented)

`Z_INDEX` = `{ modalBackdrop, modal, dropdown, popover, toast, tooltip }`, each `var(--base-z-*, <default>)`
(6000 / 7000 / 7500 / 7600 / 8000 / 9000, the base-css-variables values). Dialogs + phone sheets + drawers =
`modal` (decided 2026-11-16); sub-layers `calc(<tier> + 1)`. `/menu` keeps `calc(tooltip + 1)`.

## Focus trap (`src/dom/focus-trap.ts`, SPEC §12.19 — implemented)

`createFocusTrap(panel, { initialFocus, returnFocusTo, shouldMakeBackgroundInert, keepInteractive })` → `{ release({
shouldReturnFocus }), isReleased }`. Inert = `setAttribute('inert')` on each sibling along the path panel → `<body>`
(shadow root → host), skipping style/script/template, `keepInteractive`, and already-inert ones (never removed).
Tab wrap on the panel's keydown (only at the edges; the middle is the browser's). `getTabbables` walks the flat
tree (shadowRoot children, slot assigned elements); visibility via `checkVisibility` when present (jsdom: all
visible). Release returns focus only when it was inside the panel or on `<body>`. `startModalSession` wraps it.

## Direction + ids (`src/dom/direction.ts`, `src/dom/create-id.ts`, SPEC §12.20 — implemented)

`isRtl(el)`: computed `direction` when connected with a view; jsdom answers `''` → falls back to
`composedClosest(el, '[dir]')`. `BlissElement.isRtl` + `/menu` use it. `createId(prefix)`: module counter (base 36)
+ `crypto.getRandomValues` (Math.random fallback); `/dialog` uses it.

## Form inputs, async runner, announce (SPEC §12.21–§12.23 — implemented)

`createFormInputs(host)` (`form-inputs.ts`): reuses its inputs by index, re-appends when a framework dropped
them, no `id`. `formatFormValue`: the callback wins (also over `array`); a thrown `undefined` becomes an Error.
`createAsyncRunner` (`async-runner.ts`): generation counter + AbortController per run; the loader survives a
replacing run (no flicker); `isPending` covers the debounce wait. `announce` (`announce.ts`): regions found by
`[data-km-announcer]` under `<body>` (shared across core copies); `focus-trap.ts` skips them when inerting.
Ghost click lives in `src/overlay/ghost-click.ts` (`startModalSession({ isOpenedByPointer })`).

## Persisted UI state (`src/dom/state-store.ts`, SPEC §12.17 — implemented)

`createStateStore(host, { getKey, getLoadCallback?, getSaveCallback?, toContext? })` → `{ load, save, clear }`.
The component's input rows are `storageKey` (`storage-key`, unset = off), `loadStateCallback`, `saveStateCallback`
(rulebook C-CA-17). Default store `localStorage['km-state:<tag>:<key>']` (`stateStorageKey()`); `save(partial)` merges
into the WHOLE state and the save callback gets all of it; cache per key, the key is read per call; either callback set = host mode (no localStorage, a missing half is a no-op + one warning); never throws
(callback / storage failures → the element's logger, state kept in memory). No `localStorage` in components.

## Animating out (`src/dom/animate-out.ts`, SPEC §12.16 — implemented)

`animateOut(elements, { className, onDone, shouldSetInert = true, shouldSetHeightVar = false })` →
`{ cancel(), finished }`: closing class (+ `inert`) → wait for each element's OWN `animationend` (timer
fallback duration + 50ms) → `onDone` (via `callSafely`). Duration read back from CSS by `readAnimationMs`
(longest delay + duration; `0` → synchronous `onDone`), so motion level / reduced motion need no code.
`shouldSetHeightVar` → `--km-exit-height` (measure all, then write). Cancel restores class, inert, var;
done keeps the class. `/menu`'s sheet close uses it; rulebook C-CA-18 bans own `animationend` waits.
jsdom: no animations and no `inert` — tests fake `getComputedStyle`.

## Loader (`src/dom/render-loader.ts`, SPEC §12.14 — implemented)

`renderLoader(host, container, context, { label, prefix, renderLoadingCallback? })`
→ idempotent `remove()`. Precedence: instance hook (option key present wins, else
`host.renderLoadingCallback`) > `window.components.renderLoadingCallback` > default
`<span class="<prefix>__loader" aria-hidden>`. Only the highest present hook runs; if it
throws → logged + default drawn. Container always `role="status"` (+ `aria-label` when
`label` non-empty); `remove()` drops only nodes the render added and restores the
previous `role` / `aria-label`. The page hook is a non-enumerable accessor published by
`publishLoaderHook()` (from `registerComponent()` + every `renderLoader()`); it adopts a
plain property assigned earlier. No CSS here — the component owns `.<prefix>__loader`.

## Container scroll (`src/dom/scroll-container.ts`, SPEC §12.15 — implemented)

`findScrollContainer(el, { stopAt?, axis? })` / `scrollIntoContainer(el, { block, inline,
behavior, container?, shouldRevealContainer?, stopAt?, axis? })` — scroll the ONE container around
`el`, never the page. Flat-tree walk (`assignedSlot` → parent → shadow host; local
`flatParent`; containing-block has its own; `composedParent` itself is unchanged — theme relies on it).
Never returns html/body/scrollingElement. Honours container `scroll-padding` + element
`scroll-margin`; logical `inline` (RTL swaps start/end); no `scrollTo()` when < 1px on both axes.
No container → the page scrolls (window `scrollTo`, same alignment rules, the root's
`scroll-padding`) — never `el.scrollIntoView()`, which would also scroll `overflow: hidden`
wrappers; with `stopAt` and no container below it nothing scrolls; returns `null`. Uses `el.ownerDocument.defaultView` (iframe-safe). Limits: scaled
containers, vertical writing modes, nested scrollers (innermost only).
`getScrollTopForBox(container, { top, height }, { block, insetTop })` / `scrollContainerToBox(…, { behavior })`:
the same block rules for a target that isn't rendered (a virtual-list row: `{ top: index × rowHeight,
height: rowHeight }`), content coordinates, `scroll-padding-top` + `insetTop`, clamped; `'auto'` sets
`scrollTop` synchronously; `null` = nothing moves. Every virtual list's index jump goes through it
(web-multiselect, web-treeview, web-grid had three copies of this math). jsdom has no layout: the unit test
fakes geometry; the real checks are `e2e/scroll.spec.ts` (`test/scroll.html`). Headless
Chromium doesn't animate smooth scrolling — don't write tests that depend on a running glide.

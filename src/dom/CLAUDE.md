## Style injection (`src/dom/adopt-styles.ts`, SPEC §12.8 — implemented)

Two zero-dep free functions in the main index (core stays render-agnostic — no
shadow-DOM assumptions in `BlissElement`, so these are NOT methods).
`adoptStyles(root, ...cssStrings)` adopts static shared stylesheets (cached
`CSSStyleSheet` per string, shared across instances, `<style>` fallback,
SSR-safe, dedup per root) — the `main.css?inline` case. `createStyleElement(root, {
position?, cssClass? })` → `{ set, clear, destroy }` is a per-instance
replaceable `<style>` element for the `getCustomStylesCallback` case (consistent
position so re-set replaces; `<style>`-based so user `@import` works). Authoring
rules (`@layer` order, `?inline`) stay CSS-guideline, not code — but the component's
own CSS MUST be in `@layer component`, or custom CSS (a `<style>`) loses to it (adopted
sheets cascade after every `<style>`).

`createCustomStyles(host, root, { getContext, getInstanceStyles, cssClass?, position?, getOwner?,
appliedCallback? })` (`src/dom/custom-styles.ts`) → `{ refresh, destroy }`: two slots, page layer
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
`shouldShareLayers: false` = an extra root of the same host (overlay layer): not written to / deleted from
`layers`, no `notifyDependents`. Managed child (`getOwner?: () => HTMLElement | null`, SPEC §12.8, Q24): two more slots
(`--owner-page`, `--owner`); order child page → owner page → owner instance → child instance.
The owner's CSS = what the owner's own live handle last wrote (shared state `layers`: host →
resolved layers; `dependents`: owner host → child handles, WeakRefs, registered even before the
owner has a handle). Owner `refresh()` / page write for either tag → child refreshes; owner
destroyed / really removed / `getOwner` null or throwing / self → no owner layers. Refresh is
re-entry-guarded (an owner ↔ child cycle can't loop). `appliedCallback` gets only the child's own layers.

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
`deepClosest(el, '[dir]')`. `BlissElement.isRtl` + `/menu` use it. `createId(prefix)`: module counter (base 36)
+ `crypto.getRandomValues` (Math.random fallback); `/dialog` uses it.

## Form inputs, async runner, announce (SPEC §12.21–§12.23 — implemented)

`createFormInputs(host)` (`form-inputs.ts`): reuses its inputs by index, re-appends when a framework dropped
them, no `id`. `formatFormValue`: the callback wins (also over `array`); a thrown `undefined` becomes an Error.
`createAsyncRunner` (`async-runner.ts`): generation counter + AbortController per run; the loader survives a
replacing run (no flicker); `isPending` covers the debounce wait. `announce` (`announce.ts`): regions found by
`[data-km-announcer]` under `<body>` (shared across core copies); `focus-trap.ts` skips them when inerting.
Ghost click lives in `src/overlay/ghost-click.ts` (`startModalSession({ isOpenedByPointer })`).

## Virtual window (`src/dom/virtual-window.ts`, SPEC §12.26 — implemented)

`createVirtualWindow`: spacer (`block-size`) + window (`translateY`) appended to the scroller; the list top is the
spacer's rect minus the scroller's (+ `scrollTop`), so content above it counts (`hasStructure: false` → `listTop` option, default 0). `compute()` caches the last
non-zero `clientHeight` (a hidden scroller keeps the last known size; never seen → `2 × overscan + 1` rows).
`render` via `runSafely`; `getPinned` (via `runSafely`) → `pinned` outside the range, a change of the joined list
repaints; `computeVirtualRange` is the pure math `compute()` uses. Scroll listener passive; `observeElementSize` with `shouldFireImmediately: false`.
jsdom: the unit test fakes `clientHeight` / `scrollTop` / rects; `e2e/virtual-window.spec.ts` is the real check.

## Drag (`src/dom/page-drag.ts`, `src/dom/pointer-drag.ts`, SPEC §12.28 — implemented)

`observePageDrag`: module-level watcher set (per core copy — the state needn't be page-wide), window capture
listeners while any watcher exists, `Date.now()` heartbeat (fake-timer friendly); Escape sets `isDismissed` — same-drag `dragover`s (gaps ≤ the
timeout) are ignored until a `dragenter`, a pulse pause, `drop` / `dragend` or the last unsubscribe. `createPointerDrag`: pointerdown
on the container → window capture listeners for move / up / cancel / keydown; touch adds a non-passive
`touchmove` + `contextmenu` blocker and the long-press timer; `longPressMs <= 0` arms touch at pointerdown (no timer); `longPressMs` / `threshold` re-read per press
(`readOption`); `autoScroll.isEnabled(ctx)` asked per frame (false → skip this frame, keep the loop). `start()` sets pointer capture and finds the
auto-scroll container; `call()` unwraps `runSafely` (an `beforeStartCallback` returning `false` refuses). jsdom has no
PointerEvent / DragEvent / `elementFromPoint`: the unit test dispatches plain events with the fields;
`e2e/drag.spec.ts` covers mouse, CDP touch (long press vs swipe), auto-scroll, shadow hit test, file drag.

## IME-safe text (`src/dom/text-input.ts`, SPEC §12.30 — implemented)

`observeTextInput`: skip `input` with `isComposing`; `compositionend` delivers and remembers the value until a
`setTimeout(0)` (delegated `{ selector }`: target = `composedPath()[0].closest(selector)` inside the container,
the duplicate check is per target) (Firefox's duplicate `input` comes in the same task — a microtask would clear too early, between
the two dispatches). `isImeEnter` = `isComposing || keyCode === 229`. e2e drives a real composition through CDP
`Input.imeSetComposition` / `Input.insertText` (Chromium only).

## Scroll across a move (`src/dom/keep-scroll.ts`, SPEC §12.31 — implemented)

`keepScrollAcrossMove`: capture `scroll` listeners on host + shadow root record into a WeakMap; restore on
`watchConnection` (`src/element/connection-watch.ts`, `notifyConnected()` at the end of BlissElement's
`#activate`) + one rAF. Unit fake: jsdom has no layout and custom-element reactions run the host's connect
before a child's disconnect — the test resets the fake offsets in the host's `disconnect()`. e2e
`keep-scroll.spec.ts` proves Chromium resets a moved scroller (control element) and the helper restores it.

## Clipboard (`src/dom/clipboard.ts`, SPEC §12.32 — implemented)

`copyText`: API only when `isSecureContext !== false`; the fallback textarea must be FOCUSED before `select()`
(execCommand copies the focused selection); focus (`deepActiveElement`) + ranges restored. The e2e never touches the system clipboard
(headless Chromium on Windows shares it): the fixture captures `writeText` / `execCommand`, a paste is a constructed
`ClipboardEvent` with a `DataTransfer`.

## Icons (`src/dom/render-icon.ts`, SPEC §12.33 — implemented)

`renderIcon`: `<` → raw; a `BUILT_IN_ICON_NAMES` name → `.km-icon` span with an inline `--_km-icon: var(--base-icon-<name>,
linear-gradient(transparent 0 0))` (the transparent fallback keeps an unset token from masking nothing = a solid
square); the element's hook (option, else `host.renderIconCallback`; `ctx.component` = the `component` option, else `host.localName` — a Svelte tree's host is a `<div>`) then the page hook `window.components.renderIconCallback` (`publishIconHook`, shared state like the loader hook,
`runSafely`; a string wins); `CLASS_LIST` → `<i class="<prefix>__icon …">` (no marker class of its own; the component's `__icon` rule styles it); else `escapeHtml`. Keep
`BUILT_IN_ICON_NAMES` in sync with base-css-variables' `--base-icon-*` (minus `check-size`). `ICON_CSS` is NOT part of the manifest test (its only variables are private / dynamic).
`/menu` adopts it next to `MENU_CSS`.
Live page hook: the shared state also carries `revision` + `listeners` + the notifying `get` / `set` (added in place
when an rc24-or-older copy created the state); the setter bumps + `notifyListeners` only on a real change. `publishIconHook`
deletes an accessor whose `set` isn't `state.set` (an older copy's, which never notifies) before `publishPageSetting`.
`observeIconHook` / `getIconHookRevision` feed BlissElement's opt-in `iconsChanged()` (same gate + reconnect catch-up
as `localeChanged()`).

## Render-callback results (`src/dom/render-slot.ts`, SPEC §12.35 — implemented)

`renderSlot` (+ `renderSlotHtml`, the stateless string form: a node is serialized): per-container memo in a module WeakMap (`{ key, hasKey, kind, html }`); `memoKey: undefined` = no
memo; `result` may be a thunk (skipped on a memo hit). `hidden` toggled only by `false` / any other result.

## Persisted UI state (`src/dom/state-store.ts`, SPEC §12.17 — implemented)

`createStateStore(host, { getKey, getLoadCallback?, getSaveCallback?, toContext? })` → `{ load, save, clear }`.
The component's input rows are `storageKey` (`storage-key`, unset = off), `loadStateCallback`, `saveStateCallback`
(rulebook C-CA-17). Default store `localStorage['km-state:<tag>:<key>']` (`getStateStorageKey()`); `save(partial)` merges
into the WHOLE state and the save callback gets all of it; cache per key, the key is read per call; either callback set = host mode (no localStorage, a missing half is a no-op + one warning); never throws
(callback / storage failures → the element's logger, state kept in memory). No `localStorage` in components.

## Animating out (`src/dom/animate-out.ts`, SPEC §12.16 — implemented)

`animateOut(elements, { className, doneCallback, shouldSetInert = true, shouldSetHeightVar = false })` →
`{ cancel(), finished }`: closing class (+ `inert`) → wait for each element's OWN `animationend` (timer
fallback duration + 50ms) → `doneCallback` (via `runSafely`). Duration read back from CSS by `readAnimationMs`
(longest delay + duration; `0` → synchronous `doneCallback`), so motion level / reduced motion need no code.
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
`flatParent`; containing-block has its own; `deepParent` itself is unchanged — theme relies on it).
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

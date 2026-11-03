# Core review 2026-11-03 — slice 03: environment / global / overlay

Scope: `src/environment/*`, `src/global/*`, `src/overlay/*`, their unit tests, `e2e/motion|page|scroll-lock|core-regressions.spec.ts`, SPEC §6.7 / §12.3 / §12.8 / §12.9 / §12.10 / §12.16.
Probes: `src/environment/__probe-env-1/2/4.test.ts`, `src/global/__probe-env-3.test.ts`. All were run and then deleted. No other files were changed.

## Summary

| ID | Sev | Category | Where | One-liner | Status |
|---|---|---|---|---|---|
| V-01 | High | bug | environment.ts:474-483 (+ bliss-element.ts:459-472) | If a listener throws on its immediate fire, the subscription is added but no unsubscribe is ever returned. With BlissElement, a throwing first `environmentChanged()`/`viewportChanged()` leaks the global listeners and the element is never `ready`. | CONFIRMED |
| V-02 | Medium | bug | instances.ts:13 | The live-instance registry is a module `Map`, so `getInstances()` / `getRegisteredTags()` only see their own copy's tags. The devtools path in SPEC §12.3 can't enumerate the page. | CONFIRMED |
| V-03 | Medium | bug | register-component.ts:110-130 | When a second copy registers the same tag, it silently replaces the `window.components[tag]` entry: wrong `version()`, `getInstances()` returns `[]`, `logging` is deleted, and nothing warns. | CONFIRMED |
| V-04 | Medium | bug | motion.ts:55-59 | `MOTION_CSS` is only adopted into the element's own root. If no BlissElement sits in document light DOM, `<html>`/`<section data-motion>` do nothing (without base-css-variables). | CONFIRMED (adoption); cascade effect inferred |
| V-05 | Medium | bug/design | environment.ts:546-550 | `classifyDevice` uses `innerHeight`. Where the keyboard resizes the layout viewport, a landscape tablet's short side drops below 600, so it flips to `mobile` → fullscreen while the user types. | Logic CONFIRMED; browser trigger speculative |
| V-06 | Medium | bug | element-size.ts:454-470 | A throwing size listener (it fires synchronously on the leading edge inside the RO callback) stops the fan-out to every other subscriber and entry. The environment and theme modules isolate throwing listeners; this one doesn't. | CONFIRMED |
| V-07 | Low | bug | motion.ts:79-85 | One throwing page-motion listener stops the rest, and the error is thrown back at whoever assigned `window.components.motion`. | CONFIRMED |
| V-08 | Low | bug | motion.ts:93-111 (also render-loader / logging publishers) | If the page replaces `window.components` after load, a later `.motion = 'none'` is a plain property. Elements aren't told; it only takes effect at the next `getPageMotion()` read. | CONFIRMED |
| V-09 | Medium | design | active-overlay.ts:128-149 | No nesting/stack concept. A child overlay opened from inside a parent overlay (row context menu inside a dropdown, both ungrouped) dismisses the parent. No shared "topmost gets Escape" stack. | CONFIRMED (child.activate dismisses parent) |
| V-10 | Low | design/docs-drift | motion.ts / bliss-element.ts:1410-1420, SPEC §12.16 | The page-wide `window.components.motion` is written onto each host as `data-motion`, so it beats a nearer `<section data-motion>`. The SPEC precedence list doesn't place the page level. Untested. | Speculative (by reading) |
| V-11 | Low | bug | scroll-lock.ts:48-62 | Pinning the body removes the root scrollbar with no `padding-right` compensation, so content jumps sideways on desktop (modal presentation). Body margins also become `width:100%` + margin. | Speculative (no layout in jsdom) |
| V-12 | Low | design | active-overlay.ts:165-167 | `dismissAllOverlays(maybeGroup)` with `undefined` dismisses only the ungrouped group, while a call with no argument dismisses every group. This is decided by `arguments.length`. | CONFIRMED |
| V-13 | Low | bug | environment.ts:177-196 | Breakpoint tokens are read and latched on the first browser snapshot. If that happens before the token stylesheet applies (JS-injected CSS in Vite dev, lazy CSS), the defaults stick for the whole session. | Speculative |
| V-14 | Low | bug | keyboard-inset.ts:34-49 | Writes `vv.height` / `offsetTop` with no scale handling, so pinch-zoom shrinks the panel. Cleanup blanks any inline `height`/`top` the component set before. Uses global `window`, not `panel.ownerDocument.defaultView`. | Speculative |
| V-15 | Low | bug | element-size.ts:437-441 | Measures with `getBoundingClientRect` (includes transforms) inside the RO callback. A scaled element or a scale-in animation reports the transformed size, and every callback forces a sync layout. | Speculative |
| V-16 | Nit | dead code | active-overlay.ts:77,135-145 | The `active` map is written but never read (no export). It's also per-copy, so it can't become page-wide introspection as written. | By reading |
| V-17 | Low | duplication / missing-helper | motion.ts:74-105, render-loader.ts:62-91, global-logging, theme, scroll-lock, breakpoints | The `globalThis[Symbol.for(k)] ??= init` pattern and the "publish a non-enumerable accessor on window.components, adopting a pre-set plain value" pattern are each copy-pasted 3-6 times. Key naming is inconsistent (`km-scroll-lock`, `km-overlay-all-groups`, `@keenmate/…:motion`, `@keenmate/…/theme@1`). | By reading |
| V-18 | Nit | docs-drift | environment.ts:445-450; element-size.ts header; SPEC §12.9 | `observeEnvironment` JSDoc says it fires on "viewport size" changes (it doesn't). Element-size and SPEC say "single page-wide ResizeObserver", but it's one per core copy. | By reading |
| V-19 | Medium | test-gap | — | Uncovered scenarios: see list at the end. | — |

---

## Findings

### V-01 — High — bug — a throwing immediate listener leaks the subscription and wedges BlissElement activation
`src/environment/environment.ts:474-483`
```ts
channel.add(listener);
if (first) start();
if (opts.shouldFireImmediately !== false) listener(getEnvironment());   // throws → no return
return once(() => { … });
```
- **What's wrong.** The listener is added to the channel and the shared `matchMedia`/`resize`/`km-breakpoints-change` listeners are started before the immediate fire. If that fire throws, the caller never receives the unsubscribe, so the subscription can never be removed.
- **BlissElement impact** (`bliss-element.ts:459-472`). `#activate()` does `this.#envUnsub = observeEnvironment(...)`. A subclass whose `environmentChanged()` throws on the first call (for example, it touches DOM that `reinit()` didn't build) leaves:
  - `#envUnsub` undefined;
  - the closure retained forever, holding the element alive and firing into a detached element on every later flip;
  - the rest of `#activate()` skipped: viewport / size / theme subscriptions and the `ready` microtask;
  - `isReady` stuck at false, so `whenReady()` never resolves.

  This violates the CLAUDE.md promise that "a hook that throws … never wedges the element". `observeViewport` has the same problem.
- **Probe.** After `observeEnvironment(() => { throw })`: 5 live MQL listeners, no handle. With a BlissElement whose `environmentChanged` throws: `isReady === false` after microtasks, and 5 MQL listeners are still attached after `el.remove()`.
- **Fix.**
  - In `subscribe()`, wrap the immediate fire with the same try/catch + `coreLog(...).error` used by `notifyAll`. Alternatively, build the unsubscribe before firing, and on a throw unsubscribe and rethrow.
  - Separately, in `#activate()`, assign each unsub before anything can throw, or guard each hook call, so one throwing hook can't skip the rest of activation.

### V-02 — Medium — bug — instance registry is per copy
`src/global/instances.ts:13` (`const REGISTRY = new Map()`)
- **What's wrong.** Each bundled copy keeps its own registry. SPEC §12.3 sells `getRegisteredTags()` + `getInstances()` as the devtools path for enumerating the page.
- **Failure.**
  - An app (or a devtools overlay shipped in a component) imports `getRegisteredTags` from its own core copy and sees only that copy's tags.
  - `getInstances('web-grid')` imported from the multiselect bundle returns `[]`.
- **Probe.** Copy A: `['probe-a-el']`. Copy B: `[]`.
- **Fix.** Move the registry to `globalThis[Symbol.for('@keenmate/web-components-core:instances')]`, with the same `Map<string, Set<HTMLElement>>` shape. `logging/logger-registry.ts:10` `BY_TAG` has the same per-copy issue (that's the logging slice, but V-03 touches it).

### V-03 — Medium — bug — the same tag registered by two copies silently clobbers the entry
`src/global/register-component.ts:110-130`
- **What's wrong.** A second `registerComponent(tag, …)` from another copy (a component bundle loaded twice by two micro-frontends, or CDN + npm) leaves `define()` as a no-op, because copy A's class is already the defined element. But it still overwrites `window.components[tag]`:
  - `version()` reports B's version while A's class runs;
  - `getInstances()` reads B's empty registry;
  - with no `logging` option, `delete existing.logging` removes A's working controls; with one, B's bundle replaces A's, and A's elements never use B's bundle.
- **Probe.** After the second copy: `version '2'`, `instances 0`, `logging false`, defined class is still A.
- **Fix.** In `registerComponent`, when `customElements.get(tag)` already exists and differs from `elementClass`:
  - warn via `coreLog(null,'INIT','ELEMENT')` ("<tag> already defined by <existing config.name@version>; ignoring registration of …");
  - leave the existing entry untouched.

  V-02's page-wide registry fixes `getInstances` on its own.

### V-04 — Medium — bug — `data-motion` on page elements is dead unless some BlissElement lives in the document
`src/environment/motion.ts:55-59`
- **What's wrong.** `adoptMotionStyles(node)` adopts `MOTION_CSS` only into `node.getRootNode()`. When every KM component is rendered inside a non-Bliss shadow root (a Lit/Svelte-custom-element app shell), the document never receives the `[data-motion]` rules.
- **Failure.** `<html data-motion="none">` or `<section data-motion="snappy">` has no effect. This contradicts SPEC §12.16 ("The same attribute on any element (`<html>`, a `<section>`) sets the level for everything inside", "with or without base-css-variables"). The e2e "nested in shadow root" test passes only because `motion-parent` itself lives in the document, and the inner probe sets its own `motion="none"`.
- **Probe.** Host `<div>` with a shadow root holding a BlissElement: the shadow root has `MOTION_CSS`, the document has none.
- **Fix.** In `adoptMotionStyles`, also `adoptStyles(node.ownerDocument, MOTION_CSS)` when the root is a ShadowRoot. Both calls are idempotent.

### V-05 — Medium — bug/design — device class flips to `mobile` when the keyboard shrinks the layout viewport
`src/environment/environment.ts:546-550`, with `computeSnapshot` using `window.innerHeight`
- **What's wrong.** The short side is `min(innerWidth, innerHeight)`. Where the soft keyboard resizes the layout viewport, a landscape tablet (1280×800) with the keyboard open reads about 1280×420, so the short side is 420 < 600 and the class becomes `mobile`. Such browsers include Firefox Android, older Chrome Android, or any page with `<meta name=viewport content="interactive-widget=resizes-content">`.
- **Failure.** `environmentEqual` includes `classifyDevice`, so `environmentChanged` fires. `resolvePresentation('auto')` then flips the floating dropdown to fullscreen while the user types into its search box, and flips back when the keyboard closes.
- **Probe.** `classifyDevice({isTouchPrimary:true, 1280×800}) === 'tablet'`; with 1280×420 it is `'mobile'`. The browser trigger itself is speculative.
- **Fix.** Classify on a keyboard-independent short side, such as `Math.min(screen.width, screen.height)`, or the largest `innerHeight` seen in the current orientation. At minimum, ignore height drops while an editable element is focused. Add a unit test.

### V-06 — Medium — bug — a throwing size listener breaks fan-out
`src/environment/element-size.ts:454-470`
- **What's wrong.** `fire()` calls `sub.listener` without a try/catch. On the leading edge it runs synchronously inside `onResize`, so one throwing `sizeChanged()` aborts the `for` loops: the other subscriptions on that element and the remaining entries in the batch get nothing. Environment and theme were hardened for exactly this (see the `core-regressions` e2e tests).
- **Probe.** Two subscribers on one element; the first throws on the RO callback; the second is never called.
- **Fix.** Wrap the call in `fire()` with try/catch + `coreLog(null,'UI','ELEMENT').error('element-size listener threw', e)`. Add unit and e2e regressions like the env/theme ones.

### V-07 — Low — bug — throwing page-motion listener
`src/environment/motion.ts:84`
- **What's wrong.** `for (const listener of [...s.listeners]) listener(next);` has no isolation. A throw stops later elements from updating `data-motion`, and the page's `window.components.motion = 'none'` assignment throws.
- **Probe.** Confirmed: the second listener is not called, and the assignment rethrows.
- **Why Low.** Today's only listener is BlissElement's `#applyMotion` (a `setAttribute`), so the risk is low. But the listener set is shared across copies, so a future or buggy copy breaks every copy.
- **Fix.** Use a try/catch like theme's `deliver`.

### V-08 — Low — bug — replaced `window.components` loses live motion propagation
`src/environment/motion.ts:93-111`
- **What's wrong.** The accessor is (re)installed only by `registerComponent` / `getPageMotion` / `observePageMotion`. After `window.components = {...}` (state managers and SSR hydration do this), `window.components.motion = 'none'` lands as a plain value. No element is notified; it's adopted only on the next `getPageMotion()` (the next connect).
- **Probe.** Confirmed: the listener isn't called on the assignment; it is called once when `getPageMotion()` runs later.
- **Same pattern.** `renderLoaderCallback` and the responsive hooks follow the same pattern (pull-on-read, so they're less visible there).
- **Fix.** Either document "don't replace `window.components`", or define `window.components` itself as an accessor on `window` that re-publishes the hooks onto any assigned object.

### V-09 — Medium — design — no overlay nesting/stack
`src/overlay/active-overlay.ts:128-149`
- **What's wrong.** `activate()` dismisses every other participant in the group, including the overlay the new one was opened from.
- **Failure.** A row context menu (`openMenu` registers with `opts.overlayGroup`, which defaults to ungrouped) opened inside a multiselect/daterangepicker dropdown or a grid editor popover closes the host dropdown. Components must remember to pass distinct groups.
- **Missing pieces.**
  - No "parent" or "keep-open-while-child" option.
  - No shared overlay stack for "Escape closes only the topmost". `open-menu.ts` handles Escape in a document capture listener; other overlays have their own handlers.
  - No shared focus-restore helper.
- **Probe.** `child.activate()` dismissed `parent`.
- **Fix.** Add `registerOverlay(onDismiss, { group, parent?: OverlayHandle | Element })`, where a participant is never dismissed by its descendants. Optionally keep a page-wide (`Symbol.for`) stack for Escape ownership.

### V-10 — Low — design/docs-drift — page-wide motion beats a nearer section
`bliss-element.ts:1410-1420`; SPEC §12.16 precedence list
- **What's wrong.** For an `auto` element, core writes `window.components.motion` onto the host as `data-motion`. So `<section data-motion="none">` containing a component loses to `window.components.motion = 'smooth'`, which is the opposite of "nearest wins".
- **Fix.** Either have the page-wide level set `data-motion` on `<html>` rather than on each host (so sections and elements nest naturally), or state the precedence explicitly in the SPEC and add an e2e test for the page + section combination.

### V-11 — Low — bug — scroll lock causes horizontal layout shift
`src/overlay/scroll-lock.ts:48-62`
- **What's wrong.** Pinning the body removes the document's scrollable overflow, so a classic (non-overlay) scrollbar disappears and the content widens by its width. Nothing compensates (Bootstrap and others add `padding-right: innerWidth - clientWidth`). `width:100%` also ignores body margins.
- **Failure.** On phones (overlay scrollbars) this is invisible. It shows on desktop and tablet whenever a component locks for a `modal` presentation.
- **Fix.** On pin, compute `gap = view.innerWidth - document.documentElement.clientWidth`. If it's positive, save and set `padding-right` (calc on top of the existing value), and add it to `PINNED_PROPERTIES` / the documented `ScrollLockState` shape (the pure-css shape must follow).

### V-12 — Low — design — `dismissAllOverlays(undefined)` is not "all"
`active-overlay.ts:165-167`
- **What's wrong.** Forwarding an optional group (`dismissAllOverlays(this.group)`) with no group set dismisses only ungrouped overlays.
- **Probe.** Confirmed.
- **Fix.** Treat `undefined` as "all" and add an explicit `UNGROUPED` symbol, or split into `dismissAllOverlays()` and `dismissOverlayGroup(group)`.

### V-13 — Low — bug — breakpoint tokens latched too early
`environment.ts:177-196`
- **What's wrong.** `isSettled = true` on the first snapshot, even when both tokens are absent. A component connecting before the base-css-variables sheet applies (Vite dev injects CSS from JS; a lazily loaded theme) locks in 768/1024 forever.
- **Fix.** Don't settle while both tokens are absent; re-read on the next snapshot (cheap), or settle on `DOMContentLoaded`/`load`. Document the timing.

### V-14 — Low — keyboard-inset robustness
`overlay/keyboard-inset.ts:34-49`
- **Pinch-zoom.** `vv.height` shrinks with `vv.scale`, so the panel shrinks; `offsetLeft` is ignored.
- **Cleanup.** It assigns `''`, wiping inline `height`/`top` the component may have set before attaching.
- **Wrong window.** It uses the global `window`, not `panel.ownerDocument.defaultView` (wrong for iframe panels).
- **Fix.** Skip writes when `vv.scale !== 1`, restore the saved previous inline values, and use the panel's own view.

### V-15 — Low — element-size measurement
`element-size.ts:437-441`
- **What's wrong.** `getBoundingClientRect` returns the transformed box, while RO tracks the layout box. A popover inside a `transform: scale(.95)` open animation reports 95% widths to `sizeChanged`. Each RO callback also forces a sync layout.
- **Fix.** Use `entry.borderBoxSize[0]` (with `writing-mode` mapping) in the RO callback, and `offsetWidth`/`offsetHeight` for the immediate read.

### V-16 — Nit — dead `active` map
`active-overlay.ts:77,135-145`
- **What's wrong.** The map is written in `activate`/`deactivate`/`destroy` but never read or exported. It's also per-copy.
- **Fix.** Remove it, or make it page-wide and expose `getActiveOverlay(group)`.

### V-17 — Low — duplication / missing helper / naming
- **Repeated page-state boilerplate.** `globalThis[Symbol.for(key)] ??= init` appears in motion.ts:74, scroll-lock.ts:35, theme.ts:113, environment.ts:144, render-loader, global-logging. Suggest an internal `pageState<T>(key, init): T`.
- **Repeated accessor publishing.** "Publish a non-enumerable accessor on window.components, adopting a pre-set plain value" appears in `publishMotionHook`, `publishLoaderHook` and the responsive publishers. Suggest `publishComponentsHook(key, get, set, adopt)`.
- **Inconsistent key names.** `km-scroll-lock`, `km-overlay-all-groups`, `@keenmate/web-components-core:motion|breakpoints|logging|loader`, `@keenmate/web-components-core/theme@1`. Only theme is versioned, although the motion and breakpoint shapes can drift just as easily.
- **Fix.** Pick one scheme (`@keenmate/web-components-core:<name>@<v>`; the shared-with-pure-css keys documented as such).

### V-18 — Nit — docs drift
- **`environment.ts:445-447`.** `observeEnvironment` JSDoc says it fires when "viewport size … changes". The discrete channel excludes size since rc09.
- **`element-size.ts` header + SPEC §12.9.** They say "single, shared, page-wide `ResizeObserver`". It's one per core copy: module `let ro`, which is fine functionally. Either say "per core copy" or move it to `globalThis`.
- **`register-component.ts:90-93`.** The `ComponentsRegistry` JSDoc says "neither can clash", but it now lists five non-enumerable keys.

### V-19 — Medium — test gaps (concrete uncovered scenarios)
1. **environment.**
   - An immediate-fire throw (V-01), unit and BlissElement level: ready still fires, no leak after `remove()`.
   - A `configureBreakpoints()` call made *inside* a listener (re-entrant `recompute`).
   - `observeViewport` only + `configureBreakpoints` across copies.
   - The legacy `addListener`/`removeListener` path (old Safari) is untested; the mock provides both, but `addEventListener` always wins.
   - A device-class flip on a keyboard-induced height change (V-05).
2. **element-size.**
   - A throwing listener (V-06).
   - Unsubscribe from inside the listener during RO fan-out.
   - Two copies of core observing the same element.
3. **motion.**
   - The listener-isolation case (V-07).
   - `window.components` replaced after load (V-08).
   - Page-wide level combined with a section `data-motion` (V-10).
   - e2e: an `<html data-motion>` / section with all components inside a non-Bliss shadow root (V-04).
   - Two core copies: one `window.components.motion` assignment updates elements of both (the shared listener set is untested across `vi.resetModules()`).
   - `motion` on an element moved from the document into a shadow root (re-adoption).
4. **theme.**
   - A cross-copy *observer* case: a subscriber from copy B is notified by a mutation observed through copy A's observer. The existing "shared state" test checks the state object only.
   - A `theme-source` element removed from the DOM while subscribed.
   - `setThemeMode` while a subscriber exists only on a source watch.
5. **global.**
   - Cross-copy `getInstances`/`getRegisteredTags` (V-02).
   - The same tag registered by two copies (V-03).
   - `registerComponent` with an existing non-object `window.components[tag]`.
   - `registerComponent` after the page replaced `window.components`.
6. **overlay.**
   - Nested overlays (V-09).
   - `dismissAllOverlays(undefined)` (V-12).
   - `lockBodyScroll` interplay:
     - with `observeKeyboardInset` on a pinned body (e2e on a mobile viewport);
     - lock → `<body>` swapped (Turbo) → release;
     - release order across copies when the *other* copy took the first lock (the restored `saved` snapshot comes from the other copy's pin). Only the count is tested cross-copy, not that the restored styles and scroll position are right.
     - e2e for desktop scrollbar layout shift (V-11).
   - keyboard-inset: an `offsetTop` change via the `scroll` event alone, and the pinch-zoom case.
7. **SSR.** No test imports these modules with `window`/`document` undefined (a node-environment vitest file). The module-level code (`createThrottle`, `createFrameScheduler`, `Symbol.for` lookups) looks SSR-safe by reading, but nothing guards against regressions.

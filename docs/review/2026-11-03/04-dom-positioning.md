# Core review 2026-11-03 — slice 04: `src/dom/*` + `src/positioning/*`

> **Line numbers in this report are wrong** (the reviewer miscounted lines in these CRLF files). Use the corrected `file:line` in [`../2026-11-03-code-review.md`](../2026-11-03-code-review.md); the symbols and descriptions here are accurate.

Reviewer: cold adversarial pass. Probes: `src/dom/__probe-dom-1.test.ts` (9 cases) and
`src/positioning/__probe-pos-1.test.ts` (11 cases), both run with `npx vitest run` and then deleted.
"CONFIRMED" = shown by one of those probes in jsdom. "BROWSER" = depends on layout / top layer / real
CSSOM, so jsdom can't confirm it; reasoned from the platform spec only.

## Summary (sorted by severity)

| ID | Sev | Category | Where | One-line | Status |
|----|-----|----------|-------|----------|--------|
| D-01 | High | bug | render-loader.ts:137-141,183 | `remove()` deletes **every** node added to the container after the render, including the component's own content and a second loader | CONFIRMED |
| D-02 | High | design/bug | popover.ts:241,254 / tooltip.ts:71,124 | Portaling to `document.body` breaks inside a modal `<dialog>` / top layer: the panel sits under the dialog and is inert | BROWSER |
| D-03 | Medium | bug | adopt-styles.ts:23-27,51-55 | Dedup is a private per-copy WeakMap, not a check against the root: once the sheets are dropped (re-render, `adoptedStyleSheets = [...]`) they are never re-adopted; each bundled core copy adopts again (MOTION_CSS / MENU_CSS ×N) | CONFIRMED |
| D-04 | Medium | bug | scroll-container.ts:338-342,275 | `stopAt` with no scroller inside → falls back to `el.scrollIntoView()`, scrolling the outer scroller **and the page**, which `stopAt` was meant to prevent | CONFIRMED |
| D-05 | Medium | bug | microtask-scheduler.ts:222-227 | A throwing task loses every other task in the same batch (the set is cleared before the loop runs). The scheduler is public (index.ts:52) | CONFIRMED |
| D-06 | Medium | bug | containing-block.ts:161, 84-91 | Drift culprit is searched from the **reference**, not the panel; a portaled panel's real containing block is never visited | CONFIRMED |
| D-07 | Medium | bug | tooltip.ts:93-151 | Trigger removed while the tooltip is visible (list re-render): no `mouseleave`, the tooltip stays forever with `autoUpdate` running | CONFIRMED |
| D-08 | Medium | missing-helper / a11y | tooltip.ts (whole) | No `aria-describedby` wiring, no Escape dismissal (WCAG 1.4.13), can't hover onto the tooltip, mouseleave hides it while focus is still on the trigger | CONFIRMED |
| D-09 | Medium | missing-helper | popover.ts | `createPopover` has no outside-click / Escape / `km-overlay-activate` dismissal; each component and the e2e fixture roll their own (menu does it again in open-menu.ts:478) | by reading |
| D-10 | Medium | design | popover.ts:185-224,255-268 | The popover preset silently drops half of `AnchorOptions`: object `offset`, `maxHeight`, `maxWidth`, `flipPadding`, `arrow`, `autoUpdateOptions`, `shouldUseFixedContainingBlock`, `driftCallback`, `computedCallback` | CONFIRMED |
| D-11 | Medium | bug | scroll-container.ts:229,341 | `overflow: hidden` clipping wrappers are skipped by the walk but still scrolled by the `scrollIntoView` fallback, so content shifts inside a clipped box | BROWSER |
| D-12 | Low | bug | containing-block.ts:69-74 | `getFixedPositionOffsetParent` walks `composedParent`, not the flat tree, so a **slotted** floating element misses a transformed wrapper around the slot | CONFIRMED |
| D-13 | Low | bug | containing-block.ts:63-76 | The fixed-CB sugar ignores the top layer (`:popover-open`, `:modal`), so it returns a transformed ancestor where floating-ui's default would return the viewport | BROWSER |
| D-14 | Low | bug | anchor.ts:164-190 | No `.catch` on `computePosition(...).then(...)`: a throwing `placedCallback` / `computedCallback` / `driftCallback` / arrow write becomes an unhandled rejection | CONFIRMED |
| D-15 | Low | bug | tooltip.ts:86-96,125 | Follow-cursor: a focus or imperative `show()` reuses the stale cursor rect from an earlier hover (it is never reset in `hide()`) | CONFIRMED |
| D-16 | Low | bug | tooltip.ts:174-187, popover.ts:280-282 | Handles still work after `destroy()`: `tooltip.show()` re-mounts with no listeners left to hide it; `popover.destroy` uses `this`, so a detached `const {destroy} = pop` throws | CONFIRMED |
| D-17 | Low | bug | anchor.ts:30-34,133 | Theme inheritance copies only `data-theme`, once, and never clears it. core's own `readThemeSignal` (theme.ts:70) also accepts `data-bs-theme` and `.dark` / `.light`; a reused panel keeps a stale theme | CONFIRMED (stale) |
| D-18 | Low | bug | scroll-container.ts:287-290,354-357 | `scroll-padding` percentages are parsed as px (`10%` → 10) | CONFIRMED (computed value is `10%`) |
| D-19 | Low | bug | adopt-styles.ts:23,58-66 | One cached `CSSStyleSheet` is shared across documents; adopting it into an iframe's root throws `NotAllowedError`, and the string is already marked as seen, so a retry is a no-op | BROWSER |
| D-20 | Low | docs-drift | adopt-styles.ts:93 | "`'last'` (so it wins the cascade)" is false against adopted sheets: `adoptedStyleSheets` cascade after every `<style>` in the root, so it only holds when the component CSS is layered | BROWSER (spec) |
| D-21 | Low | naming | types.ts:324-338, tooltip.ts:48 | `placedCallback` / `computedCallback` / `driftCallback` are pure notifications (return value ignored), which breaks the `*Callback` = state-affecting rule; `beforeShowCallback` / `beforeComputeCallback` can't cancel, unlike core's `before*Callback` contract (`false` cancels) | by reading |
| D-22 | Low | bug | css-var-lint.ts:402,411 | The `[a-z0-9-]+` name class cuts names at `_` / non-ASCII (`--ms-foo_bar` → `--ms-foo`); declarations inside comments count; the `i` flag folds case, although custom properties are case-sensitive | CONFIRMED |
| D-23 | Low | design | containing-block.ts:39-53,58-62 | The sugar deliberately ignores `contain: paint/layout/strict/content`, which current Chromium / Firefox / WebKit do honour as a fixed CB, so it mis-places inside such wrappers by design and relies on `driftCallback` to notice | BROWSER |
| D-24 | Low | bug | containing-block.ts:88 | Culprit match compares the ancestor's border-box x/y with a padding-box origin, so a bordered culprit (`border ≥ 2px`) is missed | by reading |
| D-25 | Low | bug | anchor.ts:183-188 | `driftCallback` with `strategy: 'absolute'` measures against `window`, so it reports drift on every frame | by reading |
| D-26 | Nit | bug | throttle.ts:272-288 | `Date.now()` is not monotonic: after a clock step back the window stretches by the skew. Use `performance.now()` | by reading |
| D-27 | Nit | bug | anchor.ts:47 | The arrow's static-side offset uses `offsetWidth` for every side; `left` / `right` placements should use `offsetHeight` (identical only for a square arrow) | by reading |
| D-28 | Nit | naming | anchor.ts:142-145, popover.ts:243, tooltip.ts:83, adopt-styles.ts:27, anchor.ts:151 | Internal booleans `flipEnabled`, `frozen`, `freeze`, `open`, `visible`, `constructableOk`, `useFixedCB` don't use the is/should/has/can prefixes | by reading |
| D-29 | — | test-gap | see the section at the end | Constructable-sheet path never tested; positionArrow; hide delay; popover option forwarding; containing-block property matrix; e2e for dialog / transform / drift / shadow-root tooltip | — |

No page-wide state in a module variable was found in this slice, apart from D-03 / D-19: the
adoptStyles caches, which are per-copy in effect. The loader hook state is correctly kept on
`globalThis[Symbol.for('@keenmate/web-components-core:loader')]`. Per-copy module memos that are
harmless: `constructableOk` (adopt-styles.ts:27) and `isWebKitValue` (containing-block.ts:26) are
pure feature probes.

---

## Findings

### D-01 — High — bug — `src/dom/render-loader.ts:137-141, 183`
`before` is a snapshot of the container's children taken at render time. `discard()` removes
`childNodes − before`, and it is evaluated **when `remove()` runs**. So everything that entered the
container in the meantime is deleted, not just the hook's nodes. This contradicts SPEC §12.14 and
the doc comment ("removes the nodes the render added").
- Scenario A (CONFIRMED): the grid's infinite-scroll row container. The loader is drawn, data arrives,
  the component appends the new rows, then calls `remove()`, and the rows are wiped.
- Scenario B (CONFIRMED): two overlapping loaders in one container (e.g. 'search' then 'overlay').
  Removing the first one also removes the second spinner and restores `role` to `null`, while the
  second loader is still "active". Its own `remove()` then restores `role="status"` from its stale
  snapshot.
- Fix: record the exact nodes the render produced (after the hook, `added()` once → `const ours = added()`,
  plus the default span) and remove only those. For overlap, either keep a per-container stack
  (WeakMap) or document "one loader per container".

### D-02 — High — design/bug — `src/positioning/popover.ts:241,254`, `tooltip.ts:71,124`
Both presets default `container` to `document.body`. When a component lives inside a modal `<dialog>`
(`showModal()`) or any top-layer element (`[popover]:popover-open`), the body-portaled panel is
**below** the top layer and, for a modal dialog, inside the inert part of the document: it is not
clickable and is hidden behind the backdrop. A datepicker or multiselect in a modal form is a common
layout. Same for tooltips: they are hidden behind the dialog. BROWSER (top layer / inert can't be
modelled in jsdom).
- Fix: render the panel in the top layer (`popover="manual"` + `showPopover()` where supported, which
  also removes most containing-block drift). Alternatively default `container` to the reference's
  closest open `dialog` / `:popover-open` ancestor (composed walk) and fall back to body. Add an e2e
  case: a popover inside `dialog.showModal()` is clickable.

### D-03 — Medium — bug — `src/dom/adopt-styles.ts:23-27, 51-55`
`adoptedByRoot` records what *this copy* believes it adopted. It is never reconciled with
`root.adoptedStyleSheets` / the root's `<style>` children:
1. CONFIRMED: once the sheets are gone, `adoptStyles` is permanently a no-op for that root. That
   happens when a component re-renders with `shadowRoot.innerHTML = …` (fallback path), or when the
   component, a framework or the user assigns `root.adoptedStyleSheets = [mySheet]` (constructable
   path, probed with a fake `CSSStyleSheet`). The styles are lost for the root's lifetime.
2. CONFIRMED: two bundled copies of core (via `vi.resetModules()`) each adopt the same string into
   the same root. `motion.ts:58` adopts `MOTION_CSS` into the **document** from every component's
   copy, and `open-menu.ts:522` does the same with `MENU_CSS`. With 5 components that means 5
   identical document-level sheets. Each later copy re-appends, so the order of the document's
   adopted sheets keeps shifting.
- Fix: move the sheet cache to `globalThis[Symbol.for('@keenmate/web-components-core:sheets')]`,
  keyed by CSS string and, for D-19, also by document. Dedup by
  `root.adoptedStyleSheets.includes(sheet)` (constructable path) or by a marker attribute / text
  match on the `<style>` (fallback path) instead of the private WeakMap.

### D-04 — Medium — bug — `src/dom/scroll-container.ts:338-342` (+275)
`findScrollContainer` returns `null` both for "only the page scrolls" and for "hit `stopAt`".
`scrollIntoContainer` treats both as the page case and calls `el.scrollIntoView()`, which scrolls
**every** ancestor scroller, the page included. So a component that passes `stopAt: this` (as in
"only my internal scroller may move") gets the whole page moved whenever its internal list isn't
overflowing at the moment. CONFIRMED (the probe shows `scrollIntoView` is called with an
overflowing outer scroller above `stopAt`).
- Fix: when `stopAt` ended the walk, do nothing and return `null` (or have the finder return a
  distinguishable result). Add a unit test.

### D-05 — Medium — bug — `src/dom/microtask-scheduler.ts:222-227`
`drain()` copies the tasks, `tasks.clear()`s the set, then runs the copy. The first throw aborts the
loop, so the remaining tasks are gone, both from the microtask and from a later `flush()`. CONFIRMED.
BlissElement only schedules one task, but `createMicrotaskScheduler` is a public export, so a
component sharing one scheduler for several tasks silently loses work.
- Fix: run each task in try/catch, collect the errors and rethrow the first (or an
  `AggregateError`) after the loop. Alternatively put the unrun tasks back.

### D-06 — Medium — bug — `src/positioning/containing-block.ts:161` (+84-91)
`detectFixedDrift` calls `findContainingBlockCulprit(opts.reference, …)`. The element whose
containing block caused the drift is an ancestor of the **panel**; types.ts:288-290 says exactly
that ("a portaled panel has a different CB than its reference"). For a panel inside a `contain:paint`
wrapper (or portaled under one), the culprit is never found and the report says "could not
auto-identify". CONFIRMED with mocked rects.
- Fix: walk from `composedParent(panel)` first, then optionally from the reference.

### D-07 — Medium — bug — `src/positioning/tooltip.ts:93-151`
Visibility is driven only by `mouseenter`/`mouseleave`/`focusin`/`focusout` on the trigger. When the
trigger is removed from the DOM while the tooltip is shown (virtualised list, re-rendered badge,
row deletion), no leave event fires. The tooltip then stays mounted in the body forever, with
floating-ui `autoUpdate` observing a detached reference. CONFIRMED (`isVisible` and `isConnected`
stay true). Components must remember to call `destroy()` on every re-render; most bugs of this kind
show up as orphaned tooltips.
- Fix: hide when the reference is disconnected. Check `trigger.isConnected` in the anchor run
  (cheap, it runs on every autoUpdate tick) or use a `pointerleave` on the document. Add a test.

### D-08 — Medium — missing-helper / a11y — `src/positioning/tooltip.ts`
- No `id` on the tooltip and no `aria-describedby` on the trigger, so screen readers never announce
  it. `role="tooltip"` alone does nothing. CONFIRMED.
- No Escape to dismiss, which WCAG 1.4.13 requires for content shown on hover/focus. CONFIRMED.
- The pointer can't move onto the tooltip (leaving the trigger hides it): WCAG 1.4.13 "hoverable".
- `mouseleave` hides even though keyboard focus is still on the trigger. CONFIRMED.
- `focusout` between two focusable children of the trigger runs hide → show (destroy + re-anchor,
  visible flicker with delay 0).
- Touch: an emulated `mouseenter` on tap shows the tooltip, and it never hides until the next tap
  elsewhere.
- Fix: wire `aria-describedby` (generated id), close on Escape (document keydown while visible),
  keep it shown while hovered or focused (two flags), and ignore `focusout` whose `relatedTarget` is
  inside the trigger.

### D-09 — Medium — missing-helper — `src/positioning/popover.ts`
`createPopover` positions only. Outside-click, Escape, focus-return and `km-overlay-activate`
coordination (`src/overlay/active-overlay.ts`) are left to every caller. The e2e fixture
(`test/popover.html`) implements its own outside click, and `/menu` has its own
`pointerdown`-capture + Escape (`open-menu.ts:478`). Five components re-roll this; that is the
duplication core exists to remove.
- Fix: opt-in `shouldDismissOnOutsideClick` / `shouldDismissOnEscape` / `overlayGroup` options
  calling `close()` + a `closedCallback`/event; reuse the same code in `/menu`.

### D-10 — Medium — design — `src/positioning/popover.ts:185-224, 255-268`
The preset is typed `offset?: number` (anchor accepts `AnchorOffset`). It does not forward
`maxHeight`, `maxWidth`, `flipPadding`, `arrow`, `autoUpdateOptions`, `shouldUseFixedContainingBlock`,
`driftCallback`, `computedCallback`. CONFIRMED: `maxHeight: true` passed via cast produces the
middleware `['offset','flip','shift']`. The two options the module's own CLAUDE.md lists for the
dropdown case (calendar `maxHeight`, the multiselect fixed-CB heuristic) therefore force components
back onto bare `anchor()` plus hand-rolled mounting.
- Fix: `PopoverOptions extends Omit<AnchorOptions, 'inheritThemeFrom'>` + `{ reference, panel, container }`,
  and spread the rest into `anchor()`.

### D-11 — Medium — bug — `src/dom/scroll-container.ts:229, 341`
By design `overflow: hidden` never counts as a container (SPEC §12.15). But in the fallback
`el.scrollIntoView()` the browser **does** scroll `overflow:hidden` ancestors: they are
programmatically scrollable. Rounded-corner clip wrappers, carousels and `overflow:hidden` host
styles end up permanently shifted, with no scrollbar to undo it. This is the classic bug the helper
was meant to remove. BROWSER.
- Fix: in the fallback, scroll the page explicitly (compute the delta against the viewport and call
  `scrollingElement.scrollBy`) instead of `scrollIntoView`. Add an e2e row inside an
  `overflow:hidden` wrapper.

### D-12 — Low — bug — `src/positioning/containing-block.ts:69-74`
Layout (and therefore the fixed containing block) follows the flat tree, but the walk uses
`composedParent` (light parent → host). A floating element that is slotted into a component whose
shadow wrapper around the `<slot>` has `transform` misses that wrapper and returns `window`.
CONFIRMED. `scroll-container.ts:242` already has the right `flatParent` (via `assignedSlot`). The
dom CLAUDE.md even notes that containing-block "relies on" the non-flat walk. It is wrong there.
- Fix: hoist `flatParent` into `composed-tree.ts` (shared helper) and use it in
  `getFixedPositionOffsetParent` / `findContainingBlockCulprit`.

### D-13 — Low — bug — `src/positioning/containing-block.ts:63-76`
A floating element in the top layer (`[popover]:popover-open`, a modal `<dialog>`) is positioned
against the viewport whatever its ancestors' transforms are. floating-ui's own `getOffsetParent`
checks `isTopLayer`; the sugar replaces it with a walk that returns the transformed ancestor, so the
panel is offset by that ancestor's origin. BROWSER. This becomes relevant as soon as D-02 is fixed
via the top layer.
- Fix: `if (el.matches?.(':popover-open, :modal')) return window` (in try/catch, for old engines).

### D-14 — Low — bug — `src/positioning/anchor.ts:164-190`
`void computePosition(...).then(cb)` with no `.catch`. Exceptions from `placedCallback`,
`computedCallback`, `driftCallback`, `positionArrow` or a custom `platform` become unhandled promise
rejections, outside the core logger (SPEC §12.1: "no direct console"). CONFIRMED (one
`unhandledRejection` caught). `beforeComputeCallback` throws synchronously inside floating-ui's
autoUpdate listener, likewise unlogged.
- Fix: `.catch((e) => coreLog(floating, 'UI', 'POSITIONING').error(...))` and try/catch around
  `beforeComputeCallback`.

### D-15 — Low — bug — `src/positioning/tooltip.ts:86-96, 125`
`cursorRect` survives `hide()`. With `shouldFollowCursor`, a later keyboard `focusin` (or
`tip.show()`) anchors to the old pointer position, not the trigger. CONFIRMED (x=1 instead of 500).
- Fix: reset `cursorRect = undefined` in `hide()` (and only seed it from pointer events).

### D-16 — Low — bug — `tooltip.ts:174-187`, `popover.ts:280-282`
- `tooltip.destroy()` removes the listeners, but `show()` still works afterwards and mounts the
  element with nothing left to hide it. CONFIRMED. Add an `isDestroyed` guard.
- `popover.destroy() { this.close(); }`: when the handle's method is passed around detached
  (`onDestroy(pop.destroy)`, `const { destroy } = pop`), it throws `TypeError`. CONFIRMED. Use a
  closure `close` function. `popover.open()` also works after `destroy()`.

### D-17 — Low — bug — `src/positioning/anchor.ts:30-34, 133`
`inheritTheme` runs once per `anchor()` call, only sets the attribute, and only knows `data-theme`.
(a) A reused panel keeps `data-theme="dark"` after the source lost its theme. CONFIRMED.
(b) A theme flip while the panel is open is not propagated.
(c) Core's theme module (`theme.ts:70 readThemeSignal`) treats `data-bs-theme` and the `.dark` /
`.light` classes as theme signals. A Bootstrap- or Tailwind-themed page loses the theme on every
portaled layer. That is duplicated, divergent logic.
- Fix: reuse `readThemeSignal` / `resolveThemeSource`; remove the attribute when there is no theme;
  optionally re-sync in `run()`.

### D-18 — Low — bug — `src/dom/scroll-container.ts:287-290, 354-357`
The computed `scroll-padding-*` keeps percentages (`10%`), and the computed `scroll-margin` keeps
`calc()` forms in some engines. `px()` reads `10%` as 10px. CONFIRMED in jsdom, and per CSSOM the
computed value is a `<length-percentage>`, so browsers return `10%` too.
- Fix: resolve `%` against the container's `clientHeight` / `clientWidth`.

### D-19 — Low — bug — `src/dom/adopt-styles.ts:23, 58-66`
A constructed sheet can't be adopted by a different document (`NotAllowedError`). The cache shares
one sheet per CSS string across every root, so the first `adoptStyles(iframeRoot, css)` after a
main-document use throws. Because `seen.add` already ran (line 55), retries are no-ops. The
scroll-container helper explicitly supports iframes, and openMenu/motion adopt into the root the
element lives in. BROWSER.
- Fix: cache per `root.ownerDocument ?? root` and construct with that document's `CSSStyleSheet`
  (`doc.defaultView.CSSStyleSheet`). Mark the string as seen only after success.

### D-20 — Low — docs-drift — `src/dom/adopt-styles.ts:93`
"Default `'last'` (so it wins the cascade)". In a shadow root the `adoptedStyleSheets` are ordered
after all `<style>`/`<link>` sheets, so the `<style>` slot loses ties against component CSS adopted
via `adoptStyles`. It is only rescued by `@layer` (unlayered user CSS beats layered component CSS).
Also, `'last'` is only "last" at insertion time: later appended nodes move ahead of it.
- Fix: document the `@layer` dependency (SPEC §12.8 already mentions the layer order), or offer a
  constructable-sheet slot for CSS without `@import`.

### D-21 — Low — naming — `src/positioning/types.ts:324-338`, `tooltip.ts:48`, `popover.ts:219-223`
Per the house rule, a `*Callback` is a state-affecting hook whose return value matters, and events
have no suffix. `placedCallback`, `computedCallback` and `driftCallback` are pure after-the-fact
notifications, which would be `onPlaced` / `onComputed` / `onDrift`. `beforeShowCallback` /
`beforeComputeCallback` ignore their return value, while elsewhere in core `before*Callback` goes
through `runBeforeCallback` (`false` cancels). Users will expect `beforeShowCallback: () => false` to
suppress the tooltip, and it doesn't.
- Fix: rename the notifications (v2 window, no aliases per the major-release rule), or honour
  `false` from `beforeShowCallback` via `runBeforeCallbackEager`.

### D-22 — Low — bug — `src/dom/css-var-lint.ts:402, 411`
- The name class `[a-z0-9-]` misses `_` and non-ASCII (both valid in custom-property idents), which
  truncates names: `var(--ms-foo_bar)` is read as `--ms-foo`, and the declaration `--ms-foo_bar:` is
  not seen. The result is false "unused" reports or none at all. CONFIRMED.
- The regexes run over comments too: a commented-out `/* --ms-old: red */` is reported. CONFIRMED.
- The `i` flag folds case, but custom properties are case-sensitive: `--MS-Foo` is a different
  variable.
- Fix: `[\w-]|[^\x00-\x7f]`, strip `/*…*/` first, drop `i`.

### D-23 — Low — design — `src/positioning/containing-block.ts:39-62`
The narrowed heuristic drops `contain: paint|layout|strict|content` (and `container-type` size,
which implies layout containment), calling them "not reliably honoured". Current Blink, Gecko and
WebKit do make `contain: paint/layout` a fixed containing block. Inside such a wrapper the sugar
therefore guarantees mis-placement, which `driftCallback` then reports. The rationale in the
comments ("especially across shadow-DOM") should be backed by a test page, or the exclusion limited
to the case actually observed. Also missing: `content-visibility: auto` (implies paint containment).
BROWSER.

### D-24 — Low — bug — `src/positioning/containing-block.ts:88`
The drift equals the CB's **padding-box** origin, but the culprit match compares it with the
ancestor's border-box `rect.x/y` at a tolerance of `< 2`. Any culprit with a border of 2px or more
is never identified.
- Fix: add `clientLeft`/`clientTop` (or the computed border widths) before comparing.

### D-25 — Low — bug — `src/positioning/anchor.ts:183-188`
For `strategy: 'absolute'`, x/y are relative to the offset parent, but the drift check measures
against `window` (or against the fixed-CB parent). With `driftCallback` set it reports drift on
every frame.
- Fix: skip the check unless `strategy === 'fixed'`.

### D-26 — Nit — `src/dom/throttle.ts:272-288`
`Date.now()` can jump. After a backwards clock step, `ms - elapsed` exceeds `ms`, which delays the
trailing run (and leading runs) by the size of the step. Use `performance.now()`.

### D-27 — Nit — `src/positioning/anchor.ts:47`
`-${el.offsetWidth / 2}px` is used for every static side. For a left/right placement the
protrusion is half the arrow's **height**. This only matters for non-square arrows.

### D-28 — Nit — naming
Internal booleans without the is/should/has/can prefix: `flipEnabled`, `frozen`, `freeze`,
`useFixedCB` (anchor.ts:142-151), `open` (popover.ts:243), `visible` (tooltip.ts:83),
`constructableOk` (adopt-styles.ts:27). The public API is compliant (`isOpen`, `isVisible`,
`shouldFlip`, …).

### D-29 — test-gap (concrete uncovered scenarios)
Unit (jsdom):
- adopt-styles: the **constructable path is never executed** (jsdom → `<style>` fallback only). Use
  a fake `CSSStyleSheet` to cover: one sheet object shared across two roots, appending preserves
  existing `adoptedStyleSheets`, re-adopt after the list is reassigned (D-03), two module copies
  (`vi.resetModules`) (D-03). Also `createStyleSlot` on a `Document` root (goes into `<head>`).
- render-loader: nodes appended by the component after render survive `remove()` (D-01); two
  overlapping loaders (D-01); a throwing page hook; a throwing cleanup is logged; an async hook; a
  second core copy publishing after the first (accessor + Symbol state shared).
- microtask-scheduler: a throwing task doesn't drop siblings (D-05); a task scheduled during drain
  runs on the next microtask; `cancel()` then `schedule()` within the same tick.
- throttle: the trailing run fires exactly at `lastRun + ms`; `schedule()` inside `fn` (re-entrancy).
- scroll-container: `stopAt` + `scrollIntoContainer` (D-04); RTL `inline:'start'/'end'` swap in unit;
  `axis:'both'`; `%` scroll-padding (D-18); `container` option outside the element's ancestry.
- anchor: `positionArrow` output (left/top/static side after a flip) is untested, only the middleware
  presence is; `driftCallback` skipped for a virtual reference; `freeze` with `shouldFlip:false`;
  callback throws (D-14); `matchWidth:'max'`.
- containing-block: `will-change: transform`, the individual `translate`/`scale`/`rotate`,
  `perspective`, `backdrop-filter`, a walk crossing a shadow root, a slotted floating element
  (D-12), culprit search from the panel (D-06), a bordered culprit (D-24).
- tooltip: **hide delay** (only the show delay is tested); re-enter during the hide delay keeps it
  visible; focus + hover interplay (D-08); the trigger detached while visible (D-07); `destroy()`
  while visible removes the element; follow-cursor focus show (D-15); `show()` after `destroy()`
  (D-16); `content` as an element.
- popover: `container` option; default `inheritThemeFrom` = reference; forwarding of `matchWidth` /
  `offset` / `placedCallback`; re-open after `destroy()`; detached `destroy` (D-16).

e2e (browser-only behaviour, currently uncovered):
- popover / tooltip inside `dialog.showModal()`: visible above the backdrop and clickable (D-02).
- `shouldUseFixedContainingBlock` with a `transform` ancestor lands on target; `contain: paint`
  ancestor → `driftCallback` fires with the right culprit (D-06, D-23).
- `lockPlacement:'freeze'`: the panel flips once near the viewport bottom and doesn't jump back
  while scrolling.
- `matchWidth: 'min'` / `'max'`, `maxHeight` capping on a short viewport, arrow position after a
  flip.
- tooltip mounted in a `ShadowRoot` container picks up the shadow-scoped CSS; a tooltip whose
  trigger is removed (D-07); Escape (D-08).
- scroll: a row inside an `overflow:hidden` wrapper with no scroller → the wrapper must not shift
  (D-11); `stopAt` with no inner overflow leaves the page still (D-04).

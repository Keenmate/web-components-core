# `createPopover()` fit study (2026-11-06)

**Question.** The big floating panels in the components (multiselect dropdown, daterangepicker
calendar, dropzone popover, grid dropdown / datepicker / toolbar / tooltip) don't use core's
`createPopover()`. How feasible is it to move them onto it, and what does core lack?

**Method.** Read-only study of each component at its current `prod` head, one investigation per
component, with every core-side claim re-checked against `src/positioning/` and
`src/overlay/active-overlay.ts`. No component code was changed.

## Who uses what today

| Component | Panel | Positioned with |
|---|---|---|
| multiselect | dropdown, selected-items popover, hint | own `anchorFloatingPanel()` over `anchor()` |
| | fullscreen label reveal | `createPopover()` |
| daterangepicker | calendar | `anchor()` (+ modal / fullscreen / inline without anchoring) |
| | day / badge tooltip | `anchor()` (one shared element, re-anchored per cell) |
| dropzone | file-list popover | `anchor()`, `strategy: 'absolute'`, inside the shadow root |
| treeview | full-label reveal | `createPopover()` (+ its own body-scroll close) |
| web-editor | selection toolbar | `createPopover()` with a virtual reference |
| | layout panels | `anchor()` |
| web-grid | cell dropdown, datepicker, row / cell toolbar, tooltip | **`@floating-ui/dom` directly**, no core `/positioning` at all |

So `createPopover()` has three users, all small panels. Its doc comment (`popover.ts:1-9`) claims the
multiselect dropdown, the daterangepicker calendar and the grid panels; that is wrong and should be
corrected whatever comes of this study.

## What `createPopover()` is today

A thin wrapper: `open()` = append the panel to a container + `anchor()` it (+ optionally join the
overlay tree); `close()` = destroy the anchor + `panel.remove()` (+ leave the tree). "Open",
"mounted" and "anchored" are one state. Everything else (classes, ARIA, focus, scroll / resize
rules, presentation modes) is left to the component.

## Why the big panels don't fit

The three big panels share one model that is the opposite of `createPopover()`'s:

1. **The panel stays mounted.** Built once in the shadow root, shown / hidden by a class
   (`ms__dropdown--visible`, `drp__picker--visible`); listeners, virtual scroll and "is open" checks
   hang off that element. `close()` → `panel.remove()` breaks all of it.
2. **"Shown" is not "anchored".** Multiselect and daterangepicker switch the same open panel between
   floating (anchored) and fullscreen / modal (CSS-placed) via `setPresentation()`; daterangepicker
   also has an inline mode that never anchors.
3. **Closing has component rules.** Outside-press exemptions (multiselect host / hint / counter,
   dropzone's "Add more"), vetoes (daterangepicker keeps the calendar on scroll while a selection is
   staged), close-on-scroll / close-on-resize, and close-time work (revert a staged selection, flush a
   saved size).

Dropzone is the closest: it appends / removes per open already, and only needs `container` +
`strategy: 'absolute'` (both exist) plus two small additions. Grid's dropdown and datepicker are
close too; its toolbar and tooltip are `anchor()` / tooltip shapes, not popovers.

## Gaps, grouped

### A. Small, additive (no behaviour change for current users)

| # | Gap | Needed by |
|---|---|---|
| A1 | `container?: HTMLElement \| ShadowRoot` (tooltip already allows it) | grid dropdown + toolbar, daterangepicker (casts today) |
| A2 | `fallbackPlacements?: Placement[]` on `anchor()` (flip has none) | all four grid modules |
| A3 | `visibleClass` added after the first placement (no 0,0 flash), like `createTooltip()` | multiselect label reveal (rAF by hand), grid toolbar / tooltip (`visibility: hidden` by hand) |
| A4 | `shouldCloseOnScroll` (scroll outside the panel) and `shouldCloseOnResize`, each also accepting a veto function | treeview reveal (own listener), daterangepicker, grid dropdown; `openMenu()` already closes on scroll |
| A5 | an `onClose` that also fires for a programmatic `close()` (reason `'api'`) | dropzone (size flush), daterangepicker (revert staged selection) |
| A6 | `inheritThemeFrom: false` | multiselect (panels already inherit from the shadow root) |
| A7 | overlay tree: extra "inside" elements for the outside press, and a focus-return target other than `reference` | multiselect (host, hint, counter; `input` vs `inputWrapper`) |
| A8 | `shouldCloseOnEscape` / `shouldCloseOnOutsideClick` also accept a function checked at dismiss time | daterangepicker (`closesOnOutsideClick()` changes while open) |
| A9 | on close, clear the inline sizes `anchor()` wrote (`maxHeight`, `maxWidth`, `matchWidth`) | daterangepicker clears them by hand; same as the open `anchor()` matchWidth cleanup gap |

### B. Structural: decouple "open", "mounted" and "anchored"

| # | Gap | Needed by |
|---|---|---|
| B1 | keep-mounted mode: open / close toggle `visibleClass` (or `hidden`) instead of append / remove | multiselect, daterangepicker |
| B2 | open without anchoring, and switch while open (`setAnchored(bool)`): keeps the open state and the overlay registration | multiselect + daterangepicker fullscreen / modal |
| B3 | `reanchor()`: recompute a frozen (`lockPlacement: 'freeze'`) placement while open | multiselect `repositionDropdown()` after async results |
| B4 | `reference` as a getter, resolved at each open / compute | dropzone (summary line / list / satellite / button) |
| B5 | pause / resume positioning while the host is detached, panel kept | dropzone `deactivate()` / `activate()` |

### C. `anchor()` / `createTooltip()` level (not popovers)

| # | Gap | Needed by |
|---|---|---|
| C1 | a position transform hook (adjust x / y before it is written) or extra middleware | grid toolbar (cell / cursor offset) |
| C2 | position a descendant of the mounted node | grid datepicker (fixed wrapper, inner picker); or restructure the grid side |
| C3 | `createTooltip()`: delegated / imperative `show(anchor, content)`, `arrow`, HTML content, `data-placement`, an exit-transition delay before removal | grid tooltip (one shared tooltip for many anchors); daterangepicker's tooltip has the same shape |

## Verdict per panel

| Panel | Verdict |
|---|---|
| dropzone popover | **Feasible with A5 + B4** (B5 or a per-open popover covers the pause case) |
| grid dropdown | **Feasible with A1 + A2**; closing stays grid-driven |
| grid datepicker | **Feasible with A2** + moving the inner picker to be the panel (C2 on the grid side) |
| multiselect dropdown / selected popover | **Needs B1–B3 + A6 + A7**; without B, a regression |
| daterangepicker calendar | **Needs B1 + B2 + A4 + A5 + A8**; modal / fullscreen / inline keep their own code |
| grid toolbar | use **`anchor()`** (+ A2, C1), not a popover |
| grid tooltip, daterangepicker tooltip | use **`anchor()`** today; `createTooltip()` only after C3 |

## Recommendation

1. **Now, in core (additive, one rc):** A1, A2, A3, A4, A5, A6, A9, and fix the `popover.ts` doc
   comment. These are small and help current users at once (treeview drops its scroll listener,
   multiselect its rAF reveal). A7 / A8 extend `registerOverlay()` and are worth doing with them.
2. **Then, B as one design:** a popover whose state is "open" (+ overlay registration), with mounting
   and anchoring as options of that state rather than the state itself. Prototype it against the
   multiselect dropdown on a branch (in a worktree, so the multiselect session's checkout is
   untouched): if it carries multiselect (keep-mounted, fullscreen switch, freeze re-anchor), it
   carries daterangepicker and dropzone. Decide after the prototype whether the gain beats keeping
   `anchor()` + a shared option bundle.
3. **web-grid:** a separate migration onto `/positioning` (dropdown and datepicker after step 1,
   toolbar and tooltip onto `anchor()`). Today it breaks the "floating-ui only under `/positioning`"
   rule and misses theme inheritance, the overlay tree and top-layer mounting.

## Side findings (for the component sessions)

- **daterangepicker:** `viewportResizeHandler` is module-level (`date-picker-ui.ts:51`): a second open
  picker overwrites it and the first one's listener leaks. And it passes `driftCallback`, renamed to
  `onDrift` after rc15 (CHANGELOG rename table): breaks on the core upgrade.
- **web-grid:** `modules/tooltip/tooltip-service.ts` holds state only; nothing in grid `src` imports
  core `/positioning`.
- **Overlay tree focus return** happens on Escape only, and only when focus was inside the panel (or on
  `<body>`): the feared "Escape reopens a focus-triggered picker" mostly can't happen, since the
  daterangepicker keeps focus in its input.
- **Outside press** is `pointerdown`: a synthetic `click` (dropzone "Add more") never closes an overlay.

## Done on this branch (same day)

- **Group A**: A1–A9 as listed, plus the `popover.ts` doc comment and a PO01 "what is a popover"
  definition. A9 also closes the open `anchor()` matchWidth inline-size gap.
- **Group B**: `shouldKeepMounted`, `isAnchored` + `setAnchored()` + `isAnchored` getter,
  `reanchor()`, `reference` as a function. `visibleClass` was revised for it: added on open (so a
  `display: none` panel becomes measurable) with an inline `visibility: hidden` until the first
  placement (200 ms fallback if the computation fails). B4 / B5 for dropzone: B4 done (reference
  function); B5 (pause while detached) not built: a per-open popover covers it.

## Proof of concept: the multiselect dropdown on `createPopover()`

Worktree `C:\Git\KM\web-multiselect-popover-poc`, branch `poc/createpopover-dropdown` (from
multiselect `660d11d`; core linked as `file:../web-components-core`; dev port 12190 so its tests
never reuse another checkout's server). The multiselect session's checkout is untouched.

**What changed in multiselect:**
- the dropdown is a `createPopover({ shouldKeepMounted: true, visibleClass:
  'ms__dropdown--visible', isAnchored: false, inheritThemeFrom: false, overlayGroup,
  returnFocusTo: input, onClose })`, created per open (its options, e.g. lock placement, are
  read once, as the anchor's were);
- `open()` opens it unanchored (the panel shows, the first render measures it), and
  `positionDropdown()` anchors it after the render (`setAnchored(true)`): floating-ui measures
  when the anchor starts, so anchoring before the render measured a stale panel;
- fullscreen ↔ floating while open: `setAnchored(false / true)`; async results:
  `repositionDropdown()` → `reanchor()`;
- the dropdown's overlay-tree node is the popover's (`registerOverlay` / `overlayCoord` removed);
- `anchorFloatingPanel()`'s options split into `floatingPanelAnchorOptions()`, shared with the
  selected-items popover (still on `anchor()`).

**Result:** 197 unit + 484 e2e (chromium + mobile) pass, as on the baseline; two new e2e: async
results flip the open dropdown above (fails with `reanchor()` removed: mutation-checked; also
passes in Firefox) and fullscreen ↔ floating while open. Net +28 lines in `multiselect.ts`: so far
the gain is structure (core owns re-anchoring, the presentation switch and the overlay
registration lifecycle), not size.

**Still component-owned:** Escape handling, the dropdown's outside click (B7 below), the
fullscreen chrome (header, scroll lock, history entry), the hint panel (its own `anchor()`
mirroring the dropdown's placement), the selected-items popover, the width CSS variable and the
`dropdownMaxWidth` composition.

**Gaps the PoC found:**

| # | Gap | Evidence |
|---|---|---|
| B6 | options are read once at creation | multiselect creates the popover per open; workable, document it as the pattern |
| B7 | **the outside press is decided at `pointerdown`**: a control outside the panel that drives it through the API (a page "toggle" / "scroll to" button) closes it on the press, and the click then reopens or re-drives a closed panel | moving the dropdown's outside click onto core (`shouldCloseOnOutsideClick` + `getInsideElements`) failed 3 of `open-close-api.spec.ts` (toggle, scrollToIndex, open/close event counts); reverted. Multiselect's `click`-based handler survives it with a guard the API call arms during that click |
| B8 | content rendered after `open()` needs "open unanchored, anchor after render" | works with B; document it, or let `open()` take `{ isAnchored }` |

**B7 options** (a decision for the overlay tree, which `/menu`, treeview and the popovers share):
1. decide the outside press at `pointerup` / `click`, only when the press both started and ended
   outside (the browser's own popover light-dismiss works this way); an API call made during
   that click can then mark itself "inside";
2. keep `pointerdown`, and pass the event to the `shouldCloseOnOutsideClick` function so a
   component can defer to its own click guard;
3. leave outside-click with components that are driven by external controls.

**Verdict:** B carries the hardest panel without regressions. It pays off in code size once B7
is settled (multiselect could then drop its dropdown outside-click and likely its Escape
handling). Next proof: the daterangepicker calendar (modal / fullscreen / inline) or the
multiselect selected-items popover.

## B7 decided: option 1 (outside click decided when the click ends)

Built in core (`src/overlay/active-overlay.ts`): the press records, the click (on `window`,
after the page's handlers) decides; `claimCurrentClick()` on `OverlayHandle` / `PopoverHandle`;
an overlay (re)activated during the click stays open; keyboard clicks and `pointercancel`
close nothing; the rule is stored as `outsideClickRule` so an older core copy's `pointerdown`
router ignores it. `/menu` keeps its own `pointerdown` dismissal (context menus close on press).

PoC follow-up: the multiselect dropdown's outside click moved onto core
(`shouldCloseOnOutsideClick` + `getInsideElements: host, hint`), `armClickGuard()` also calls
`claimCurrentClick()`; its own dropdown branch of `handleClickOutside` (35 lines) is gone. 486/486
chromium + mobile; Firefox subset 49/49 run serially (parallel Firefox fails a different 2–7
keyboard / single-active tests per run on the untouched baseline too: pre-existing flakiness).
`multiselect.ts` against the baseline: +71 / −70.

## Recovery note (2026-11-07)

This document and the commits it describes were recreated after the local core repository was
damaged (see `C:\Git\KM\_agent-progress\core-recovery-2026-11-07.md`); the original local commit
SHAs (a27c087, f1cb4b3, d56c800, 23996cd, 93b005f, a131650) no longer exist. The multiselect PoC
now lives on branch `feat/createpopover-dropdown` in the same worktree.

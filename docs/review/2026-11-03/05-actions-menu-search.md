# Core review 2026-11-03 — slice 05: `/actions`, `/menu`, `/search`

Reviewer: cold adversarial pass. Probes: three throwaway vitest files (`src/menu/__probe-am-1`, `src/actions/__probe-am-2`, `src/search/__probe-am-3`), all run and **deleted**. No other files were touched.

Cross-bundle state: in this slice the only module-level state is `busyItems` (`src/actions/resolve.ts:157`). Everything else lives inside the `openMenu()` closure or is pure. `busyItems` is keyed by item object, and an item belongs to the component that renders it, so keeping it per bundle is harmless in practice. The bug in that guard is a different one: one guard is shared by every instance in the same bundle (A-07). Nothing in this slice has the `globalThis` problem.

## Summary

| ID | Sev | Category | Where | One line | Status |
|---|---|---|---|---|---|
| A-01 | High | bug | menu/open-menu.ts:294-307 | Sync submenu whose children all resolve hidden → `anchor()` created on a detached element after `collapseFrom`, never destroyed (autoUpdate leak) | CONFIRMED |
| A-02 | Medium | bug | menu/open-menu.ts:393-395 | `renderMenu` custom menu: Tab inside it closes the menu → a custom form with 2+ fields is unusable | CONFIRMED |
| A-03 | Medium | bug / design | menu/open-menu.ts:379-456, 475 | Document-capture keydown swallows Enter / Space / arrows / Home / End and fires item shortcuts even when focus is in an unrelated input (pinned menu, or right-click menu in an editor). Tab anywhere closes a pinned menu | CONFIRMED |
| A-04 | Medium | bug | search/highlight.ts:59-83, SPEC §12.11 | `wrapRanges` on "trusted HTML" (the documented multiselect mode) puts `<mark>` inside tags / entities; the default `escape` is the identity, so the documented `wrapRanges(r.text, r.ranges)` is an XSS sink for plain labels; core ships no escaper | CONFIRMED |
| A-05 | Medium | bug | menu/open-menu.ts:302, 414-423 | No RTL: submenu always `right-start`, → opens / ← closes regardless of `dir` | CONFIRMED |
| A-06 | Medium | bug | actions/resolve.ts:109-111 | A leading **named** divider (group heading, per types.ts:83) is dropped as a "leading divider" | CONFIRMED |
| A-07 | Medium | bug | actions/resolve.ts:157-190 | The busy guard is keyed on the item object alone: the same item shared by two component instances (same bundle) blocks the second instance while the first runs. It also has no effect for string-shorthand items, because each `normalizeActionItems` call creates a fresh object | CONFIRMED |
| A-08 | Medium | design | menu/open-menu.ts:312-321 | No hover intent / safe triangle: hovering a sibling on the way to a submenu collapses it at once | CONFIRMED |
| A-09 | Low | bug | menu/open-menu.ts:356-371 | Keep-open refresh that leaves the root with 0 items keeps an empty menu box open (submenus collapse in that case, root does not) | CONFIRMED |
| A-10 | Low | bug | menu/open-menu.ts:441-449, 379 | Two menus open at once (pinned / different groups) both handle one keydown (`stopPropagation` ≠ `stopImmediatePropagation`): one Escape closes both, arrows move both | CONFIRMED |
| A-11 | Low | bug | search/match.ts:3-14 | Word-boundary test is per UTF-16 unit and excludes `\p{M}`: false word starts after astral letters (`𝐀de` matches word-starts-with `de`) and after combining / Indic marks (`नमस्ते` word-starts-with `ते`) | CONFIRMED |
| A-12 | Low | bug | search/match.ts:65-72 | `findRegexMatches` without `u` splits surrogate pairs (`/./` on `a😀b` → 4 ranges, mark between halves) | CONFIRMED |
| A-13 | Low | design | search/normalize.ts:21-29 | `normalized` strips every `\p{M}`: it removes Indic matras / viramas (`किताब` == `कतब`) and kana dakuten (`が` == `か`). It does not fold compatibility forms (`ﬁ`, full-width `ＡＢＣ`), NBSP vs space, or `ŧ þ ĳ ŀ` | CONFIRMED |
| A-14 | Low | bug | search/normalize.ts:23 | `case-insensitive` uses `toLowerCase` rather than case folding: `İstanbul` does not match `istanbul`, `Straße` does not match `STRASSE` | CONFIRMED |
| A-15 | Low | bug | menu/open-menu.ts:348-355 | Close-on-click item: `runAction`'s promise is ignored → a rejection is an unhandled rejection; `runAction()` itself rejects when `emitAction` throws | CONFIRMED |
| A-16 | Low | bug | menu/open-menu.ts:501-518 | A throwing `closeCallback` propagates out of `handle.close()` / the pointerdown / overlay listeners (state is already torn down, but the caller crashes) | CONFIRMED |
| A-17 | Low | bug | actions/resolve.ts:192,214 | `runAction` removes a pre-existing `aria-busy` from the trigger (clobbers component state) | CONFIRMED |
| A-18 | Low | design | actions/resolve.ts:194-195 | `beforeActionCallback` non-false return values are silently ignored; the generic before-callback contract says a value "replaces". This is undocumented for actions | CONFIRMED |
| A-19 | Low | design | actions/resolve.ts:186 | `runAction` doesn't check `isDisabled`; every caller must (menu does, toolbars/keyboard shortcuts may not) | CONFIRMED |
| A-20 | Low | missing-helper / duplication | menu/open-menu.ts:131-134 | "Is this item a toggle?" is recomputed in the menu (calls `defaults` a second time per item); `ResolvedActionItem` has no `isToggle`, so every toolbar renderer (aria-pressed) re-derives it | code-read |
| A-21 | Nit | design | menu/open-menu.ts:255-258 | Disabled items are skipped by arrow keys (APG recommends focusable-but-inert); Enter/Space with nothing focused are consumed doing nothing | code-read |
| A-22 | Nit | a11y | menu/open-menu.ts:90-98,185-191 | No accessible name for root/submenus (no `aria-label` option, no `aria-labelledby` owner / `aria-controls`); loading row is `role=none` with no `aria-busy` on the level | code-read |
| A-23 | Nit | naming | menu/types.ts:47,54,60,65-67; search/term.ts:53 | `closeCallback` and `objectTermCallback` are notifications that carry the `*Callback` suffix. `renderItem` / `renderMenu` / `defaults` / `prepareItem` are hooks without the suffix, while core's own `renderLoadingCallback` has it. `loadingText` predates the `labels` unification | code-read |
| A-24 | Nit | docs-drift | actions/index.ts:4, resolve.ts:176, types.ts:22 | Actions cite "SPEC §12.11" (that's Search); actions are §12.12 | code-read |
| A-25 | Nit | robustness | actions/resolve.ts:87,107 | A `null` entry in an items array throws `Cannot read properties of null` inside resolve | CONFIRMED |
| A-26 | Nit | design | search/term.ts:42-47, 81-82 | First invalid regex → `none` → every item matches; regex pattern is trimmed (`' foo$'` → `foo$`) — both intended per tests, but surprising | CONFIRMED (intended) |
| A-27 | — | test-gap | see list | Uncovered scenarios that would have caught A-01…A-17 | — |

---

## Findings

### A-01 — High — bug — submenu anchor leak (`src/menu/open-menu.ts:294-307`)
`openSubmenu` calls `fillLevel(level, onFilled)` **before** assigning `level.position = anchor(...)`. For a sync source, `onFilled(0)` runs at once and calls `collapseFrom(index)`. That pops the level and removes its element, but `level.position` is still `null` at that point, so there is nothing to destroy. Execution then returns and `anchor(level.el, owner, …)` is created for the detached element. Nothing references it after that: `close()` iterates `chain`, which no longer contains the level.
**Scenario:** `{ text: 'Recent', children: recent.map(r => ({…, getIsVisibleCallback: () => r.exists })) }` with every child hidden (also `children: [menuDivider()]`). Every hover over "Recent" leaks one `autoUpdate`: ancestor scroll/resize listeners, a ResizeObserver, and possibly an rAF loop. All of these retain the element and the owner.
**Probe:** levels=1, anchors=2, the submenu element is disconnected, and `destroy` was called 0 times after `close()`.
**Fix:** create the anchor before `fillLevel`, or have `collapseFrom` and `fillLevel` check `chain.includes(level)` before calling `anchor()`. Better still, resolve the children synchronously first and skip opening when nothing is visible. That would also stop the `aria-expanded="true"` flicker.

### A-02 — Medium — bug — Tab closes a custom menu (`open-menu.ts:389-395`)
The `Tab` → `close('tab')` branch runs before the `isCustom` branch, for any Tab anywhere on the document. `renderMenu` exists so a consumer can render "full custom content", and that commonly includes inputs (a rename box, a filter, a colour picker).
**Probe:** a menu rendered with `<input id=i1><input id=i2>`, focus `i1`, press Tab → the menu closes.
**Fix:** for `isCustom`, close on Tab only when focus would leave the root element. Check on `focusout` with `relatedTarget` outside the chain, or do it on the next tick.

### A-03 — Medium — bug/design — keyboard-modal even when focus is elsewhere (`open-menu.ts:379-456`)
The capture keydown on `document` handles keys regardless of where focus is. If focus is outside every level and not on the opener (for example a menu opened from a right-click inside a contenteditable, or `shouldCloseOnOutsideInteraction:false` with the user typing in a form field):
- `Enter`, `Space`, `ArrowLeft`, `Home` and `End` are `preventDefault`ed and stopped. The probe found all five consumed, with nothing focused for Enter and Space, so they do nothing.
- A single-letter `shortcut` fires. Typing `d` in an unrelated input ran the "Delete" item.
- Tab anywhere closes a pinned menu.

In web-editor's right-click menu, pressing Enter or Space in the text while the menu is visible is silently eaten.
**Fix:** consume and act only when focus is inside a level, on `returnFocusTo`, or on `document.body`. When focus is elsewhere, either let keys through or close the menu (reason `'blur'`). As a minimum, don't `preventDefault` Enter/Space when no item is focused.

### A-04 — Medium — bug — `wrapRanges` HTML handling (`src/search/highlight.ts:59-83`, SPEC §12.11)
Two related problems.
1. **Trusted-HTML mode is broken.** The SPEC says multiselect "renders trusted display HTML unescaped". `findHighlightRanges` matches the markup text itself. Probe results:
   - `Tom &amp; Jerry` with term `amp` gives `Tom &<mark>amp</mark>; Jerry`, which breaks the entity.
   - `<b class="x">class</b>` gives `<b <mark>class</mark>="x">`, which breaks the tag. A term like `onerror` or `src` lands inside attributes in the same way.
2. **The default is unsafe.** `escape` defaults to identity. The JSDoc example `wrapRanges(r.text, r.ranges)` applied to a plain-text label `<img src=x onerror=alert(1)>Bob` returns the tag live, so it executes when assigned to `innerHTML`.

Core exports no HTML escaper. The e2e fixture brings its own.
**Fix:** export `escapeHtml` from `/search` (or `/dom`) and make it the default `escape`. Require an explicit `escape: (s) => s` to opt out. For HTML labels, highlight on `textContent` and wrap text nodes in the DOM, for example a `highlightTextNodes(el, term, opts)` helper, instead of splicing into a markup string.

### A-05 — Medium — bug — no RTL (`open-menu.ts:302, 414-423`)
In RTL, a submenu should open to the left and the arrow keys should swap. The code has no `dir` handling anywhere in `src/menu` or `src/positioning`. Probe with `dir=rtl` on `<html>` and the host: ArrowLeft did nothing, ArrowRight opened the submenu, and placement was `right-start`.
**Fix:** read `getComputedStyle(owner).direction` (or `owner.closest('[dir]')`). In RTL use `left-start` and swap the ArrowLeft / ArrowRight handling.

### A-06 — Medium — bug — leading group heading dropped (`src/actions/resolve.ts:109-111`)
`types.ts:83` documents a labelled divider as "a group heading". `resolveMenuEntries` drops any divider while `out` is empty, labelled or not. So `[menuDivider('Recent files'), …items]` renders no heading, and the probe found 0 dividers. The same happens when every item above a heading is hidden.
**Fix:** drop only *unlabelled* leading dividers. A labelled one stays as a heading. The trailing trim can stay as it is.

### A-07 — Medium — bug — busy guard scope (`src/actions/resolve.ts:157-190`)
`busyItems` is keyed on the item object, for the whole bundle.
- **Shared items:** a consumer passes the same `toolbarItems` constant to two grids. While grid A's async `beforeActionCallback` is pending, grid B's click on "Save" returns `false` and is ignored. Probe: B's `runAction` returned false and `emitAction` was called 0 times.
- **Behaviour depends on bundling:** the same two components *are* independent when they ship separate core copies.
- **String shorthand:** `normalizeActionItems(['add'])` creates a new object on every call. A component that re-normalizes per render (or per click) gets no busy protection at all. Probe: `a === b` is false. The plan (`interaction-model-plan.md:408`) caches synthetic items per trigger for exactly this reason. Shorthand needs the same treatment.

**Fix:** key the guard on `(triggerElement ?? detail.element, item)`. One way is a WeakMap from `detail.element` to a WeakSet of items. Alternatively, document that items must not be shared and have `normalizeActionItems` memoize the expanded objects per source array.

### A-08 — Medium — design — no submenu hover intent (`open-menu.ts:312-321`)
`onItemEnter` on a sibling calls `openSubmenu` immediately, which runs `collapseFrom(depth+1)`. Moving diagonally from "A ▸" towards its submenu crosses "B ▸", and A's submenu is replaced at once. Probe: after entering A then B, `a1` is gone and `b1` is shown. `SUBMENU_HIDE_DELAY` only delays the leave case.
**Fix:** while a child level is open, delay opening a sibling's submenu (about 100–150 ms) and cancel the timer if the pointer enters the open child level. Or use a safe-triangle test on `pointermove`.

### A-09 — Low — bug — empty root after keep-open refresh (`open-menu.ts:356-371`)
When the refresh hides every root item (for example a "Show hidden" toggle that hides itself, or "Clear recent"), `fillLevel(level, …)` renders 0 items and the root stays open as an empty box. Probe: `isOpen` true, 0 items. Submenus close themselves in this case; the root does not.
**Fix:** in `refresh`, if the count is 0 and the level is the root, call `close('action')`.

### A-10 — Low — bug — two open menus share one keydown (`open-menu.ts:446-455`)
Each menu adds its own capture listener on `document`. `stopPropagation()` doesn't stop other listeners on the same node. With two pinned menus, or menus in different `overlayGroup`s, one Escape closed both (probe) and arrows move focus in both. Pinned menus (`shouldCloseOnOutsideInteraction:false`) also skip `registerOverlay` entirely, so they neither close other overlays nor get closed by them.
**Fix:** use `stopImmediatePropagation()`, or keep a single shared, topmost-wins keydown router (state on `globalThis[Symbol.for('km-menu-stack')]` so it works across bundles).

### A-11 — Low — bug — word boundaries (`src/search/match.ts:3-14`)
`text[index-1]` is one UTF-16 unit, and `WORD_CHAR` is `[\p{L}\p{N}]`.
- `𝐀de`: the preceding unit is a low surrogate, which is not `\p{L}`, so it counts as a word start. The probe matched `de` in `𝐀bc 𝐀de` at [7,9].
- In `exact` / `case-insensitive` mode, combining and Indic marks break words. `नमस्ते` with word-starts-with `ते` matched [4,6] after the virama. `q̃x` gave a false start at `x`.

**Fix:** read the previous *code point* (step back over a surrogate pair), and use `[\p{L}\p{N}\p{M}]` as the word class. The SPEC text needs the same update.

### A-12 — Low — bug — regex highlight splits surrogates (`src/search/match.ts:65-72`)
Typed patterns are compiled with no flags (`term.ts:28`), so the `u` flag is never set. `/./` on `a😀b` gives `[[0,1],[1,2],[2,3],[3,4]]`, and the wrapped output places `</mark><mark>` between the two halves of the emoji, which renders as two U+FFFD.
**Fix:** in `findRegexMatches`, snap range boundaries outward off a lone surrogate. Or compile typed patterns with `u` where they parse (this changes the semantics of `\-`-style escapes, so it needs a decision).

### A-13 — Low — design — `normalized` fold coverage (`src/search/normalize.ts`)
Stripping all `\p{M}` goes well beyond "diacritics". Probe results:
- Devanagari loses its vowel signs: `किताब` == `कतब`, so the search conflates different words. The same applies to Thai and similar scripts.
- `が` == `か`.
- The compatibility forms are not folded, because NFD is not NFKD: `ﬁle` does not match `file`, `ＡＢＣ` does not match `abc`.
- NBSP vs space: `New York` written with an NBSP does not match `new york`.
- `ŧ`, `þ`, `ĳ` and `ŀ` are left unfolded.

**Fix:** strip only `\p{Mn}` within Latin/Greek/Cyrillic bases (or only the U+0300–036F block), and apply NFKC before NFD. Map `\s` (including NBSP) to a single space on both sides. Add `ŧ→t`, `þ→th`. This is a behaviour change, so it needs a multiselect e2e check (CLAUDE.md invariant).

### A-14 — Low — bug — case-insensitive is lowercase, not fold (`normalize.ts:23`)
`'İstanbul'.toLowerCase()` gives `i̇stanbul` (with U+0307), so a typed `istanbul` doesn't match (probe: false). `Straße` vs `STRASSE` is also false. In `normalized` mode both work because marks are stripped and `ß→ss` is folded.
**Fix:** in `case-insensitive` mode, after lowercasing, delete a U+0307 that follows `i`, and map `ß→ss` (Unicode full case folding). Alternatively, document the limitation.

### A-15 — Low — bug — rejected `runAction` (`open-menu.ts:348-355`; `actions/resolve.ts:210`)
For a close-on-click item, the value `opts.runAction` returns is dropped. A rejection becomes an unhandled rejection (probe: 1). Core `runAction` rejects whenever `emitAction` throws, which happens when a consumer's `onAction` twin throws, unless `emit()` catches it.
**Fix:** in the menu, `Promise.resolve(result).catch(log)`. In `runAction`, wrap `emitAction` in the same log-and-continue try/catch used for `onClick` and the built-in.

### A-16 — Low — bug — throwing `closeCallback` (`open-menu.ts:517`)
The `closeCallback` call is not guarded. When it throws, the exception propagates out of `handle.close()` (probe: threw). From the pointerdown, overlay or keydown paths, it propagates out of a document listener. Teardown has already completed by then, so the menu itself is consistent.
**Fix:** wrap it in try/catch and log through `coreLog(host,'UI','MENU')`.

### A-17 — Low — bug — aria-busy clobbered (`actions/resolve.ts:192,214`)
`finally` removes `aria-busy` from the trigger without checking its previous state. If the trigger was already busy for another reason, such as a component's own loading state, `runAction` clears it (probe: the attribute went from `true` to `null`).
**Fix:** remember the previous value and restore it.

### A-18 — Low — design — before-callback value ignored (`actions/resolve.ts:194`)
The generic `runBeforeCallback` contract says "any other value — continue with that value". `runAction` only checks `isRejected`, so a returned modified detail is discarded silently (probe: the emitted action was still `a`). Neither SPEC §12.12 nor the JSDoc says so.
**Fix:** document that "only `false` matters" for `beforeActionCallback`, or define what a returned value replaces.

### A-19 — Low — design — `runAction` ignores `isDisabled`
A disabled item passed in still runs (probe: emitted 1). The menu guards against this itself. Keyboard-shortcut and toolbar surfaces in components must each remember to check.
**Fix:** take an optional `resolved` in `RunActionOptions` and return `false` when it is disabled. Or at least document the caller's responsibility.

### A-20 — Low — missing-helper/duplication (`open-menu.ts:131-134`)
The toggle-ness test (`isToggled !== undefined || getIsToggledCallback || defaults().isToggled !== undefined`) lives only in the menu and calls `opts.defaults(item)` a second time per item. A button renderer needs the same answer to decide whether to emit `aria-pressed`.
**Fix:** add `isToggle: boolean` to `ResolvedActionItem` (computed in `resolveActionItem`) and use it in the menu.

### A-21 — Nit — design (`open-menu.ts:255-258, 431-433`)
Disabled items can't be reached with the keyboard, which goes against the APG menu pattern ("disabled menu items are focusable but cannot be activated"), so screen-reader users never learn they exist. Enter/Space with no focused item are consumed (see A-03).

### A-22 — Nit — a11y (`open-menu.ts:90-98, 185-191`)
- There is no `ariaLabel` option for the root.
- Submenus have no `aria-labelledby` pointing to the owner item's id, and the owner has no `aria-controls`.
- The loading row (`role="none"`) leaves a `role="menu"` with zero menuitems and no `aria-busy="true"`.

### A-23 — Nit — naming (house rule: `*Callback` = state-affecting hook; events/notifications no suffix; booleans is/should/has/can)
- `closeCallback(reason)` (menu/types.ts:47) is a pure notification, so it would be `onClose` under the rule.
- `objectTermCallback` (search/term.ts:53) is a notification ("the component warns").
- `renderItem`, `renderMenu`, `prepareItem` and `defaults` are hooks without the suffix, while core's own `renderLoadingCallback` has it.
- `loadingText` vs the planned single `labels` (i18n unification).

The booleans all comply (`isOpen`, `hasChildren`, `shouldCloseOnClick`, `shouldFocusFirst`, `shouldCloseOnOutsideInteraction`).

### A-24 — Nit — docs-drift
`src/actions/index.ts:4`, `src/actions/resolve.ts:176` and `src/actions/types.ts:22` cite "SPEC §12.11". §12.11 is Search; Actions is §12.12. CLAUDE.md and SPEC use §12.12.

### A-25 — Nit — robustness (`actions/resolve.ts:87,107`)
A `null` or `undefined` hole in an items array (a common result of `cond && item`) throws a TypeError in `resolveActionItem`. Skip falsy entries in `normalizeActionItems` and `resolveMenuEntries`.

### A-26 — Nit — design (`search/term.ts`)
These are intended per the unit tests but worth a conscious decision:
- The first invalid typed regex returns `none`, so everything matches while the user types `(`.
- Regex patterns are trimmed, so a meaningful leading or trailing space in a pattern is lost.

### A-27 — Test gaps (concrete scenarios)
Unit (`src/menu/menu.test.ts`):
- Submenu whose children are all hidden: no leaked anchor, `aria-expanded` back to false (A-01). The current listener-count test misses this because the leak is an anchor, not a listener.
- `renderMenu` with focusable content: Tab inside the menu keeps it open (A-02).
- Focus in an unrelated input: Enter, Space and arrows are not consumed and shortcuts don't fire (A-03).
- RTL arrow keys and placement (A-05).
- Hover-intent crossing a sibling (A-08).
- Keep-open refresh that empties the root (A-09).
- Two concurrent menus and Escape (A-10).
- Throwing / rejecting `runAction` and a throwing `closeCallback` (A-15, A-16).
- Re-opening while open in the same `overlayGroup`: the old handle's `closeCallback('overlay')` fires before the new handle returns.
- Keep-open item inside a lazy submenu: re-fetch and loading flash.
- Lazy submenu resolving after the pointer moved to a sibling (stale token).
- Shortcut that opens a submenu; ancestor-level shortcut from inside a submenu.
- Disabled-with-children item: no submenu on hover, click or →.
- `inheritThemeFrom` passed to both levels.
- Scroll inside a long submenu does not close the menu.

Unit (`src/actions/resolve.test.ts`):
- Leading labelled divider kept (A-06); labelled-then-unlabelled divider merge.
- Shared item across two instances (A-07).
- `emitAction` throwing (A-15); pre-existing `aria-busy` (A-17).
- `getMenuChildren` returning `undefined` / `null`.
- Null entries (A-25).
- `isActionBusy` true during a pending `onClick` (only the before-callback phase is covered).

Unit (`src/search/*.test.ts`):
- Astral-letter and combining-mark word boundaries (A-11).
- Regex highlight on astral text (A-12).
- Turkish `İ` and `ß` in case-insensitive mode (A-14).
- NBSP and ligatures (A-13).
- `wrapRanges` default on markup-bearing text (A-04).
- `findHighlightRanges` with `equals` / `ends-with` on labels with trailing combining marks.
- `word-starts-with` term that starts with punctuation (`-b` in `a-b` → no match today).

e2e:
- `menu.spec.ts` has no RTL, nested hover-intent, custom `renderMenu`, or shadow-DOM opener focus-return case.
- `search.spec.ts` doesn't cover highlight on HTML labels.
- `actions.spec.ts` doesn't cover two instances sharing an item.

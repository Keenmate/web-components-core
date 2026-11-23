## Keyboard navigation (`src/a11y/`, subpath `/a11y`, SPEC §12.25 — implemented)

`active-descendant.ts`: keydown on the input; `apply(next, list, isForced)` sets `aria-activedescendant`,
ids via `createId` (`shouldHandleKeys: false` = no keydown listener, ARIA + scroll only), scrolls via `scrollIntoContainer` into the listbox / its nearest scroller only (no page
scroll); `refresh()` re-finds by element, then id, else clears (forced). Sets `aria-controls` and
`tabindex="-1"` on the listbox (not when input === listbox: a tree body keeps focus itself) (Chromium: a scroller without focusable children is a tab stop).
`roving-focus.ts`: keydown + focusin on the container; `focus({ preventScroll })` + `scrollIntoContainer` (gate `shouldScroll`); `seek()` walks inside a bound (a grid row for Left /
Right), only ±1 steps wrap; RTL via `isRtl(container)` per key. `typeahead.ts`: buffer + timestamp, repeated
letter cycles from the next item. Both helpers ignore `defaultPrevented` events (component keys first) and
call component callbacks through `runSafely`. jsdom has no layout: the unit test skips scrolling; the e2e
(`a11y.spec.ts`) checks real Tab order, shadow-root active descendant and list scrolling.

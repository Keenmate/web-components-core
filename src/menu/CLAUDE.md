## Menu (`src/menu/`, SPEC §12.13 — implemented)

`openMenu(entries, ctx, opts)` renders `/actions` menu entries and owns submenus,
positioning (`/positioning` `anchor()` only — never import `@floating-ui/dom` here),
dismiss and the WAI-ARIA keyboard. Open levels form a chain (root → submenu → …, one
open child per level); `collapseFrom(depth)` closes the tail and refocuses the owner if
focus was inside. Keyboard = one capture `keydown` on `document` while open (works with
focus in the menu or still on the opener; handled keys are consumed). Dismiss listeners
(pointerdown / blur / `registerOverlay` + the shared `watchScrollClose()` scroll rule from
`src/positioning/scroll-close.ts`, the same as `createPopover()` — no bare wheel; a point menu's reference is the deepest
element under the point inside the host, so a component's own inner scroller closes it too) attach synchronously at open
and are all removed in `close()` — keep add/remove balanced (a test counts them). A leaf
closes BEFORE `runAction` (focus is back on the opener when the action runs); keep-open
items refresh their level after the returned promise settles. Items are `div`s, not
buttons (no native Space-on-keyup click). A toggle item (defines `isToggled` /
`getIsToggledCallback` / a `defaults` `isToggled`) is `menuitemcheckbox` +
`aria-checked`. Tests mock `../positioning/anchor.js` (jsdom has no layout).

**Phone sheet / drawer** (`presentation: 'auto' | 'floating' | 'sheet' | 'drawer'`, default
`'auto'` → `classifyDevice()` + `presentationMap` over `DEFAULT_MENU_PRESENTATION_MAP`; SPEC §12.13;
`isSheet` is fixed at open, `presentation` may flip sheet ⇄ drawer via `applySheetKind()` while an
`'auto'` menu is open — a flip to / from floating closes with `'presentation'`. The drawer is CSS
on the same DOM: `--drawer` + physical `--left` / `--right`. Close removal is deferred for the
`--closing` animation, `removeSheetAnimated()`; levels inside the sheet leave with it): no `anchor()`, a `.km-menu-sheet` dialog (header title +
close — the shared `createSheetHeader()` / `SHEET_CHROME_CSS`, `src/overlay/sheet-chrome.ts`) over a `.km-menu-sheet-backdrop`, levels inside it with only the deepest shown (`syncSheet()`
— call it whenever the chain changes); drilled-in levels get a Back row (`backRows`, part of
`enabledItems()` but not of `records` — guard `records.get()` with `?.`). Hover never opens a
submenu there. Backdrop closes on `click`, not `pointerdown`; no scroll close; `lockBodyScroll()`
+ one history entry (core `claimBackEntry()`, `src/overlay/back-entry.ts`) per open sheet, both undone in `close()` via
`endSheetSession`. Tests: `sheet.test.ts` (mocks `getEnvironment`), e2e `menu-sheet.spec.ts`.

Consumers: web-treeview, web-editor, web-grid (cell + header menus; built-in submenus via
`prepareItemCallback`). All three map their `--<prefix>-context-menu-*` onto `--_km-menu-*`.

**CSS variables — three layers** (`styles.ts`, every value via the `km()` helper):
`var(--_km-menu-X, var(--km-menu-X, var(--base-…, <default>)))`. `--_km-menu-*` is
private: the consuming component sets it on its host from its own per-instance
variable with **no fallback** (`--_km-menu-bg: var(--wtv-context-menu-bg)`), and must
leave that component variable unset by default. `--km-menu-*` is the page-wide public
layer (`:root`) — components must never set it (a host-level mapping shadows the page
value when the component variable is unset). Adding / removing a variable: update
`component-variables.manifest.json` at the repo root (shipped; `styles.test.ts` fails
on drift) and SPEC §12.13.

## Menu (`src/menu/`, SPEC §12.13 — implemented)

`openMenu(entries, ctx, opts)` renders `/actions` menu entries and owns submenus,
positioning (`/positioning` `anchor()` only — never import `@floating-ui/dom` here),
dismiss and the WAI-ARIA keyboard. Open levels form a chain (root → submenu → …, one
open child per level); `collapseFrom(depth)` closes the tail and refocuses the owner if
focus was inside. Keyboard = one capture `keydown` on `document` while open (works with
focus in the menu or still on the opener; handled keys are consumed). Dismiss listeners
(pointerdown / blur / `registerOverlay` + the shared `watchScrollClose()` scroll rule from
`src/positioning/scroll-close.ts`, the same as `createPopover()` — no bare wheel) attach synchronously at open
and are all removed in `close()` — keep add/remove balanced (a test counts them). A leaf
closes BEFORE `runAction` (focus is back on the opener when the action runs); keep-open
items refresh their level after the returned promise settles. Items are `div`s, not
buttons (no native Space-on-keyup click). A toggle item (defines `isToggled` /
`getIsToggledCallback` / a `defaults` `isToggled`) is `menuitemcheckbox` +
`aria-checked`. Tests mock `../positioning/anchor.js` (jsdom has no layout).

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

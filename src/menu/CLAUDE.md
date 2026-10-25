## Menu (`src/menu/`, SPEC §12.13 — implemented)

`openMenu(entries, ctx, opts)` renders `/actions` menu entries and owns submenus,
positioning (`/positioning` `anchor()` only — never import `@floating-ui/dom` here),
dismiss and the WAI-ARIA keyboard. Open levels form a chain (root → submenu → …, one
open child per level); `collapseFrom(depth)` closes the tail and refocuses the owner if
focus was inside. Keyboard = one capture `keydown` on `document` while open (works with
focus in the menu or still on the opener; handled keys are consumed). Dismiss listeners
(pointerdown / scroll / wheel / blur + `registerOverlay`) attach synchronously at open
and are all removed in `close()` — keep add/remove balanced (a test counts them). A leaf
closes BEFORE `runAction` (focus is back on the opener when the action runs); keep-open
items refresh their level after the returned promise settles. Items are `div`s, not
buttons (no native Space-on-keyup click). Tests mock `../positioning/anchor.js` (jsdom
has no layout).

Consumers: web-treeview (adopted). Pending: web-grid (`modules/contextmenu`: toggle class
via `cssClass`, `prepareItem` for built-in submenus, its shadow scroll subscription calls
`close()`), web-editor (`ui/context-menu.ts`, CommandBar menu variant).

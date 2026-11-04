# Accessibility — @keenmate/web-components-core

Core is a library: the accessible behaviour of a picker, a tree or a grid is that component's
contract (its own `docs/accessibility.md`). This file covers what core itself renders or
coordinates, which every component that uses it inherits.

## Keyboard navigation

**Menu (`/menu`, `openMenu()`)** — the WAI-ARIA menu pattern:

| Key | Does |
|---|---|
| ↓ / ↑ | next / previous enabled item, wrapping; disabled items are skipped |
| Home / End | first / last enabled item |
| → | opens the focused item's submenu and focuses its first item (← in a right-to-left menu) |
| ← | closes the submenu and returns focus to the item that owns it (→ in RTL) |
| Enter / Space | activates the focused item, or opens its submenu; nothing on a disabled item |
| Escape | closes the deepest submenu; on the top level closes the menu |
| Tab | closes the menu; focus returns to the opener and the browser moves it on |
| an item's shortcut | a letter (case-insensitive) or a key name such as `F2` activates that item — the current level first, then its ancestors |

A custom menu body (`renderMenuCallback`) keeps Tab for its own fields; only Escape closes it.

**Overlays (popovers, menus, a component's panels)** — every overlay that joins the page-wide
overlay tree (`shouldCloseOnEscape`) closes on Escape one level at a time: only the deepest open
overlay closes per press, across every copy of core on the page. A pointer press outside closes
the overlays above the one pressed in (`shouldCloseOnOutsideClick`).

**Tooltip (`createTooltip()`)** — shows on keyboard focus of the trigger as well as on hover,
and Escape hides it without moving the pointer or focus (WCAG 1.4.13).

## ARIA roles & states

- **Menu** — `role="menu"` on each level, `role="menuitem"` (or `menuitemcheckbox` with
  `aria-checked` for a toggle item), `role="separator"` for a divider, `aria-disabled="true"` on
  a disabled item, `aria-haspopup="menu"` + `aria-expanded` on an item with a submenu, the
  owning item's text as the submenu's `aria-label`, and `aria-busy="true"` while lazy children
  load. Icons are `aria-hidden`.
- **Tooltip** — the bubble has `role="tooltip"`; while it is shown its id is added to the
  trigger's `aria-describedby` (existing ids kept) and removed on hide.
- **Loader (`renderLoader()`)** — the container gets `role="status"` and the component's
  `aria-label` while loading; its previous `role` / `aria-label` are restored afterwards.

## Focus management

- **Menu** — `returnFocusTo` (else the element or point it was opened from) gets focus back
  when the menu closes while it held focus; `shouldFocusFirst` focuses the first item (opened
  from the keyboard). Closing a submenu returns focus to its owning item.
- **Overlay tree** — an overlay closed by Escape or an outside press returns focus to its
  trigger when focus was inside it; `createPopover({ shouldCloseOnEscape })` returns focus to
  the reference.
- **Scroll lock** — `lockBodyScroll()` (fullscreen sheets) is shared and ref-counted across
  components, pins the body in place and pads for the removed scrollbar, so the page behind a
  sheet neither scrolls nor shifts.
- **Soft keyboard** — `observeKeyboardInset(panel)` keeps a fullscreen sheet above the on-screen
  keyboard.

## Forms and disabled state

A form-associated `BlissElement` follows the native rules: a disabled ancestor `<fieldset>`
disables it (`formDisabledCallback`), `this.isEffectivelyDisabled` combines that with its own
reflected `isDisabled` input, and the constraint-validation API (`setFormatError()`) makes
`:invalid` and the browser's validation messages work. See
[usage.md → `BlissElement`](usage.md#blisselement--the-base-class) and SPEC §6.4 / §6.6.

## Motion

The motion level (`motion`, `data-motion`, `window.components.motion`) never overrides the OS:
under `prefers-reduced-motion: reduce` core's motion CSS zeroes the shared `--base-duration-*`
tokens and sets `--base-scroll-behavior: auto` on the root, every host and every `[data-motion]`
element, whatever level the page or the component asks for. See
[usage.md → Motion level](usage.md#motion-level-none--snappy--smooth).

## Contrast & visual

Core draws one visible surface of its own, the menu. Its colours come from the page's
`--base-*` theme (or the built-in light / dark defaults), with hover / focus and danger states;
see [theming.md](theming.md). Every other visual is the component's.

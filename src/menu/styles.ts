/**
 * The shared menu stylesheet (SPEC §12.13), adopted into the menu's host root
 * via `adoptStyles` (§12.8).
 *
 * Every value reads three layers, highest precedence first:
 *
 * ```css
 * var(--_km-menu-bg, var(--km-menu-bg, var(--base-dropdown-bg, <default>)))
 * ```
 *
 * 1. `--_km-menu-*` — PRIVATE, set only by the component that renders the menu,
 *    mapping its own per-instance variable with NO fallback
 *    (`:host { --_km-menu-bg: var(--wtv-context-menu-bg); }`). When the
 *    component variable is unset the private one is guaranteed-invalid, so the
 *    lookup falls through.
 * 2. `--km-menu-*` — PUBLIC, page-wide (`:root { --km-menu-bg: … }` themes every
 *    menu). Components never set these themselves — doing so would shadow the
 *    page-level value on their host.
 * 3. `--base-*` theme tokens, then the literal default.
 *
 * The variable list is documented in `component-variables.manifest.json` at the
 * package root (a unit test keeps it in sync with this file).
 *
 * In `@layer component`, so a component's `overrides` layer and unlayered
 * consumer CSS win over it.
 */

/** `var(--_km-menu-<name>, var(--km-menu-<name>[, <fallback>]))` — the 3-layer read. */
function km(name: string, fallback?: string): string {
  const pub = fallback === undefined ? `var(--km-menu-${name})` : `var(--km-menu-${name}, ${fallback})`;
  return `var(--_km-menu-${name}, ${pub})`;
}

const BORDER_COLOR = 'var(--base-border-color, light-dark(#e0e0e0, #3d3d3d))';
const MUTED_TEXT = 'var(--base-text-color-3, light-dark(#707070, #a3a3a3))';
const ITEM_GAP = km('item-gap', '8px');
const ITEM_PADDING = km('item-padding', '6px 12px');
const DISABLED_OPACITY = km('disabled-opacity', 'var(--base-disabled-opacity, 0.5)');
const DANGER_COLOR = km('danger-color', 'var(--base-danger-color, light-dark(#d13438, #f87c86))');
const DIVIDER_COLOR = km('divider-color', BORDER_COLOR);

export const MENU_CSS = `
@layer component {
.km-menu {
  position: fixed;
  z-index: ${km('z-index', '10000')};
  box-sizing: border-box;
  min-width: ${km('min-width', '160px')};
  max-width: ${km('max-width', 'none')};
  overflow-y: auto;
  padding: ${km('padding', '4px 0')};
  background: ${km('bg', 'var(--base-dropdown-bg, var(--base-elevated-bg, var(--base-main-bg, light-dark(#ffffff, #2b2b2b))))')};
  border: ${km('border', `var(--base-dropdown-border, 1px solid ${BORDER_COLOR})`)};
  border-radius: ${km('border-radius', '4px')};
  box-shadow: ${km('shadow', 'var(--base-dropdown-box-shadow, 0 8px 16px rgba(0, 0, 0, 0.15))')};
  color: ${km('text-color', 'var(--base-text-color-1, light-dark(#242424, #f5f5f5))')};
  font-family: ${km('font-family', 'var(--base-font-family, inherit)')};
  font-size: ${km('font-size', '14px')};
  line-height: ${km('line-height', 'var(--base-line-height-normal, 1.5)')};
  outline: none;
}

.km-menu__item {
  display: flex;
  align-items: center;
  gap: ${ITEM_GAP};
  padding: ${ITEM_PADDING};
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  outline: none;
}

.km-menu__item:hover,
.km-menu__item:focus,
.km-menu__item[aria-expanded="true"] {
  background: ${km('hover-bg', 'var(--base-hover-bg, color-mix(in srgb, currentColor 8%, transparent))')};
}

/* Hover text colour: zero specificity, so the danger / toggled colours keep
   theirs; unset (the default) leaves the colour unchanged (inherited). */
:where(.km-menu__item:not(.km-menu__item--disabled)):where(:hover, :focus, [aria-expanded="true"]) {
  color: ${km('hover-color')};
}

.km-menu__item--disabled {
  opacity: ${DISABLED_OPACITY};
  cursor: not-allowed;
}

.km-menu__item--disabled:hover,
.km-menu__item--disabled:focus {
  background: transparent;
}

.km-menu__item--danger {
  color: ${DANGER_COLOR};
}

.km-menu__item--danger:hover,
.km-menu__item--danger:focus {
  background: ${km('danger-hover-bg', `var(--base-danger-bg-subtle, color-mix(in srgb, ${DANGER_COLOR} 10%, transparent))`)};
}

.km-menu__item--toggled {
  color: ${km('toggled-color', 'var(--base-accent-color, #0078d4)')};
}

.km-menu__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: ${km('icon-size', '16px')};
  font-size: ${km('icon-font-size', 'inherit')};
}

.km-menu__label {
  flex: 1 1 auto;
  min-width: 0;
}

.km-menu__shortcut {
  flex-shrink: 0;
  margin-left: auto;
  padding-left: ${ITEM_GAP};
  color: ${km('shortcut-color', MUTED_TEXT)};
  font-size: ${km('shortcut-font-size', '0.9em')};
}

.km-menu__item--has-submenu::after {
  content: ${km('submenu-arrow', '"\\25B8"')};
  flex-shrink: 0;
  margin-left: auto;
  padding-left: ${ITEM_GAP};
  font-size: ${km('arrow-font-size', '0.8em')};
  opacity: 0.6;
}

.km-menu__divider {
  height: 1px;
  margin: ${km('divider-margin', '4px 0')};
  background: ${DIVIDER_COLOR};
}

.km-menu__divider--named {
  display: flex;
  align-items: center;
  gap: ${ITEM_GAP};
  height: auto;
  padding: ${km('divider-label-padding', '0 12px')};
  background: none;
  color: ${km('divider-label-color', MUTED_TEXT)};
  font-size: ${km('divider-label-font-size', '0.8em')};
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.km-menu__divider--named::before,
.km-menu__divider--named::after {
  content: "";
  flex: 1;
  height: 1px;
  background: ${DIVIDER_COLOR};
}

.km-menu__loading {
  padding: ${ITEM_PADDING};
  opacity: ${DISABLED_OPACITY};
  font-style: italic;
}
}
`;

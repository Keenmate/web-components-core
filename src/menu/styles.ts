/**
 * The shared menu stylesheet (SPEC §12.13), adopted into the menu's host root
 * via `adoptStyles` (§12.8). Every value reads a `--km-menu-*` custom
 * property that falls back to the `--base-*` design tokens; a component maps
 * its own variables onto `--km-menu-*` on its host (`:host { --km-menu-bg:
 * var(--wtv-context-menu-bg); }`) and they inherit into the menu.
 *
 * In `@layer component`, so a component's `overrides` layer and unlayered
 * consumer CSS win over it.
 */
export const MENU_CSS = `
@layer component {
.km-menu {
  position: fixed;
  z-index: var(--km-menu-z-index, 10000);
  box-sizing: border-box;
  min-width: var(--km-menu-min-width, 160px);
  max-width: var(--km-menu-max-width, none);
  overflow-y: auto;
  padding: var(--km-menu-padding, 4px 0);
  background: var(--km-menu-bg, var(--base-dropdown-bg, var(--base-elevated-bg, var(--base-main-bg, light-dark(#ffffff, #2b2b2b)))));
  border: var(--km-menu-border, var(--base-dropdown-border, 1px solid var(--base-border-color, light-dark(#e0e0e0, #3d3d3d))));
  border-radius: var(--km-menu-border-radius, 4px);
  box-shadow: var(--km-menu-shadow, var(--base-dropdown-box-shadow, 0 2px 8px rgba(0, 0, 0, 0.15)));
  color: var(--km-menu-text-color, var(--base-text-color-1, light-dark(#242424, #f5f5f5)));
  font-family: var(--km-menu-font-family, var(--base-font-family, inherit));
  font-size: var(--km-menu-font-size, 14px);
  line-height: var(--km-menu-line-height, var(--base-line-height-normal, 1.5));
  outline: none;
}

.km-menu__item {
  display: flex;
  align-items: center;
  gap: var(--km-menu-item-gap, 8px);
  padding: var(--km-menu-item-padding, 6px 12px);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  outline: none;
  color: inherit;
}

.km-menu__item:hover,
.km-menu__item:focus,
.km-menu__item[aria-expanded="true"] {
  background: var(--km-menu-hover-bg, var(--base-hover-bg, color-mix(in srgb, currentColor 8%, transparent)));
}

.km-menu__item--disabled {
  opacity: var(--km-menu-disabled-opacity, var(--base-disabled-opacity, 0.5));
  cursor: not-allowed;
}

.km-menu__item--disabled:hover,
.km-menu__item--disabled:focus {
  background: transparent;
}

.km-menu__item--danger {
  color: var(--km-menu-danger-color, var(--base-danger-color, light-dark(#d13438, #f87c86)));
}

.km-menu__item--danger:hover,
.km-menu__item--danger:focus {
  background: var(--km-menu-danger-hover-bg, color-mix(in srgb, var(--km-menu-danger-color, var(--base-danger-color, #d13438)) 10%, transparent));
}

.km-menu__item--toggled {
  color: var(--km-menu-toggled-color, var(--base-accent-color, #0078d4));
}

.km-menu__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: var(--km-menu-icon-size, 16px);
  font-size: var(--km-menu-icon-font-size, inherit);
}

.km-menu__label {
  flex: 1 1 auto;
  min-width: 0;
}

.km-menu__shortcut {
  flex-shrink: 0;
  margin-left: auto;
  padding-left: var(--km-menu-item-gap, 8px);
  color: var(--km-menu-shortcut-color, var(--base-text-color-3, light-dark(#707070, #a3a3a3)));
  font-size: var(--km-menu-shortcut-font-size, 0.9em);
}

.km-menu__item--has-submenu::after {
  content: var(--km-menu-submenu-arrow, "\\25B8");
  flex-shrink: 0;
  margin-left: auto;
  padding-left: var(--km-menu-item-gap, 8px);
  font-size: var(--km-menu-arrow-font-size, 0.8em);
  opacity: 0.6;
}

.km-menu__divider {
  height: 1px;
  margin: var(--km-menu-divider-margin, 4px 0);
  background: var(--km-menu-divider-color, var(--base-border-color, light-dark(#e0e0e0, #3d3d3d)));
}

.km-menu__divider--named {
  display: flex;
  align-items: center;
  gap: var(--km-menu-item-gap, 8px);
  height: auto;
  padding: var(--km-menu-divider-label-padding, 0 12px);
  background: none;
  color: var(--km-menu-divider-label-color, var(--base-text-color-3, light-dark(#707070, #a3a3a3)));
  font-size: var(--km-menu-divider-label-font-size, 0.8em);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.km-menu__divider--named::before,
.km-menu__divider--named::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--km-menu-divider-color, var(--base-border-color, light-dark(#e0e0e0, #3d3d3d)));
}

.km-menu__loading {
  padding: var(--km-menu-item-padding, 6px 12px);
  opacity: var(--km-menu-disabled-opacity, var(--base-disabled-opacity, 0.5));
  font-style: italic;
}
}
`;

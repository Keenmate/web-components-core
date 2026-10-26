/**
 * The shared menu stylesheet (SPEC §12.13), adopted into the menu's host root
 * via `adoptStyles` (§12.8). Every value reads a `--bliss-menu-*` custom
 * property that falls back to the `--base-*` design tokens; a component maps
 * its own variables onto `--bliss-menu-*` on its host (`:host { --bliss-menu-bg:
 * var(--wtv-context-menu-bg); }`) and they inherit into the menu.
 *
 * In `@layer component`, so a component's `overrides` layer and unlayered
 * consumer CSS win over it.
 */
export const MENU_CSS = `
@layer component {
.bliss-menu {
  position: fixed;
  z-index: var(--bliss-menu-z-index, 10000);
  box-sizing: border-box;
  min-width: var(--bliss-menu-min-width, 160px);
  max-width: var(--bliss-menu-max-width, none);
  overflow-y: auto;
  padding: var(--bliss-menu-padding, 4px 0);
  background: var(--bliss-menu-bg, var(--base-dropdown-bg, var(--base-elevated-bg, var(--base-main-bg, light-dark(#ffffff, #2b2b2b)))));
  border: var(--bliss-menu-border, var(--base-dropdown-border, 1px solid var(--base-border-color, light-dark(#e0e0e0, #3d3d3d))));
  border-radius: var(--bliss-menu-border-radius, 4px);
  box-shadow: var(--bliss-menu-shadow, var(--base-dropdown-box-shadow, 0 2px 8px rgba(0, 0, 0, 0.15)));
  color: var(--bliss-menu-text-color, var(--base-text-color-1, light-dark(#242424, #f5f5f5)));
  font-family: var(--bliss-menu-font-family, var(--base-font-family, inherit));
  font-size: var(--bliss-menu-font-size, 14px);
  line-height: var(--bliss-menu-line-height, var(--base-line-height-normal, 1.5));
  outline: none;
}

.bliss-menu__item {
  display: flex;
  align-items: center;
  gap: var(--bliss-menu-item-gap, 8px);
  padding: var(--bliss-menu-item-padding, 6px 12px);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  outline: none;
  color: inherit;
}

.bliss-menu__item:hover,
.bliss-menu__item:focus,
.bliss-menu__item[aria-expanded="true"] {
  background: var(--bliss-menu-hover-bg, var(--base-hover-bg, color-mix(in srgb, currentColor 8%, transparent)));
}

.bliss-menu__item--disabled {
  opacity: var(--bliss-menu-disabled-opacity, var(--base-disabled-opacity, 0.5));
  cursor: not-allowed;
}

.bliss-menu__item--disabled:hover,
.bliss-menu__item--disabled:focus {
  background: transparent;
}

.bliss-menu__item--danger {
  color: var(--bliss-menu-danger-color, var(--base-danger-color, light-dark(#d13438, #f87c86)));
}

.bliss-menu__item--danger:hover,
.bliss-menu__item--danger:focus {
  background: var(--bliss-menu-danger-hover-bg, color-mix(in srgb, var(--bliss-menu-danger-color, var(--base-danger-color, #d13438)) 10%, transparent));
}

.bliss-menu__item--toggled {
  color: var(--bliss-menu-toggled-color, var(--base-accent-color, #0078d4));
}

.bliss-menu__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: var(--bliss-menu-icon-size, 16px);
  font-size: var(--bliss-menu-icon-font-size, inherit);
}

.bliss-menu__label {
  flex: 1 1 auto;
  min-width: 0;
}

.bliss-menu__shortcut {
  flex-shrink: 0;
  margin-left: auto;
  padding-left: var(--bliss-menu-item-gap, 8px);
  color: var(--bliss-menu-shortcut-color, var(--base-text-color-3, light-dark(#707070, #a3a3a3)));
  font-size: var(--bliss-menu-shortcut-font-size, 0.9em);
}

.bliss-menu__item--has-submenu::after {
  content: var(--bliss-menu-submenu-arrow, "\\25B8");
  flex-shrink: 0;
  margin-left: auto;
  padding-left: var(--bliss-menu-item-gap, 8px);
  font-size: var(--bliss-menu-arrow-font-size, 0.8em);
  opacity: 0.6;
}

.bliss-menu__divider {
  height: 1px;
  margin: var(--bliss-menu-divider-margin, 4px 0);
  background: var(--bliss-menu-divider-color, var(--base-border-color, light-dark(#e0e0e0, #3d3d3d)));
}

.bliss-menu__divider--named {
  display: flex;
  align-items: center;
  gap: var(--bliss-menu-item-gap, 8px);
  height: auto;
  padding: var(--bliss-menu-divider-label-padding, 0 12px);
  background: none;
  color: var(--bliss-menu-divider-label-color, var(--base-text-color-3, light-dark(#707070, #a3a3a3)));
  font-size: var(--bliss-menu-divider-label-font-size, 0.8em);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.bliss-menu__divider--named::before,
.bliss-menu__divider--named::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--bliss-menu-divider-color, var(--base-border-color, light-dark(#e0e0e0, #3d3d3d)));
}

.bliss-menu__loading {
  padding: var(--bliss-menu-item-padding, 6px 12px);
  opacity: var(--bliss-menu-disabled-opacity, var(--base-disabled-opacity, 0.5));
  font-style: italic;
}
}
`;

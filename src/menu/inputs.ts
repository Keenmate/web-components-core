/**
 * The standard menu-host inputs (SPEC §12.13): every component that opens `openMenu()` menus
 * (web-treeview, web-grid, web-editor …) spreads these rows into its `static inputs`, so
 * `menu-presentation` / `menu-side` mean the same everywhere and reach the responsive rules
 * (§6.7), the per-tag settings and the page-wide layer for free.
 *
 * ```ts
 * static inputs = [...OWN_INPUTS, ...createMenuPresentationInputs()];
 * // at open:
 * openMenu(entries, ctx, { ...getMenuPresentationOptions(this.config), labels: { back, close } });
 * ```
 */
import { toEnum } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';
import type { MenuDrawerSide, MenuPresentation } from './types.js';

export const MENU_PRESENTATIONS = ['auto', 'floating', 'sheet', 'drawer'] as const satisfies readonly MenuPresentation[];
export const MENU_DRAWER_SIDES = ['start', 'end'] as const satisfies readonly MenuDrawerSide[];

/** The `menuPresentation` + `menuSide` input rows (read when a menu opens: `on: 'none'`). */
export function createMenuPresentationInputs(): InputDef[] {
  return [
    {
      configKey: 'menuPresentation',
      attribute: 'menu-presentation',
      converter: toEnum(MENU_PRESENTATIONS, { default: 'auto' }),
      default: 'auto',
      on: 'none',
      description:
        "How the component's context / dropdown menus open: 'auto' (default — a bottom sheet on a phone, the floating menu elsewhere), 'floating', 'sheet' (bottom sheet) or 'drawer' (full-height side panel on `menu-side`). Per device / width through the responsive rules.",
    },
    {
      configKey: 'menuSide',
      attribute: 'menu-side',
      converter: toEnum(MENU_DRAWER_SIDES, { default: 'start' }),
      default: 'start',
      on: 'none',
      description: "The edge a 'drawer' menu slides in from: 'start' (default — left in LTR, right in RTL) or 'end'.",
    },
  ];
}

/** `{ presentation, side }` for `openMenu()` from a host's config (the effective one, `this.config`). */
export function getMenuPresentationOptions(config: Readonly<Record<string, unknown>>): {
  presentation: MenuPresentation;
  side: MenuDrawerSide;
} {
  return {
    presentation: (config.menuPresentation as MenuPresentation | undefined) ?? 'auto',
    side: (config.menuSide as MenuDrawerSide | undefined) ?? 'start',
  };
}

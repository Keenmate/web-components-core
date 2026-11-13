/**
 * `@keenmate/web-components-core/menu` — the shared context / dropdown menu
 * (SPEC §12.13): renders core `/actions` menu entries, submenus (lazy too),
 * positioning through `/positioning`, outside-interaction dismiss and the
 * WAI-ARIA menu keyboard model. A separate subpath: it pulls in
 * `/positioning` (and so `@floating-ui/dom`).
 */
export { openMenu, DEFAULT_MENU_PRESENTATION_MAP } from './open-menu.js';
export { MENU_CSS } from './styles.js';
export { menuPresentationInputs, menuPresentationOptions, MENU_PRESENTATIONS, MENU_DRAWER_SIDES } from './inputs.js';
export type { MenuCloseReason, MenuHandle, MenuInvocation, MenuLabels, MenuPoint, MenuPresentation, MenuPresentationMap, MenuDrawerSide, ResolvedMenuPresentation, OpenMenuOptions } from './types.js';

/**
 * `@keenmate/web-components-core/menu` — the shared context / dropdown menu
 * (SPEC §12.13): renders core `/actions` menu entries, submenus (lazy too),
 * positioning through `/positioning`, outside-interaction dismiss and the
 * WAI-ARIA menu keyboard model. A separate subpath: it pulls in
 * `/positioning` (and so `@floating-ui/dom`).
 */
export { openMenu } from './open-menu.js';
export { MENU_CSS } from './styles.js';
export type { MenuCloseReason, MenuHandle, MenuInvocation, MenuLabels, MenuPoint, OpenMenuOptions } from './types.js';

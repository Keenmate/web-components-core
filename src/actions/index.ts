/**
 * `@keenmate/web-components-core/actions` — the shared model for clickable
 * items (action buttons, toolbars, context / header menus) and the `action`
 * event they fire (SPEC §12.12).
 */
export type {
  ActionEventDetail,
  ActionInvocation,
  ActionItem,
  ActionSource,
  MenuDivider,
  MenuEntry,
  MenuItem,
  ResolvedActionItem,
} from './types.js';
export {
  createMenuDivider,
  getMenuChildren,
  isActionBusy,
  isMenuDivider,
  normalizeActionItems,
  readActionDataset,
  resolveActionItem,
  resolveMenuEntries,
  runAction,
} from './resolve.js';
export type { ResolvedMenuEntry, RunActionOptions } from './resolve.js';
export type { ComponentContext } from '../element/context.js';

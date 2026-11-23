/**
 * Keyboard navigation and focus for composite widgets (SPEC §12.25): active descendant, roving focus,
 * type-to-find, and the focus trap a modal uses (`startModalSession` in the main index wraps it, SPEC §12.19).
 * The shortcut guard `isTypingTarget` is in `/actions`; `isImeEnter` / `announce` / `deepActiveElement` in the main index.
 */
export { createActiveDescendant } from './active-descendant.js';
export type { ActiveDescendant, ActiveDescendantOptions } from './active-descendant.js';
export { createRovingFocus } from './roving-focus.js';
export type { RovingFocus, RovingFocusOptions, RovingOrientation } from './roving-focus.js';
export { createTypeahead, isPrintableKey, TYPEAHEAD_TIMEOUT_MS } from './typeahead.js';
export type { Typeahead } from './typeahead.js';
// The trap alone: inert background + Tab cycling + focus in / back; tabbables in flat-tree order.
export { createFocusTrap, getTabbables } from '../dom/focus-trap.js';
export type { FocusTrap, FocusTrapOptions } from '../dom/focus-trap.js';

/** Keyboard navigation for composite widgets (SPEC §12.25): active descendant, roving focus, type-to-find. */
export { createActiveDescendant } from './active-descendant.js';
export type { ActiveDescendant, ActiveDescendantOptions } from './active-descendant.js';
export { createRovingFocus } from './roving-focus.js';
export type { RovingFocus, RovingFocusOptions, RovingOrientation } from './roving-focus.js';
export { createTypeahead, isPrintableKey, TYPEAHEAD_TIMEOUT_MS } from './typeahead.js';
export type { Typeahead } from './typeahead.js';

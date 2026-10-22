/**
 * `@keenmate/web-components-core/search` — built-in search primitives (SPEC §12.11):
 * normalization (`search-behavior`), matching (`search-match`), term preparation and
 * highlight mapping, plus the `searchCallback` context types every component shares.
 * Pure and DOM-free; per-item caching and the search flow stay in the component.
 * A separate subpath so components without a search box don't pull it.
 */
export { normalizeSearchText } from './normalize.js';
export { findTextMatches, matchesText, findRegexMatches, statelessRegex } from './match.js';
export { NO_SEARCH_TERM, createRegexCompiler, prepareSearchTerm, matchesSearchTerm } from './term.js';
export type { RegexCompiler, PrepareSearchTermOptions } from './term.js';
export { findHighlightRanges, wrapRanges } from './highlight.js';
export type { WrapRangesOptions } from './highlight.js';
export type {
  SearchBehavior,
  SearchMatch,
  SearchTermContext,
  PreparedSearchTerm,
  SearchEntry,
  SearchCallbackContext,
  ActiveSearchTerm,
  SearchRange,
  HighlightResult,
} from './types.js';

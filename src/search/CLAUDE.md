## Search (`src/search/`, SPEC §12.11 — implemented)

`@keenmate/web-components-core/search`: pure, DOM-free built-in search rules, moved from
web-multiselect 2.6.0-rc02 (`docs/search-migration-plan.md`). Two axes — `SearchBehavior`
(normalization, applied to item values AND the term) and `SearchMatch` (where) — plus
`prepareSearchTerm` → `ActiveSearchTerm`, `matchesSearchTerm`, and `findHighlightRanges` →
`{ text, ranges }` + `wrapRanges`.

Invariants (multiselect's e2e suite depends on them — a change here is a behaviour change there):

- `regex` = raw value, no flags, no normalization; an invalid typed pattern reuses the
  instance's last valid one (`createRegexCompiler`, one per component instance). Regex range
  boundaries inside a surrogate pair widen to the whole character (no split emoji).
- A `getSearchTermCallback` string is used as-is, never normalized again.
- Highlight ranges index into the RETURNED text (NFC for text terms), not the input.
- Word char = `[\p{L}\p{N}\p{M}]` per code point (astral letters and combining marks are part
  of a word); text matches are non-overlapping.
- One fold routine (`foldWithSourceMap`) backs both `normalizeSearchText` and highlighting,
  so the two never disagree. `normalized` strips only diacritics on Latin / Greek / Cyrillic
  letters (Indic vowel signs, kana dakuten are kept); `case-insensitive` folds `ß` → `ss`, `İ` → `i`.
- `wrapRanges` escapes HTML by default; trusted-HTML labels go through `highlightHtml`.
- No per-item cache here (component-owned) until a second component needs it.

Tests use `\u` escapes for decomposed text so editors can't silently normalize fixtures.

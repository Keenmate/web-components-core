# Plan — move search primitives from web-multiselect into core (`/search`)

Status: **Phase 1 in progress** (2026-10-22; decisions in §6 settled). Source: web-multiselect 2.6.0-rc02, which shipped the search
model below as a component-local module. Goal: one implementation of search normalization,
matching and highlight mapping, so web-treeview (and later grid / dropzone filters) don't
re-implement it, and `search-behavior` / `search-match` mean the same thing in every Keenmate
component.

---

## 1. What exists today (web-multiselect 2.6.0-rc02)

**`web-multiselect/src/search.ts`** — pure, DOM-free, already standalone:

| Export | Does |
|---|---|
| `normalizeSearchText(text, behavior = 'normalized')` | `exact`: NFC. `case-insensitive`: NFC + lowercase (+ `ς`→`σ`). `normalized`: NFD, strip `\p{M}`, lowercase, hand-fold `ł ø đ ð ħ ı ß→ss æ→ae œ→oe ς→σ`. Public export of the package. |
| `findTextMatches(text, term, match)` | `[start, end)` ranges for `contains` / `equals` / `starts-with` / `ends-with` / `word-starts-with` / `word-ends-with` (word char = `[\p{L}\p{N}]`), non-overlapping. Not for `regex`. |
| `matchesText(text, term, match)` | Boolean twin of the above, early-exit for the simple modes. |
| `findRegexMatches(text, re)` | Non-empty match ranges via a `g` clone. |
| `statelessRegex(re)` | Strip `g` / `y` so `.test()` isn't lastIndex-stateful. |

**Inside `web-multiselect/src/multiselect.ts`** (class `WebMultiSelect`):

- *Generic logic embedded in the class* (candidates to extract):
  - `prepareSearchTerm(term, useCallback)` + `compileSearchRegex(pattern)` → an
    `ActiveSearchTerm` = `{kind:'none'} | {kind:'text', text} | {kind:'regex', re}`; default =
    trim + normalize, or compile for `regex`; invalid pattern reuses `lastValidSearchRegex`.
  - `matchesSearchTerm(item, term)` → regex tests the **raw** string, text tests the
    **prepared** string per `search-match`.
  - `highlightMatch(text)` → the fiddly part: NFC the label, fold **per code point** with
    `normalizeSearchText`, keep `start[]` / `end[]` maps from folded index → original index,
    run `findTextMatches` on the folded string, map ranges back (extending over trailing chars
    that folded to nothing, e.g. combining marks), then wrap in `<mark>`. Regex terms use
    `findRegexMatches` on the display text directly.
- *Component lifecycle* (stays in the component):
  - per-option caches `rawSearchValues` / `preparedSearchValues` / `searchEntries`, keyed by
    item identity; `getRawSearchValue`, `getSearchString` (object → display value + one-time
    warning), `getPreparedSearchValue`, `getSearchEntries`, `invalidateSearchValues`
    (options replaced, `refresh()`, member/callback change);
  - `activeTerm` / `activeTermFor` / `currentSearchTerm()` (re-derive when `searchTerm`
    changed outside `handleSearch`);
  - `handleSearch` flow, `beforeSearchCallback`, `getSearchTermCallback` (target
    `'internal' | 'callback'`), `searchCallback(term, signal, { searchTerm, entries })`,
    live re-run in `updateOptions` for `searchBehavior` / `searchMatch` / `getSearchTermCallback`.

**Types** (`web-multiselect/src/types.ts`): `SearchBehavior`, `SearchMatch`,
`SearchTermContext`, `PreparedSearchTerm`, `SearchEntry<T>`, `SearchCallbackContext<T>`.

**Tests**: `web-multiselect/e2e/search.spec.ts` (+ fixture `test/search.html`) cover every mode,
word boundaries, NFD data, highlight of accented text, regex raw/invalid, live switch, the
part-number `getSearchTermCallback`, `context.entries` identity, object fallback warning, and
"prepared once" (2000 items → 2000 `getSearchValueCallback` calls over 5 keystrokes).
**There are no unit tests for `src/search.ts` itself** — they get written in core (step 2.4).

**Docs**: `web-multiselect/docs/usage.md` "How search works", `release-notes/2.6.0-rc02.md`,
examples BU07 / BU08 (`examples-basic.html`), ES04 (`examples-external-search.html`).

---

## 2. Phase 1 — core: new `@keenmate/web-components-core/search` module

Separate subpath (like `/positioning`) so components that don't search don't pull it. No
runtime dependencies.

### 2.1 Files

```
src/search/
  index.ts        public surface (re-exports below)
  types.ts        SearchBehavior, SearchMatch, PreparedSearchTerm, SearchTermContext,
                  SearchEntry<T>, SearchCallbackContext<T>, ActiveSearchTerm
  normalize.ts    normalizeSearchText (+ FOLD_EXTRA)
  match.ts        findTextMatches, matchesText, findRegexMatches, statelessRegex
  term.ts         prepareSearchTerm (pure) + createRegexCompiler (keeps last valid)
  highlight.ts    findHighlightRanges, wrapRanges
  *.test.ts       next to each file (vitest, jsdom)
```

### 2.2 API (proposed)

```ts
// normalize.ts / match.ts — moved verbatim from web-multiselect/src/search.ts
normalizeSearchText(text: string, behavior?: SearchBehavior): string
findTextMatches(text: string, term: string, match: SearchMatch): Array<[number, number]>
matchesText(text: string, term: string, match: SearchMatch): boolean
findRegexMatches(text: string, re: RegExp): Array<[number, number]>
statelessRegex(re: RegExp): RegExp

// term.ts — the default term preparation, lifted out of WebMultiSelect.prepareSearchTerm
type ActiveSearchTerm = { kind: 'none' } | { kind: 'text'; text: string } | { kind: 'regex'; re: RegExp };
createRegexCompiler(): { compile(pattern: string): RegExp | null; reset(): void }   // keeps last valid
prepareSearchTerm(term: string, opts: {
  behavior: SearchBehavior; match: SearchMatch;
  regex: ReturnType<typeof createRegexCompiler>;
  prepare?: (term: string) => PreparedSearchTerm;   // a consumer getSearchTermCallback, already bound
  onObjectTerm?: () => void;                         // component warns once
}): ActiveSearchTerm
matchesSearchTerm(term: ActiveSearchTerm, match: SearchMatch,
                  prepared: string | (() => string), raw: string | (() => string)): boolean
  // values may be lazy: a regex term never computes `prepared`, a text term never `raw`

// highlight.ts — lifted out of WebMultiSelect.highlightMatch
findHighlightRanges(text: string, term: ActiveSearchTerm,
                    opts: { behavior: SearchBehavior; match: SearchMatch }): HighlightResult
  // HighlightResult = { text: string; ranges: Array<[number, number]> } — ranges index into
  // the RETURNED text (NFC for text terms), never into the input
wrapRanges(text: string, ranges: Array<[number, number]>,
           opts?: { open?: string; close?: string; escape?: (s: string) => string }): string
```

Notes:
- `findHighlightRanges` returns **ranges**, not HTML. Escaping is the caller's call:
  multiselect currently injects the display value unescaped (pre-existing behaviour — display
  values may carry HTML), treeview may want escaping. `wrapRanges` takes an optional `escape`
  applied to the unmarked and marked slices.
- The NFC question (decided: return `{ text, ranges }`): highlight NFC-normalizes the label
  before mapping, so the ranges refer to the NFC string. An NFD label `Zlín` (5 units) is
  `Zlín` (4 units) in NFC; ranges-only `[[0, 3]]` applied to the original would cut before the
  combining accent (`<mark>Zli</mark>́n`). Returning the pair makes it impossible to wrap
  the wrong string.

### 2.3 Wiring

- `package.json` `exports`: add `"./search": { "types": "./dist/search/index.d.ts", "import": "./dist/search/index.js" }`.
- Explicit `.js` extensions on relative imports; `import type` for types (`verbatimModuleSyntax`).
- Not re-exported from the root entry (keeps the base graph small), same as `/positioning`.

### 2.4 Tests (new — none exist yet)

- `normalize.test.ts`: each behavior on `Český`, `Müller`, `Łódź`, `Straße`→`strasse`,
  `ΟΔΟΣ` (final sigma), composed vs decomposed `č` equal in every mode.
- `match.test.ts`: every mode incl. `equals`; word boundaries with punctuation / digits
  (`HA-324`, `Old Town`, `Townsend`); multiple occurrences; non-overlap; empty term.
- `term.test.ts`: trim, empty → none, regex compile, invalid pattern keeps last valid, `reset()`,
  `prepare` returning string / RegExp (stateless) / object (→ none + `onObjectTerm`) / `null`.
- `highlight.test.ts`: `ces` on `Český Krumlov` → `Čes`; NFD input; `ß` expansion (`ss` term
  marks the single `ß`); word modes mark only word starts/ends; regex ranges; zero-length
  regex matches skipped; `wrapRanges` with and without `escape`.

### 2.5 Docs + release

- `docs/SPEC.md`: new **§12.11 Search (normalization, matching, highlight) — IMPLEMENTED
  (`src/search/`)**: the two axes (`search-behavior` = normalization, `search-match` = where),
  regex = raw value (no normalization), internal vs own-search split, the `searchCallback`
  context convention (`{ searchTerm, entries }`, entries lazy + identity-stable), why ranges
  not HTML.
- `CHANGELOG.md` + `README.md` (module list), version **1.0.0-rc14**, build, publish (`--tag rc`).

---

## 3. Phase 2 — web-multiselect consumes core

1. Bump `@keenmate/web-components-core` to `1.0.0-rc14`.
2. Delete `src/search.ts`; import from `@keenmate/web-components-core/search`.
3. `WebMultiSelect`:
   - `prepareSearchTerm` / `compileSearchRegex` → core `prepareSearchTerm` + one
     `createRegexCompiler()` per instance (replaces `lastValidSearchRegex`; `reset()` where it is
     nulled today in `updateOptions`).
   - `matchesSearchTerm` → core `matchesSearchTerm(term, match, () => getPreparedSearchValue(item), () => getSearchString(item))`.
   - `highlightMatch` → `wrapRanges(..., findHighlightRanges(...))`, no escape (preserve today's
     behaviour).
   - Caches, `currentSearchTerm`, `handleSearch`, `searchCallback` context stay as they are.
4. `src/types.ts`: re-export the search types from core (`export type { SearchBehavior, … } from
   '@keenmate/web-components-core/search'`) so the package's public types are unchanged.
5. `src/index.ts`: `normalizeSearchText` re-exported from core — public API unchanged.
6. Gate: `npm run test:unit`, `npm run test:e2e` (chromium + mobile), and
   `npx playwright test e2e/search.spec.ts --project=firefox --project=webkit --workers=2`.
   No spec changes expected — if one is needed, the move changed behaviour.
7. Check bundle size (`dist/multiselect.js` ≈ 412 kB at 2.6.0-rc02) — should be flat.
8. CHANGELOG `### Internal`: "search primitives moved to core `/search`; no API change".

---

## 4. Phase 3 — web-treeview (separate plan, after Phase 2; breaking for treeview)

Finding (2026-10-22, web-treeview `e965237`): web-treeview does **not** have the
`searchCallback` model — it inherited svelte-treeview's built-in FlexSearch index:

- `flexsearch ^0.8.212` is a runtime `dependency`, bundled (`vite` `external: []`,
  `dist/web-treeview.js` ≈ 486 kB).
- `src/ltree/flex.ts` builds `FlexSearch.Index({ tokenize: 'full', resolution: 9,
  encoder: Charset.Normalize })`; `src/ltree/indexer.ts` feeds it from
  `searchValueMember` / `getSearchValueCallback`.
- Only switch: `should-use-internal-search-index` (tristate, default on). No `searchCallback`.
- FlexSearch leaks into the public API: `filterNodes(text, searchOptions?: SearchOptions)`,
  `searchNodes(text, searchOptions?)` take FlexSearch's `SearchOptions`.

Target (the multiselect model):

- Built-in search = core `/search` (`search-behavior`, `search-match`, `getSearchTermCallback`,
  highlighting via `findHighlightRanges` + `wrapRanges`), over the cached per-node search values.
- Own engine = `searchCallback(term, signal, { searchTerm, entries })`, sync or async;
  FlexSearch becomes a consumer choice (a documented recipe keyed on `entries`, like
  multiselect ES04), and leaves the treeview bundle and `dependencies`.
- Tree specifics to design there: matches keep their ancestors visible (today's
  `filterNodes` behaviour), and `entries` are nodes, not flat options.
- Breaking: `should-use-internal-search-index`, the FlexSearch `SearchOptions` parameters and
  any index-init callback go away (or a deprecation window) — release notes with a migration
  recipe.
- This is also when the per-item cache (§5) gets its second user and can move to core.

---

## 5. Out of scope / related follow-ups

- `../web-multiselect-showcase` `src/lib/demo/api-data.ts` still lacks the 2.6 search API
  (`searchBehavior`, `searchMatch`, `getSearchTermCallback`, `searchCallback` context,
  `getSearchValueCallback` object return).
- Pre-existing multiselect issue: replacing `options` with a term typed (flat list) doesn't
  re-filter until the next keystroke.
- A generic per-item search-value cache (`raw → prepared`, lazy `entries`, identity-stable) could
  also move to core later; keep it in the component until a second component needs it.

## 6. Decisions (settled 2026-10-22)

1. Subpath: **`/search`**, not re-exported from the root entry.
2. Highlight output: **`{ text, ranges }`** (`HighlightResult`), ranges index into the returned text.
3. Typed regex flags (`search-match="regex"` without a callback): **none** (case-sensitive), as
   shipped in multiselect 2.6.0-rc02 — regex means raw; a callback can add `i`.
4. Core **owns the `searchCallback` context types** (`SearchEntry`, `SearchCallbackContext`) as the
   cross-component convention, plus `SearchTermContext` / `PreparedSearchTerm`.
5. Per-item cache: **later** — it moves when web-treeview (Phase 3) becomes its second user.

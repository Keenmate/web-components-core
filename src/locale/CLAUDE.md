## Locale + labels (`src/locale/`, subpath `/locale`, SPEC §12.24 — implemented)

`page-locale.ts`: `window.components.locale` / `.security` accessors (`publishPageSetting`), state in
`sharedState('locale')` with a revision counter + listeners; assigning replaces (frozen copy, labels too —
`labels` is ONE flat dictionary `'<component>.<elementType>.<name>'`, non-strings dropped, a nested per-tag object warns;
`formatLabelCallback` (renamed `translateCallback`) warns + dropped); `languagechange` bumps the revision too. BlissElement imports only `observeLocale` / `getLocaleRevision`
from here (the `localeChanged()` hook) — the rest of the module stays off the base import graph.
`settings.ts`: per key instance → page → `Intl`; page keys apply to every element (user preference).
`numbers.ts`: `formatNumber` swaps separators into `formatToParts`; `parseNumber` strips group + spaces (literal
NBSP / NNBSP / thin space in the regex), `−` → `-`. `labels.ts`: `createLabels` → `text` (no escaping) / `html`
(params escaped, or all with `shouldEscapeLabels`); keys flat `<elementType>.<name>`, full key `<tag>.<key>` (`tag` = the
component's own name); instance short OR full key → page `labels[full]` → default; `translateCallback` via `callSafely` (full key,
RAW params) for every key the instance did NOT set — a non-string falls back; an `ariaLabels.x` / `tooltips.x` that resolved to its
built-in takes the first customized sibling (`getLabelSiblings`, visible types first, only keys in `defaults`); the default `{name}` display runs number params through `formatNumber({ locale: getLocale() })`. jsdom has full ICU (Node) — the unit tests assert real `Intl` output; e2e `locale.spec.ts` covers Chromium.

## Locale + labels (`src/locale/`, subpath `/locale`, SPEC §12.24 — implemented)

`page-locale.ts`: `window.components.locale` / `.security` accessors (`publishPageSetting`), state in
`sharedState('locale')` with a revision counter + listeners; assigning replaces (frozen copy: labels one level
deep); `languagechange` bumps the revision too. BlissElement imports only `observeLocale` / `getLocaleRevision`
from here (the `localeChanged()` hook) — the rest of the module stays off the base import graph.
`settings.ts`: per key instance → page → `Intl`; page keys apply to every element (user preference).
`numbers.ts`: `formatNumber` swaps separators into `formatToParts`; `parseNumber` strips group + spaces (literal
NBSP / NNBSP / thin space in the regex), `−` → `-`. `labels.ts`: `createLabels` → `text` (no escaping) / `html`
(params escaped, or all with `shouldEscapeLabels`); `formatLabelCallback` via `callSafely` (gets RAW params), a non-string falls
back; the default `{name}` display runs number params through `formatNumber({ locale: getLocale() })`. jsdom has full ICU (Node) — the unit tests assert real `Intl` output; e2e `locale.spec.ts` covers Chromium.

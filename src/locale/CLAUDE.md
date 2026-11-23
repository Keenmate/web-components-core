## Locale + labels (`src/locale/`, subpath `/locale`, SPEC §12.24 — implemented)

`page-locale.ts`: `window.components.locale` / `.security` accessors (`publishPageSetting`), state in
`sharedState('locale')` with a revision counter + listeners; assigning replaces (frozen copy, labels too —
`labels` is ONE flat dictionary `'<component>.<elementType>.<name>'`, non-strings dropped, a nested per-tag object warns;
`formatLabelCallback` (renamed `translateCallback`) warns + dropped); `languagechange` bumps the revision too. BlissElement imports only `observePageLocale` / `getLocaleRevision`
from here (the `localeChanged()` hook) — the rest of the module stays off the base import graph.
`settings.ts`: per key instance → page → `Intl`; page keys apply to every element (user preference).
`numbers.ts`: `formatNumber` swaps separators into `formatToParts`; `parseNumber` checks group positions (a group mark only between real groups, `parseNumberCallback` element → page → core) and strips group + spaces (literal
NBSP / NNBSP / thin space in the regex), `−` → `-`. `labels.ts`: `createLabels(host | null, …)` (null = a public engine without its element: pass `tag` + `getTranslateCallback`) → `text` (no escaping) / `html`
(params escaped, or all with `shouldEscapeLabels`); keys flat `<elementType>.<name>`, full key `<tag>.<key>` (`tag` = the
component's own name); instance short OR full key → page `labels[full]` → default; the element's `translateCallback` (`getTranslateCallback` / `host.translateCallback`) then the page-wide one, via `runSafely` (full key,
RAW params) for every key the instance did NOT set — a non-string falls back; an `ariaLabels.x` / `tooltips.x` that resolved to its
built-in takes the first customized sibling (`getLabelSiblings`, visible types first, only keys in `defaults`); the default `{name}` / dotted `{ctx.a.b}` display (`formatLabel`, own properties per step) runs numbers at any depth through `formatNumber({ locale: getLocale() })`; `html()` escapes strings at any depth (`escapeParams`: a deep copy of plain objects / arrays only — elements / class instances pass as is) and the callback gets that copy. `createLabelsView(labels)` = a callback's `ctx.labels` (frozen `{ text, html }` only). jsdom has full ICU (Node) — the unit tests assert real `Intl` output; e2e `locale.spec.ts` covers Chromium.

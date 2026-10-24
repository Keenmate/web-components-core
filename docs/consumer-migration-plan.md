# Consumer migration plan — showcases, LiveView wrappers, test apps

Companion to `interaction-model-plan.md`. That plan migrates the components; this one
migrates everything **built on top of them** to the rc15 interaction model (renamed
events / callbacks, `on*` twins receiving the detail, `ctx.controller`, `ActionItem`).
Started 2026-10-23.

## Why a separate plan

The component phases change public APIs on purpose ("break it"). The consumers don't break
at the same moment — each breaks when it picks up the new component version — so they can
be migrated on their own schedule, in one pass per consumer, against a published (or
`file:`-linked) rc instead of a moving target.

## Consumers

| Consumer | Uses | How it depends | Breaks when |
|---|---|---|---|
| `web-daterangepicker-showcase` (SvelteKit) | drp | npm `^1.13.0` | bumped to drp 2.x rc15 |
| `web-multiselect-showcase` | ms | npm `^2.5.0` | bumped to the ms rc after phase 3 |
| `web-treeview-showcase` | treeview | npm `^2.0.0-rc01` | bumped after phase 4 |
| `web-grid-showcase` (SvelteKit) | grid | npm `^1.0.0` (+ npm overrides) | bumped after phase 5 |
| `keen-web-daterangepicker` (Phoenix LiveView wrapper) | drp | **vendored bundle** in `priv/static` + hook `keen_web_daterangepicker_hook.js` | the bundle is refreshed |
| `keen-web-multiselect` (+ `keen-web-multiselect-test`) | ms | vendored bundle + hook `keen_web_multiselect_hook.js` | the bundle is refreshed |
| LiveView bridge for commandpalette (`@keenmate/keen-web-commandpalette`) | cp | consumes `cp-*` event names + `data-search-event` / `data-step-options-event` | bumped after phase 6 |
| `web-component-framework-test` | ms, drp | **`file:../web-multiselect`, `file:../web-daterangepicker`** | **now** — drp is already migrated |

Only the framework-test app is affected today; everything else is pinned to a published
version.

## Known work per consumer

**web-daterangepicker-showcase** — 16 route files, ~213 old-API hits (survey 2026-10-23).
Heaviest: `features/messages-custom-actions` (51), `bulk-metadata-loading` (25),
`special-dates` (24), `event-callbacks` (21), `api` (15); CHANGELOG 4. (`Makefile` /
`+layout.server.ts` hits are only the route name.) Content to rewrite:
- `date-select` → `select`; `custom-action` → `action` (`e.detail.id`, `e.detail.dataset`);
  `onDateSelect(e)` → `onSelect(detail)`; new `month-change` worth a demo.
- `ctx.picker` / `el.picker` → `ctx.controller` / `el.controller`.
- `actionButtons`: `{ action: 'custom' }` → `{ id }`; `isVisibleCallback` →
  `getIsVisibleCallback`; `onClick(detail)`; showcase `beforeActionCallback`, `isActive`,
  `icon`, `isDanger`.
- `beforeDateSelectCallback` result objects → `beforeSelectCallback` return contract
  (`false` / value / `null`, `ctx.controller.showMessage`, `ctx.markRangeInvalid()`).
- `bulk-metadata-loading` → `getMonthDataCallback` (+ `controller.reloadMonthData()`);
  `beforeMonthChangedCallback` → `beforeMonthChangeCallback`.
- Tooltip / summary / styles callback renames (`getDayTooltipCallback`,
  `renderSummaryCallback`, `getCustomStylesCallback(ctx)`).
- The component's own `examples-*.html` are already migrated (drp `026305e`) — reuse them as
  the reference for each demo.

**keen-web-daterangepicker** — hook listens to `date-select` / `change` and forwards
`web_daterangepicker:select` / `:change` / `:custom_action` (payload `{ id, data }` from
`detail.data`); `components.ex` docs (lines ~22–88) name the old events. To do: listen to
`select`; forward `action` as `web_daterangepicker:action` with `{ id, action, item_id,
source, dataset }` (break, per policy); refresh the vendored bundle + `.d.ts`; update
README / guides / ai notes / CHANGELOG; run its `test_app`.

**keen-web-multiselect** (surveyed 2026-10-23, after phase 3) — vendored bundle is **v2.2.0**
(`priv/static/multiselect.js`). Hook: event listeners and payloads are fine (names + `detail`
fields unchanged; payloads built field by field). Runtime breaks: `keen_web_multiselect_hook.js:184`
and `:296` — `searchCallback = (query, signal)` → `({ term, signal })`. Docs: `components.ex`
(`addNewCallback` ×4), README, guides (`theming.md` showMessage opts + string-veto,
`tree_of_options.md`), `FEATURES.md` (~15 rows), `ai/*.txt`. **test_app** is the big one: ~200
runnable lines in 17 files (`examples/*_live.ex` — action_buttons, custom_rendering, data_api,
events_callbacks, tree, logging, sizes, tooltips, virtual_scrolling, …; `fixtures/add_new_live.ex`
drives `e2e/add_new.spec.ts`; `priv/static/assets/app.js:75-87`). Action-button icons put as HTML
in `text` must move to `icon`. `keen-web-multiselect-test` (path dep) has 0 hits.

**web-multiselect-showcase** (surveyed 2026-10-23) — npm `^2.5.0`. ~60 runnable/sample lines
in 13 route files (action-buttons, events-callbacks string-veto, custom-rendering
`data-action="remove"`, external-search, tree, tooltips, basic, data-api, api/*) + ~35 rows in
`src/lib/demo/api-data.ts`. ⚠ `^2.5.0` (and pure-admin/demo `^2.0.1`, theme-designer/app
`^2.0.0-rc10`) would auto-pull a stable **2.6.0** — so the breaking change ships as **3.0.0-rc01**
(decided 2026-10-24); consumers bump to `^3.0.0-rc01`.

**web-treeview-showcase** (surveyed 2026-10-23, after phase 4) — npm `^2.0.0-rc01`, installed
rc01; already stale before this change (rc02–rc06 positional `on*` / `beforeDropCallback`,
removed props `dragValidationCallback`, `dragHighlightClass`, `treeRootClass`). ~70 executed
sites (~20 are `sortCallback(items)` → `({ items })`) + ~75 doc snippets in 17 route files;
heaviest: `examples/context-menu` (old `label` / `onclick` / `close`), `api/tree`,
`api/properties`, `api/events`, drag-drop pages. Effectively a rewrite against the current API.

**gcp-documenthub/frontend/personal-documents** (Lit, pinned `2.0.0-rc05`; feeds
spfx-personal-documents) — 6 sites in `src/components/personal-documents-main.ts`:
`renderNodeCallback(node, container)` → `({ node, contentElement })`, and the earlier
selected→checked rename: `@selection-change` → `@checked-change` (**silent** — the old name
still exists with other data), `detail.selectedPaths` → `detail.paths`, `deselectNode` →
`uncheckNode`, `clearSelection` → `clearChecked` (silent no-op otherwise). Not a KM-owned demo —
coordinate with that project.

No svelte-treeview / LiveView / framework-test dependency on web-treeview.

**web-multiselect-showcase / web-grid-showcase /
keen-web-commandpalette** — survey after the respective component phase (the component
inventory in `docs/interaction-inventory/` lists the names that change). Grid showcase is
the biggest (22 routes, heavy `contextMenu` / `dividerBefore` / lowercase `on*` use — see
`interaction-inventory/web-grid.md` §8).

**web-component-framework-test** (surveyed 2026-10-23) — `file:` links, breaks now. Two
runtime lines: `shared/multiselect-boot.js:74` `getSubtitleCallback = (item)` → `({ item })`;
`shared/daterangepicker-boot.js:94` `'date-select'` → `'select'` (+ comment :81, test title
`tests/web-daterangepicker.smoke.spec.ts:26`). Pre-existing: `el.displayMember` is not a prop.

## How (per consumer)

1. Survey: grep the consumer for every name in the component's CHANGELOG migration table
   (read-only agent; output a file:line list).
2. Point the consumer at the new version — `file:` link during development, the published
   rc once it exists. Never publish a component just to unblock a consumer.
3. Migrate route by route; keep each demo's behaviour, use the component's migrated
   `examples-*.html` as the reference.
4. Verify: the consumer's build + its tests / a browser pass over every touched route
   (console clean).
5. Commit in the consumer repo (straight to its main working branch, no push) with a
   CHANGELOG entry where the repo keeps one.

## Order

- **Now:** nothing blocks the component phases. Optionally fix
  `web-component-framework-test` when ms lands (phase 3).
- **After each component phase:** survey that component's consumers (step 1) and record the
  list here, so the per-consumer work is known before rc15.
- **After rc15 publish (phase 7):** migrate the consumers — drp showcase + keen-web-
  daterangepicker first (already surveyed), then ms, treeview, grid, cp — bumping each to the
  published rc.

## Open questions

- LiveView event names: rename `web_daterangepicker:custom_action` →
  `web_daterangepicker:action` (break, consistent) — proposed yes.
- Should the showcases move to `file:` links during rc15 development (to catch breaks
  early), or stay on published versions? Proposed: stay on published; migrate after rc15.

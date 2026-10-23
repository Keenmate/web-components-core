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

**keen-web-multiselect** — hook already listens to `select` / `deselect` / `change` /
`add` / `ready` (names unchanged), reads `detail.selectedValues` / `detail.option`. Phase 3
keeps those fields, so likely only: the new `action` event, `ctx.element` uses in docs,
and the bundle refresh. Re-survey after phase 3.

**web-multiselect-showcase / web-treeview-showcase / web-grid-showcase /
keen-web-commandpalette** — survey after the respective component phase (the component
inventory in `docs/interaction-inventory/` lists the names that change). Grid showcase is
the biggest (22 routes, heavy `contextMenu` / `dividerBefore` / lowercase `on*` use — see
`interaction-inventory/web-grid.md` §8).

**web-component-framework-test** — check what it exercises (`file:` links) and fix it
alongside phase 3 (it uses both ms and drp).

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

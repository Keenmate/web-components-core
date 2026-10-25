# E2E coverage plan — all core-based components

Status: **planned 2026-10-24** from a cold audit of every component suite (one agent per repo).
Template: **web-multiselect** (`e2e/fixtures.ts`, one minimal fixture page per spec,
`test/COVERAGE.md`, `test/NOTES.md`, `test/unit/`). Work is split into self-contained work
packages (WP) that an agent can take one at a time.

## Baseline (2026-10-24, all green)

| Repo | e2e | unit | Fixtures | COVERAGE.md | pageerror guard |
|---|---|---|---|---|:-:|
| web-multiselect (template) | 397 pass | 18 files | `test/*.html`, 1 per spec | ✓ | ✓ |
| web-daterangepicker | 286 pass | none | `test/*.html` (some shared) | ✓ stale | ✗ (fixtures.ts only pins the clock) |
| web-treeview | 210 pass, 15 skip | none | `test/*.html` | ✗ | ✗ |
| web-dropzone | 166 pass, 2 skip | 3 files | `test/*.html` | ✓ drifted | ✗ |
| web-grid | 328 pass, 3 skip | 3 files | `docs/test/*.html` | ✗ | ✗ |
| web-commandpalette | 77 pass | 78 tests | mostly ONE `test/fixture.html` + flags | ✗ | ✗ |
| web-editor | 18 pass | 94 tests | 2 pages | ✗ | ✗ |

"All failing" reports on a dev machine were a **stale Vite dev server** serving an old core
`dist/` (missing export → element never defined). Restart the server (`--force` if needed) after
core rebuilds; `make test-e2e` reuses whatever runs on the repo's default port.

## Rules for every agent

- **Repo + branch:** commit straight to `prod` in the component repo; never push; never publish.
- **Do not stage WIP files** you didn't create:
  - drp: `test/shot-*.png`, `test/mobile-time.html`, `test/shot-mobile-time.mjs`
  - treeview: `scripts/rename-selected-checked.mjs`, `test-results/`, `validation_*.md`
  - dropzone: `.claude/settings.local.json`, `.gitignore`, `CLAUDE.md`, `Dockerfile`, `vite.examples.config.ts`
  - grid: `.claude/commands/publish.md`, `.claude/settings.local.json`, `docs/examples-grid-modes.html`, `docs/package.json`, `package-lock.json`
  - cp: untracked `.claude/`; editor: `grep.exe.stackdump`; ms: `validation_*.md`
- **Ports:** never touch 12200, 12400, 12510, 12750, 12751 (developer servers). Run with the
  private config `node_modules/.pw-<port>.config.mjs` (exists for each repo, modeled on
  `web-multiselect/node_modules/.pw-12500.config.mjs`), `--workers=3`:
  drp 12570 · treeview 12520 · grid 12530 · dropzone 12540 · cp 12550 · editor 12560 · ms 12500.
  Kill only servers you started.
- **Fixture pages:** one minimal, deterministic page per spec (`test/<area>.html`; grid:
  `docs/test/<area>.html`). No example pages in behaviour specs. Event logs: a
  `<pre data-testid="<area>-log">` the page appends `type:detail` lines to.
- **Component bugs:** do NOT fix component code inside a test WP (unless the WP says so).
  Write the test for the *correct* behaviour, mark it `test.fail(true, 'NOTES.md #N')`, and add a
  numbered entry to `test/NOTES.md` (where, symptom, repro, suggested fix). Bugs listed below
  under "Known bugs" already have IDs — reuse them.
- **Per WP:** update `test/COVERAGE.md` rows (✓/△/✗ + spec + fixture), run the **full** suite on
  your port, commit with a `test(e2e): …` message, report counts.

## WP0 — infrastructure (do first, per repo; small and mechanical)

For each of drp, treeview, dropzone, grid, cp, editor:

1. **`e2e/fixtures.ts` pageerror guard.** Copy `web-multiselect/e2e/fixtures.ts` verbatim
   (auto `pageErrors` fixture). drp: merge it with the existing clock pin
   (`page.clock.setFixedTime`). Editor: also add an auto `dialog` stub fixture
   (`page.on('dialog')`, answers from a per-test queue) — link/image/code-block use `prompt()`.
2. **Switch every spec** to `import { test, expect } from './fixtures'` (drp has 6 specs that
   bypass it: back-gesture, drag-adjust-touch, mobile-presentation-{desktop,phone,tablet},
   mode-flip). Run the suite — any new failure is a real uncaught error: log it in NOTES.md.
3. **`e2e/helpers.ts`** for helpers duplicated across ≥3 specs, re-exported from fixtures.ts:
   - drp: `pickerById` (25×), `calendarOf` (22×), `open` (17×), `dayByDate` (17×), `inputOf` (12×)
   - treeview: `tree/treeIn`, `nodeAt/nodeByPath/nodeIn`, `contentOf/nodeContent`, `cssAttrEscape/escapeRe`
   - dropzone: `dz` (17×), `addNamed` (8×), `pendingNames/resolveUpload/pumpProgress`, `stage/log`
   - grid: `gridLocator` (21×), `cell` (14×), `header` (5×), color helpers (`parseColor`, `relativeLuminance`, `composite`), `focusCell`, `openToolbarOn`, `clickMenuItem`
   - cp / editor: fold the per-spec `PAGE` loaders into the existing `load()`.
4. **`test/COVERAGE.md`** (ms format: Feature | Status | Spec | Fixture, grouped by area) —
   create for treeview, grid, cp, editor from the tables below; **refresh** drp (16 specs
   unreferenced; wrong "hover preview n/a" and `getMonthDataCallback ✗` rows; section order) and
   dropzone (theme-context, form-delegation, grid-layout rows; §9 min-file-count contradiction).
5. **`test/NOTES.md`** — create where missing (treeview, grid, cp, editor, dropzone; drp keeps
   `test/FINDINGS.md`) seeded with the repo's "Known bugs" below.
6. Small fixes found by the audit:
   - treeview: `global-setup.ts` warms only 15/24 fixtures — add the missing 9; fix stale titles
     (`clipboard-extended.spec.ts:71` → `nodeInputTransformationCallback`, `:84` "returning
     false suppresses", `silent-selection.spec.ts:38`); delete the stale touch-drag `test.skip`
     at `drag-drop.spec.ts:322` (`touch-drag.spec.ts` covers it).
   - dropzone: `test/drag-overlay.html:25` `overlay-target="#target"` → `"target"`, then un-fixme
     `drag-overlay.spec.ts:39-40` (a synthetic `DataTransfer` with a `File` works). See DZ-1.
   - drp: give `mode-flip.spec.ts` its own fixture.
   - grid: give `theme-context.spec.ts` / `inputs.spec.ts` own fixtures; move
     `theming-playground.spec.ts` assertions off the example page.

## Cross-cutting decision (needs the user before the lifecycle WPs)

**D1 — DOM move tears components down.** Core's lifecycle is build-once + activate/deactivate
(a move = `disconnect()`→`connect()`, no rebuild, transient state survives). Several components
destroy on `disconnect()`:
- drp `src/web-component.ts:371-374` (picker destroyed/rebuilt; open state, mid-range pick lost)
- dropzone `web-component.ts:446-451` (store destroyed → **all files lost, uploads aborted**)
- editor `web-component.ts:308-316` (engine torn down → undo history lost; tables lost, ED-1)
- cp `web-component.ts:627` (`close()` on disconnect — maybe intentional for an overlay)

**Decided 2026-10-24 (user):** a DOM move must **keep state** in dropzone, editor and
daterangepicker (files + in-flight uploads; content, tables, undo, selection; selection, value,
open state). The command palette **closes cleanly** (`close` once, focus restored, hotkeys still
work after the move). Each repo's `lifecycle.spec.ts` pins this. The editor bugs ED-1 to ED-4 are
fixed test-first, in the editor's lifecycle/content WP: the spec lands red, then the component
fix turns it green. For drp/dz, the lifecycle spec lands as `test.fail` until the component is
moved to activate/deactivate (a separate fix WP per repo).

## Per-component work packages

Priorities: **P1** core behaviour / regression-prone, **P2** documented features, **P3** polish.

### WP-DRP — web-daterangepicker (port 12570)

| P | Spec / fixture | Assert |
|---|---|---|
| P1 | `time-picker.spec.ts` / `time-picker.html` | `picker-mode="time"` and `"datetime"`: picking h:m commits `selectedTime`/`selectedDatetime`; the input shows `display-time-format-mask`. `time-display` rolls/clock/wheel/compact each render and change the value; switching (`on:'update'`) keeps the selection |
| P1 | `time-options.spec.ts` / `time-options.html` | `hour-cycle` 12 shows AM/PM; `time-step` steps minutes; `is-seconds-shown` toggles the column; `is-now-button-shown` sets the (clock-pinned) now; `time-format-mask` |
| P1 | `mobile-time.spec.ts` / `mobile-time.html` (mobile project; the user has an untracked WIP page of that name — create `mobile-time-e2e.html` instead, do not touch theirs) | full-screen time selection commits |
| P1 | `selection-modes.spec.ts` (extend) | `commit-mode="manual"`: nothing commits/closes until the API call |
| P1 | `lifecycle.spec.ts` / `lifecycle.html` (after D1) | re-parent keeps selection, input value, form value, open state |
| P2 | `defer-ready.spec.ts` / `defer-ready.html` | `defer` renders nothing; removing it builds and fires `ready` once (not on reinit/reconnect); `is-ready`/`isReady` |
| P2 | `single-active.spec.ts` (extend fixture) | `overlay-group`: different groups stay open together; same group dismisses |
| P2 | `multi-month.spec.ts` (extend) | `unified-navigation-anchor-index` keeps column N's month; `month-layout` row→grid at runtime keeps selection |
| P2 | `api-extras.spec.ts` / `api-extras.html` | `selectedDate/Ranges/Dates` + `value` setters render classes and update input + form value; `toggle()`, `clearSelection()` (+ `change`?), `open()` idempotent; `setRollingItemAlignment` |
| P2 | `keyboard-navigation.spec.ts` (extend) | ArrowLeft/Up, End, Ctrl+arrows, Ctrl+Home/End — one test per key |
| P2 | `callbacks.spec.ts` (extend) | `beforeSelectCallback` returning `DateRange[]` replaces the selection |
| P2 | `rolling-selector.spec.ts` (extend) | entries outside min/max disabled; `rolling-year-range` |
| P2 | `locale.spec.ts` (extend, `test.use({ locale: 'de-DE' })`) | `locale="auto"` / `week-start-day="auto"` → German names, Monday first |
| P2 | `input-behavior.spec.ts` (extend) | progressive parsing: a partial typed date moves the calendar month |
| P2 | `tooltips.spec.ts` (extend) | `getBadgeTooltipCallback` text |
| P3 | `misc-features.spec.ts`, `logging.spec.ts`/`logging.html`, `rtl.spec.ts`/`rtl.html`, `positioning-modes.spec.ts` | `enable-transitions`; `show-debug-info` + `/logging` silent by default; RTL arrow direction; modal blurs input + always 6 weeks; `fullscreen-autofocus` |
| — | unit layer | add vitest + `test/unit/` (parsing/format masks, range math) — separate WP, optional |

**Known bugs (drp):**
- DRP-1 `formResetCallback()` (`web-component.ts:377-382`) clears to `''` instead of the
  default `value` attribute, and skips `flush()`.
- DRP-2 `getInputValue()`/`value` getter (`:982,1004`) don't `flush()` → stale read after `setAttribute`.
- DRP-3 `setRollingItemAlignment` (`:996-999`) writes the CSS var on the picker node → lost on rebuild.
- DRP-4 DOM move rebuilds the picker (D1).

### WP-TV — web-treeview (port 12520)

| P | Spec / fixture | Assert |
|---|---|---|
| P1 | `keyboard-clipboard.spec.ts` / `keyboard-clipboard.html` | Ctrl+C/X/V, Shift+Del/Insert; Esc cancels pending cut; `handle-keyboard-shortcuts=false` disables; Ctrl+A selects visible selectable only; Esc clears selection, keeps checks |
| P1 | `range-selection.spec.ts` / `range-selection.html` | `rangeSelectionMode` logical includes collapsed descendants; `selectionMode='single'` blocks Ctrl/Shift (TV-3) |
| P1 | `checkbox-api.spec.ts` / `checkbox-api.html` | `checkNode/checkNodes/setCheckedPaths/checkAll/uncheckNode`; `cascadeCheckPolicy` rolled-up/leaves/all → `checked-change` paths; `beforeCheckboxToggleCallback` false cancels, `string[]` overrides |
| P1 | `drag-hooks.spec.ts` / `drag-hooks.html` | `beforeDropCallback` false / redirect / `DropGroup[]` / async; `beforeDragStartCallback` prune + veto |
| P1 | `mutation-api.spec.ts` / `mutation-api.html` | `addNode/updateNode/removeNode/moveNode(s)/duplicateNodes/copyNodeWithDescendants/applyChanges`: DOM reflects; result counts; `tree-change` once per op |
| P1 | `lazy-load.spec.ts` / `lazy-load.html` | `hasChildrenMember` shows a toggle on a childless node; expand → handler `insertBranch` → children render |
| P1 | `virtual-scroll.spec.ts` / `virtual-scroll.html` (5k nodes) | DOM rows ≈ viewport + overscan; scrolling renders new rows; far `scrollToPath`; `use-flat-rendering`, `progressive-render` batches |
| P1 | `keyboard-nav.spec.ts` (10 skipped) | **feature gap first:** PageUp/PageDown + Shift-extend are not implemented (`dom-renderer.ts:374-422`) — implement (own WP, confirm with user), then un-skip |
| P1 | `drag-drop.spec.ts:234` (skipped) | un-skip after TV-5 is fixed |
| P2 | `selection-api.spec.ts` / `selection-api.html` | `selectAll`, `setSelectedPaths`, `focusNode/clearFocus`, `focus-change` payload; silent variants fire nothing |
| P2 | `drag-cross-tree.spec.ts` / `drag-cross-tree.html` | A→B move; Ctrl-drag copy keeps source; `nodeOutputTransformationCallback` on copy-drop (un-skips `drag-drop.spec.ts:320-321`) |
| P2 | `drag-visuals.spec.ts` / `drag-visuals.html` | `node-drag-reject`/`node-drop-reject`; `indicate-undraggable`; `enable-tree-drop-zone` (target null); `show-drop-placeholder-when-empty`; `drop-zone-*`; drag classes; `touch-drag-delay` |
| P2 | `clipboard-extended.spec.ts` (extend) | `beforeCutCallback` veto; `nodeOutputTransformationCallback`; `cancelCut/hasClipboardContent/getClipboardOperation`; `allow-copy`; `auto-handle-copy/paste=false` fires the event without mutating |
| P2 | `expand-members.spec.ts` / `expand-members.html` | `get/setExpandedPaths` round-trip; `isExpandedMember`/`getIsExpandedCallback`; `isCollapsibleMember` ignores toggle |
| P2 | `data-members.spec.ts` / `data-members.html` | `isSorted/orderMember/sortCallback` order; `getDisplayValueCallback`; `parentPathMember/levelMember/idMember`; `data` reassign |
| P2 | `search-config.spec.ts` / `search-config.html` | `search-text` attribute filters; `searchValueMember`/`getSearchValueCallback`; internal index off; `filterNodes` |
| P2 | `render-callbacks.spec.ts` / `render-callbacks.html` | empty-state/loading/header/footer/empty-zone callbacks, `no-data-text`, `is-loading`, `getCustomStylesCallback` lands in the shadow root, `body-class`, `leaf-icon-class`, `align-node-icons` |
| P2 | `context-menu-render.spec.ts` / `context-menu-render.html` | `renderContextMenuCallback`/`renderContextMenuItemCallback`; `openContextMenu(path,x,y)` + offsets; keyboard in menu |
| P2 | `attr-reactivity.spec.ts` / `attr-reactivity.html` | removing an attribute resets to default; `setAttributes` batch; `el.prop = x; el.method()` sees x |
| P2 | `lifecycle.spec.ts` / `lifecycle.html` | re-parent keeps expansion/selection/listeners |
| P3 | `nav-api.spec.ts`, `tooltip.spec.ts` (extend), `logging.spec.ts`, debug smoke | `navTo/Next/Prev/Into/Toggle`, `scroll-highlight-class/timeout`; `tooltip-placement/offset`, `{show,hide}` delay; logging silent by default; `should-display-debug-information`, `tree-id` |
| — | unit layer | add vitest + `test/unit/` for `ltree.ts` / `tree-engine.ts` (none today) — separate WP |

**Known bugs (treeview):**
- TV-1 `insertBranch` (`src/ltree/ltree.ts:1541-1556`) never reports failures (always `success:true`, no failed count) — un-skips `branch-operations.spec.ts:215` once fixed.
- TV-2 `replaceBranch` (`ltree.ts:1582-1584`) emits tree-changed twice; `removed` counts direct children only.
- TV-3 `selectAll` (`tree-engine.ts:1664-1679`) ignores `selectionMode='single'`; moves focus without `focus-change`.
- TV-4 PageUp/PageDown/Shift-extend unimplemented (feature gap vs the Svelte build).
- TV-5 multi-drag top-level absorption doesn't move (`drag-drop.spec.ts:230-234`).

### WP-DZ — web-dropzone (port 12540)

| P | Spec / fixture | Assert |
|---|---|---|
| P1 | `drag-overlay.spec.ts` (WP0 fixes the fixture) | overlay mounts on dragenter, `overlay-enter`/`overlay-leave`, drop adds the file, overlay removed; two overlays don't steal drags (P3) |
| P1 | `drop.spec.ts` / `drop.html` | drop onto the dropzone runs add + validation; drag-active class + `drag-active-text` on dragover |
| P1 | `disabled.spec.ts` / `disabled.html` | disabled host: click/drop/overlay add nothing; `el.disabled` toggle is reactive; `<fieldset disabled>` (DZ-5) |
| P1 | `reactivity.spec.ts` / `reactivity.html` | `max-file-count` set after build applies; removing → unlimited; mode flip rebuilds |
| P1 | `row-actions.spec.ts` / `row-actions.html` | per-row pause/resume/retry/cancel buttons cycle status; ✕ while uploading |
| P1 | `toolbar.spec.ts` / `toolbar.html` | `retry-all/pause-all/resume-all/add-more/clear` buttons drive the methods; visibility follows state |
| P1 | `upload-edge.spec.ts` (extend) | `retryPolicy` attempts/delayMs/backoff (handler called N times → complete), aborted on pause; `uploaded-deletable="false"`; `reorder-completed-delay` |
| P1 | `events-extra.spec.ts` (extend) | `file-delete` only for files with server state (with `file-remove`); `setMetadata`/`uploadMetadata` flow |
| P1 | `lifecycle.spec.ts` / `lifecycle.html` (after D1) | re-parent keeps `files`, in-flight upload; `ready` count |
| P2 | `validation*.spec.ts` (extend) | `dedupe-mode="name-size"`; `accept=".pdf,.docx"` case-insensitive; one `files-reject` with mixed codes |
| P2 | `display.spec.ts` (extend) | `multiple` attr/property on the native input; P3: `prompt-text`, `hint-text`, `empty-message`, `overlay-text/icon` + live update |
| P2 | `controls.spec.ts` / `controls.html` | `controls` / `item-controls` allowlists render only listed parts |
| P2 | `persistence.spec.ts` / `persistence.html` | `storage-key` writes `dz-state:<key>`; reload restores; `persistStateCallback` gets `{key,state}` |
| P2 | `popover.spec.ts` / `popover.html` | `popover-placement`; Escape + outside click close; `summary-template` |
| P2 | `satellites-extra.spec.ts` (extend) | picker `label/hint/inside/disabled/selector-appearance`; list `nested/list-appearance/empty-message`; indicator `position/drawer/label`; progress `data-status` |
| P2 | `icons.spec.ts` / `icons.html` | `fileIcons` map + `getFileIconCallback` markup in the row |
| P3 | `list-extra.spec.ts`, `appearance.spec.ts`, `api.spec.ts`, `a11y.spec.ts`/`a11y.html` | `rolling-rotation` + rolling render callbacks; minimal-selector count badge; `uploadFile(id)` bypasses the cap; `destroy()`; Enter/Space opens the picker, aria labels |
| — | `theme-context.spec.ts` | own `test/theme-context.html` (WP0) |

**Known bugs (dropzone):**
- DZ-1 `overlay-target` documented as a selector (`web-component.ts:225`) but resolved with `getElementById` (`dropzone.ts:2521-2522`) → `"#id"` silently fails. Accept both (strip `#` / `querySelector`) or fix docs.
- DZ-2 unconditional `console.log` in auto-retry (`packages/web-dropzone-core/src/dropzone-engine.ts:932,946,955,965,981,988`) — route through `/logging`.
- DZ-3 `value-format` (`web-component.ts:233`) is a no-op — implement or remove.
- DZ-4 DOM move destroys the store → files lost (D1).
- DZ-5 no `formDisabledCallback` → disabled `<fieldset>` probably doesn't disable it (verify).

### WP-GRID — web-grid (port 12530, fixtures in `docs/test/`)

| P | Spec / fixture | Assert |
|---|---|---|
| P1 | `filtering.spec.ts` / `filtering.html` | `isFilterable`, `filters`/`setFilter` narrows rows; `filter-change` detail; column `filterCallback`; server `filterMode` fires `data-request`, no local filtering |
| P1 | `copy.spec.ts` / `copy.html` (grant clipboard perms) | Ctrl+C cell/range TSV; `shouldCopyWithHeaders`; `getCopyValueCallback`; `copySelectedRowsToClipboard` |
| P1 | `drafts.spec.ts` / `drafts.html` | edit marks dirty + indicator (`isDirtyIndicatorVisible`); `isCellDirty/isRowDirty/getRowDraft`; `discardRowDraft/discardAllDrafts` restore; `row-change` detail |
| P1 | `row-locking.spec.ts` / `row-locking.html` | `lockRowById/unlockRowById/isRowLocked/getRowLockInfo`; lock blocks F2 + paste; `row-lock-change`; `getLockInfoCallback`, `getCanEditLockedCallback`; tooltip text (i18n gap → `test.fail`) |
| P1 | `pagination.spec.ts` / `pagination.html` | server `paginationMode` emits `data-request` {page,size}; `pageSizes` selector; `paginationLayout/Position`; `isPaginationVisible:'auto'` hides on one page; `getPaginationLabelsCallback` |
| P1 | `events.spec.ts` / `events.html` | `edit-start`, `edit-cancel`, `cell-selection-change`, `row-delete` (Delete key), per-node `expand-change` — once each, `on*` twin gets the same detail |
| P1 | `keyboard.spec.ts` / `keyboard.html` | Home/End/PageUp/PageDown/Ctrl+Home; Shift+Arrow extends; Delete commits null; Ctrl+G go-to-row; `rangeShortcuts`; number column ignores letters (GRID-1) |
| P1 | `interaction-model.spec.ts` (extend) | the four open gaps from `interaction-model-plan.md` as `test.fail`: move-row keeps focus; built-ins run after `action`; lock tooltip i18n; shortcuts help lists range shortcuts |
| P2 | `new-row.spec.ts` / `new-row.html` | `isNewRowEnabled`, `newRowPosition`, `newRowIndicator`, `createRowCallback`/`createEmptyRowCallback` |
| P2 | `row-api.spec.ts` / `row-api.html` | `getRowIdCallback`/`idMember`, `updateRowById`, `replaceRowById`, `findRowById`, `focusCell`, `startEditing` |
| P2 | `summary.spec.ts` / `summary.html` | `renderSummaryCallback`, `summaryPosition`, `isSummaryInline`, `summaryMetadata`; recomputes after edit |
| P2 | `tooltip.spec.ts` / `tooltip.html` | column `getTooltipCallback`, `getValidationTooltipCallback`, show/hide delays |
| P2 | extend `editors`, `edit-trigger`, `dropdowns`, `selection`, `toolbar`, `validation`, `resize-reorder` specs | number editor parsing; `button`/`always` per column + `editStartSelection` caret modes; dropdown flags + `isCheckboxAlwaysEditable`; `cellSelectionMode` disabled/shift + selection API; `toolbarTrigger` click/button, align, position, offset, column; `invalidCells` + getters; `gridName` + `shouldPersistColumnOrder` + `setColumnOrder` + `isColumnReorderAllowed=false` |
| P2 | `tree.spec.ts` | un-skip the 3 tree-menu tests (click via `evaluate`/`force` once the menu is stable) |
| P3 | `i18n.spec.ts`, `logging.spec.ts`, extend `tree`, `shortcuts`, `basic`/`height-modes`, `inputs` | `labels` across menus/pagination/go-to-row; logging silent by default; chevron/glyph callbacks; `shortcutsHelpPosition`, `renderShortcutsHelpCallback`; `isHoverable`, `isTableBorderOnly`, `scrollMaxHeight`, `isStickyRowNumbers`; table-driven attribute→property→removal loop over all inputs |

**Known issues (grid):**
- GRID-1 duplicated key handling: `modules/navigation/cell-keydown.ts:73-93,379-416` vs `modules/actions/adapter.ts:362-400` (adapter runs first → cell-keydown copies dead; number-column digit filter only in the dead path).
- GRID-2 `navigator.clipboard.writeText` (`cell-keydown.ts:91`) uncaught → unhandled rejection (the WP0 guard will flag it).
- GRID-3 Ctrl+G ignores `metaKey` (`cell-keydown.ts:271-276`).

### WP-CP — web-commandpalette (port 12550)

Restructure first: split the shared `test/fixture.html` (query flags) into per-spec pages as
specs are added; move `examples.spec.ts` behaviour assertions (getIsVisibleCallback steps, option
fork, favorites replay) and `theming.spec.ts:40,57` onto fixtures; keep a "loads without errors"
smoke over the example pages.

| P | Spec / fixture | Assert |
|---|---|---|
| P1 | `search-async.spec.ts` / `search-async.html` | race: slow first, fast second → only second renders, first `signal.aborted`; rejecting provider → local matches + usable palette, no pageerror (CP-2); loader / `results--loading` while pending; `search-debounce` 0 vs 500 |
| P1 | `api.spec.ts` / `api.html` | `open/close/toggle/reset/openFavorites/openRecent`, `isOpen`, each fires its event once; `reset()` returns home while open; `commands`/`contexts` reassignment and `setCommands/setContexts` while open re-render |
| P2 | `attributes.spec.ts` / `attributes.html` | `page-size` (+ live change); attribute removal resets (`display`, `page-size`) |
| P2 | `hotkeys.spec.ts` / `hotkeys.html` | `open-key="p"` / `''`; `favorite-key`/`recent-key` remap; `recent-hotkey` (`g h`) |
| P2 | `usage-limits.spec.ts` / `usage-limits.html` | `favorites-limit`/`recent-limit` (1 → "+N more", 0 hides); `usage-key` isolation + live switch |
| P2 | `usage-host.spec.ts` / `usage-host.html` | async `loadUsageCallback`; star → `saveUsageCallback({entry})`; save-without-load (CP-3) |
| P2 | `labels.spec.ts` / `labels.html` | custom labels render; reassignment while open updates |
| P2 | `groups.spec.ts` / `groups.html` | `group` headings in first-appearance order |
| P2 | `providers.spec.ts` / `providers.html` | per-context `searchCallback` / per-step `getOptionsCallback` override the element callback |
| P2 | `wizard.spec.ts` / `wizard-branching.html` | option branching + `getIsVisibleCallback` (moved off the example page) |
| P2 | `confirmation.spec.ts` (extend) | `confirmation-duration="0"`; select-confirmation with custom render |
| P2 | `multi-instance.spec.ts` / `multi-instance.html` | only the first owns hotkeys; removing it hands Ctrl+K to the second |
| P2 | `lifecycle.spec.ts` / `lifecycle.html` (after D1) | move while open → closes cleanly, `close` once, hotkeys still work |
| P3 | `logging.spec.ts`, `search.spec.ts`, `mobile.spec.ts`, `theme-context.spec.ts` (extend) | logging silent by default; aliases `/d `, `:p `; `mobile-presentation="fullscreen"` on desktop; `data-theme="dark"` on the host |

**Known issues (cp):**
- CP-1 `disconnect()` calls `close()` (`web-component.ts:627`) — D1.
- CP-2 rejecting provider renders as plain "No results" (`palette.ts:1079`); no host event/label for errors.
- CP-3 `saveUsageCallback` ignored unless `loadUsageCallback` is set (`web-component.ts:495`) — warn or document.
- CP-4 `open` is reflected but not an input — `<web-command-palette open>` does nothing.

### WP-ED — web-editor (port 12560)

The thinnest suite. Fix-first: ED-1…ED-4 are confirmed data-loss / state bugs — the `lifecycle`
and `content` specs land as `test.fail` until fixed (fixing is a separate, user-approved WP).

| P | Spec / fixture | Assert |
|---|---|---|
| P1 | `content.spec.ts` / `content.html` | md/html/json `value` render the same DOM; `getHTML/getMarkdown/getJSON`; `setValue(v, fmt)` + `change`; `value` reassignment rebuilds without refiring `ready`; `focus()` |
| P1 | `lifecycle.spec.ts` / `lifecycle.html` | move keeps content incl. tables (ED-1) + undo (ED-2); `plugins` reassignment preserves content; `setValue` before connect (ED-3); `format` change while detached (ED-4); `ready` once; `destroy()` |
| P1 | `formatting.spec.ts` / `formatting.html` | bold/italic/underline/code via toolbar + Mod-b/i/u toggle, `aria-pressed`, markdown output; H1/P block type; Shift-Enter hard break |
| P1 | `lists.spec.ts` / `lists.html` | bullet/ordered wrap; Enter splits; Tab/Shift-Tab nest; md `-`/`1.` |
| P1 | `history.spec.ts` / `history.html` | undo/redo buttons + Mod-z / Mod-y / Mod-Shift-z; button enabled state |
| P1 | `links.spec.ts` / `links.html` | Mod-k / toolbar prompt → `a[href]`; md `[t](u "title")`; toggle off; disabled on empty selection (ED-5) |
| P1 | `tables.spec.ts` / `tables.html` | insert; Tab cell nav; `runCommand('add-row-after')` etc.; merge/header; html/json round-trip |
| P1 | `modes.spec.ts` / `modes.html` | edit/split/preview/inline + `mode-change`; split output live; preview non-editable; switching keeps doc + selection |
| P1 | `readonly.spec.ts` / `readonly.html` | typing ignored, toolbar hidden, native context menu; removing the attribute re-enables |
| P2 | `code-block.spec.ts`, `images.spec.ts`, `image-pipeline.spec.ts` (+ pages) | code block via prompt + language + Prism tokens + fenced md; image insert + md/html round-trip (ED-6); `imageBase64Plugin` routes http src → `data:`, cancelled host → no insert |
| P2 | `inline-anchor.spec.ts`, `toolbar.spec.ts`, `statusbar.spec.ts`, `selection-toolbar.spec.ts`, `context-menu.spec.ts` (+ pages) | anchor tracking + detach; toolbar edges by bbox + active state on caret move; Words/Chars live, edges; selection toolbar show/hide rules; context menu dismiss + readonly |
| P2 | `plugins.spec.ts`, `pipelines.spec.ts`, `paste.spec.ts` (+ pages) | custom plugin button + serialization, `plugins=[]` hides link/image/table; pipeline stage before/after/replace on toolbar AND keymap, halt cancels; HTML paste keeps marks, drops unknown nodes |
| P3 | `theming.spec.ts`, `logging.spec.ts`, `registration.spec.ts`, `inputs.spec.ts` | `theme="dark"` + `--km-accent`; logging silent by default; global registration; `mode="bogus"` → default + warn |
| — | not implemented (record in COVERAGE as feature gaps, no tests) | paste/copy/idle pipeline triggers (PIPELINES.md §4); form association (`name` + hidden input per the form-submission convention); placeholder input; blockquote/hr/strike (parser scope) |

**Known bugs (editor):**
- ED-1 tables lost on DOM move / `plugins` reassignment: snapshot is markdown (`web-component.ts:309,542`), table md writes raw HTML (`plugins/tables.ts:60`) but the parser has `html:false` (`engine/serialization/markdown.ts:118`). Fix idea: snapshot via `getJSON()`.
- ED-2 undo/selection lost on every move (`web-component.ts:308-316`) — D1.
- ED-3 `setValue()` before first connect discarded (`reinit()` overwrites `#content`, `:270` vs `:517`).
- ED-4 `format` changed while detached parses the markdown snapshot as HTML (`:309`, `:517`).
- ED-5 Mod-k with empty selection pops a blocking `alert()` (`plugins/link.ts:35`; keymaps skip `getIsEnabledCallback`).
- ED-6 image md writes `src` unescaped (`plugins/image.ts:39`).
- ED-7 link `title` `''` on create vs `null` on parse (`link.ts:25` vs `:66`).

## Suggested order

1. WP0 in all six repos (parallel-safe: one agent per repo).
2. User decides D1 (+ whether ED-1…4 / TV-4 / DZ-1 get fixed now).
3. P1 rows per repo (one agent per repo); grid and editor are the largest.
4. P2, then P3.

## Optional core follow-up (confirm the shape first)

The pageerror guard is now copied into 7 repos. Core's `/testing` subpath is runner-agnostic DOM
fixtures; Playwright fixtures were explicitly deferred (SPEC §12.7). If drift appears, consider a
`/testing/playwright` subpath exporting the guarded `test` — not part of this plan.

## Results (2026-10-25): every WP executed

All repos are on `prod`; nothing was pushed. Each repo's `test/NOTES.md` has the details, repro
steps and fix ideas (grid: `docs/test/NOTES.md`; drp: `test/FINDINGS.md`). `test.fail` = pins a
component bug.

| Repo | Before | After | of which `test.fail` | Commits |
|---|---|---|---|---|
| web-daterangepicker | 286 | 379 | 20 | 5f6c0c8 … 434b261 |
| web-treeview | 210 (+15 skip) | 382 (+11 skip: TV-4 ×10, TV-1) | 28 | 63b045a … e6c2be9 |
| web-dropzone | 166 (+2 skip) | 302 | 14 | da467f0 … 4539a6e |
| web-grid | 328 (+3 skip) | 548 | 38 | 1edd15e … 36028c6 |
| web-commandpalette | 77 | 138 | 2 | a6476cb … 6918047 |
| web-editor | 18 | 164 | 5 | 1a665cf … 5e5e46a (fix: 6b26107) |

Fixed: **ED-1 to ED-4.** A DOM move now keeps the engine alive (deactivate/activate). It pauses
ProseMirror's internal `domObserver` to avoid a leak, and `plugins` reassignment carries the
content over as HTML.

### Most serious open bugs (fix candidates)
- **drp #17**: Apply never fires `select`/`change` or refreshes the form value, for any
  `commit-mode="apply"` picker (incl. every time/datetime picker).
- **drp #21**: any `on:'reinit'` change drops the selection while the input keeps the old text.
- **grid GRID-1**: duplicated key handling. It is the root cause of the number-column type-to-edit
  bug (#1), `getCopyValueCallback` never being used (#9 partly), the unsaveable new row (#17) and
  GRID-2. Fix it first.
- **grid #7**: drafts are keyed by row position → an edit shows on the wrong row after sort/page/filter.
- **grid #21**: tooltip text isn't attribute-escaped (row data can inject attributes).
- **treeview #8**: copies keep the source id → the original row vanishes (Ctrl+C/V, `duplicateNodes`).
- **treeview #12**: `get*Callback`s see `node.data === undefined` during the initial insert → throws, renders nothing.
- **treeview #18**: every config update re-inserts all data (wipes `search-text`, re-indexes).
- **dropzone #9**: the worker pool doesn't refill → "Retry all" ignores `concurrency`.
- **dropzone #10/#11**: popover "Add more" is dead; selector-toggles-popover is lost (leftover code in `dropzone.ts`).
- **editor ED-9**: a `plugins` set that fails to assemble leaves the editor empty (content lost).
- D1 lifecycle (keep state on a DOM move) still to do in drp (#16), dropzone (DZ-4) and treeview
  (#15). The tests are written as `test.fail`.

### Open questions for the user
Core:
- ~~**ED-11**~~ RESOLVED 2026-10-25 (core: invalid attributes warn + keep the previous value; reflected inputs write it back). Was: an invalid *attribute* value fell back to the default silently; only an invalid
  *property* value warns (`bliss-element.ts:860`). Should the attribute path warn too?

drp:
- #22: should `commit-mode="manual"` stage picks like `apply` (without the button), or commit without closing?
- #19: what is `display-time-format-mask` for?
- #27: should the relative `rolling-year-range` (`-5:+5`) be implemented, or the docs fixed?
- #28: is RTL supported?

treeview:
- Should TV-4 (PageUp/PageDown, Shift-extend) be implemented?
- Does D1 apply to the treeview?
- Close TV-5? It does not reproduce.
- TV-1: which items count as invalid?
- Add `node-expand`/`node-collapse` events (with an async before-hook) for lazy loading?
- Arrow/Enter keys inside the context menu?
- #16: fix the `is-sorted`/`sortCallback` semantics, or document them?

dropzone:
- #11: should the button/minimal selector toggle the popover when there are files?
- DZ-3: implement `value-format` or remove it?
- #12: should `el.addFiles(files, opts)` forward the options?
- Should a `mode` flip keep files, as D1 now does for moves?

grid:
- #4: filtering is API-only and the README promises per-column filters. Build a filter row, or remove the dead code?
- #11: should the `*RowById` methods fall back to `idMember`?
- #13: should Shift+Arrow and Shift+click range extension be added?
- #15: what is the target for "built-ins run after `action`"?
- #26: `editTrigger:'button'` renders no button. Implement it or remove it?
- #33: should the grid move to core `/logging`? It still uses its own copy of loglevel.

cp:
- CP-2: what is the error signal for a failed search?
- CP-3: should save-without-load warn, or just be documented?
- Should errors print by default?
- CP-4: should `open` become an input, or stop being reflected?

editor:
- Fix ED-5 to ED-9 now?
- Is relying on ProseMirror's internal `domObserver` acceptable?
- Commit trailer: `web-editor/CLAUDE.md` asks for `Opus 4.8`, while the session uses `Opus 5.5`.

### Next work packages
1. Answer the questions above.
2. Fix WPs, one per repo, ordered by the list above. Turn each `test.fail` green and remove its marker.
3. D1 lifecycle fix in drp, dropzone and treeview.
4. Optional unit layers (drp, treeview).

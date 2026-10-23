# web-grid — interaction inventory (phase 0)

Read-only pass over `C:\Git\KM\web-grid` (branch `prod`, dirty tree, 2026-10-23). Paths relative
to `packages/web-grid/src/`. Target shape: `../interaction-model-plan.md`.

Architecture: `GridElement` (web-component.ts:313) extends BlissElement with a scalar-only
`static inputs` (:324-401); every callback/item list/`on*` is a plain property proxied to
`this.grid` (`WebGrid`, grid.ts). No `emit()` use. `*Engine` rename candidates: `WebGrid` (public
as `el.grid`), `ToolbarService`, `DropdownService`, `AutocompleteService`, `TooltipService`,
`VirtualScrollService` (wc:433-465), `ScrollEventManager`, `FocusEventManager`,
`ClickEventManager`, `ActionPipelineAdapter` (modules/actions/adapter.ts). No controller facade.

## 1. Item types

### `RowToolbarItem<T>` (types.ts:297-325; `RowToolbarConfig = PredefinedToolbarItem | RowToolbarItem` :328)

| field | type | line | proposed | notes |
|---|---|---|---|---|
| `id` | string (req.) | :299 | `id?` | consumers switch on it |
| `icon` | string (req.) | :302 | `icon?` | |
| `title` | string (req.) | :303 | `tooltip` | also tooltip heading |
| `label` | string? | :304 | `text` | floating only (rendering/table.ts:473) |
| `row` | number? | :307 | layout extra | multi-row |
| `group` | number? | :308 | `{divider:true}` | |
| `minWidth` | string? | :311 | `cssClass` | **bug**: dropped by `normalizeToolbarItems` (toolbar/index.ts:109-123) |
| `type` | `PredefinedToolbarItem?` | :314 | `action?` | **no built-in handler exists** (toolbar/index.ts:67-77 = icon/title/danger only) |
| `danger` | boolean? | :315 | `isDanger` | |
| `disabled` | `boolean \| (row, rowIndex) => boolean` | :316 | `isDisabled` + `getIsDisabledCallback(ctx)` | toolbar/index.ts:242, table.ts:462 |
| `hidden` | same | :317 | `isVisible` + `getIsVisibleCallback` (inverted) | **bug**: floating toolbar ignores it (toolbar/index.ts:241) |
| `tooltip` | `{description?, shortcut?}` | :320, :291 | `tooltip` + `shortcut` | |
| `tooltipCallback` | `(row, rowIndex)` | :321 | `getTooltipCallback(ctx)` | element-handlers.ts:186 (floating only) |
| `onclick` | `({row, rowIndex})` not awaited | :324 | `onClick(ctx)` | element-handlers.ts:416, :475 |

`NormalizedToolbarItem` (:331) internal but exported; `PredefinedToolbarItem` (:278)
`'add'|'delete'|'duplicate'|'moveUp'|'moveDown'` (camelCase vs kebab menu built-ins);
aliases `RowAction`/`RowActionType`/`PredefinedToolbarItemType` (:281, 346, 349);
`RowActionClickDetail` (:350) feeds dead `onrowaction`. `cellToolbar(row, rowIndex, field,
colIndex)` (:587; toolbar/event-listeners.ts:190) → `getCellToolbarItemsCallback(ctx)`.

### `ContextMenuItem<T>` (types.ts:383-394; `ContextMenuConfig` :397)

`id` (req.) → `id?`; `label: string | (ctx) => string` → `text` + `getTextCallback`; `icon`
union → `icon` + `getIconCallback`; `shortcut` (matched only while open, contextmenu/index.ts:395-415);
`disabled` union → `isDisabled` + callback; `visible` union → `isVisible` + callback; `danger` →
`isDanger`; `dividerBefore` → divider entry; `type` → `action` (merged with built-ins
contextmenu/index.ts:35-47; custom `onclick` replaces built-in); `onclick(ctx)` not awaited
(contextmenu/element-handlers.ts:115) → `onClick`. No submenus. `PredefinedContextMenuItem` (:376)
`'expand-all'|'collapse-all'|'expand-tree'|'collapse-tree'` with real handlers (index.ts:53-109),
English labels outside `GridLabels`.

### `HeaderMenuItem<T>` (types.ts:422-435; `HeaderMenuConfig` :438)

Same unions as above; `label` **required**; `children`; `submenu(ctx)` → `getChildrenCallback`;
no `type` (object can't reference a built-in); `dividerBefore` also used as a standalone marker
(contextmenu/index.ts:568). Bugs: built-ins dispatched **by id** (`predefinedActions.includes(itemId)`,
element-handlers.ts:202) → custom `id:'sortAsc'` runs the built-in; submenu children's `onclick`
never called (only top-level searched, :228); `shouldCloseOnClick` hard-coded by id
(`toggle-col-*`, `show-all-columns`, contextmenu/index.ts:834). `PredefinedHeaderMenuItem` (:416)
`'sortAsc'|'sortDesc'|'clearSort'|'hideColumn'|'freezeColumn'|'unfreezeColumn'|'columnVisibility'`
(defs :463-476, executor :663-715, auto-visibility :504-520). Column-visibility children handled by
id-matching duplicated at element-handlers.ts:208-225 and :315-332. Filler header menu
(:252-351) context `column: null, columnIndex: -1`.

### Shortcuts `RowShortcut<T>` (:454), `RangeShortcut<T>` (:490)

`key` → `shortcut`; `id` (links to a toolbar item for the tooltip, element-handlers.ts:181);
`label` → `text` (help overlay shortcuts-help.ts:29); **`action: (ctx) => void`** → `onClick`
(collides with the target `action` field) — called cell-keydown.ts:96, 128, element-handlers.ts:82,
136, container-keydown.ts:94; `disabled` union. `rangeShortcuts` missing from `QuickGridProps`.

## 2. Contexts — none carry `controller`/`element`

| type | fields | line | proposed |
|---|---|---|---|
| `ContextMenuContext` | row, rowIndex, colIndex, column, cellValue | :361 | unify with `ShortcutContext` as `CellContext` (+ field) |
| `HeaderMenuContext` | column, field, columnIndex, sortDirection, isFrozen, isTreeMode, allColumns, labels | :404 | `columnIndex` vs `colIndex` — pick one |
| `ShortcutContext` | = ContextMenuContext | :445 | toolbar-driven shortcuts pass colIndex 0 / cellValue null |
| `RangeShortcutContext` | rows, rowIndices, cellRange?, cells? | :473 | |
| toolbar ctx | `{row,rowIndex}` / positional | :316-324 | `RowContext` |
| `CustomEditorContext` | value, row, rowIndex, field, commit, cancel | :122 | |
| `BeforeCommitContext` | value, oldValue, row, rowIndex, field | :149 | |
| `ValidationTooltipContext` | field, error, value, row, rowIndex | :240 | not exported |
| `OptionRenderContext` | index, isHighlighted, isSelected, isDisabled | :43 | |
| `PaginationLabelsContext`, `SummaryContext`, `TreeChevronContext` | | :746, :791, :963 | |
| `FillDragDetail` | sourceCell, targetCells, direction | :890 | before-style ctx |
| `BeforePasteDetail` | rawText, parsedRows, hasHeaders, headerMapping, targetRowIndex, targetColIndex, newRowsCount, **cancel**, **skipCells** | :911 | mutable-detail cancel |

Not exported: HeaderMenuItem/Context/Config, ContextMenuConfig, Predefined*MenuItem, RowShortcut,
ShortcutContext, ValidationTooltipContext, SummaryContext, Pagination*.

## 3. Events and `on*`

Only DOM event: `rowdelete` `{rowIndex,row}` via raw `dispatchEvent` (cell-keydown.ts:432,
grid-context.ts:97), not bubbling, not composed — duplicate of `onrowdelete`.

| current | signature | fires | called at | proposed | notes |
|---|---|---|---|---|---|
| `onrowchange` | `(RowChangeDetail)` {row, draftRow, rowIndex, field, oldValue, newValue, isValid, validationError} | after commit / checkbox draft / new-row commit | grid.ts:2870, 2930, 2982 | `row-change` / `onRowChange` | setter only (grid.ts:912, wc:906) |
| `onroweditstart` / `onroweditcancel` | `({row,rowIndex,field})` | | grid.ts:2696 / 2712 | `edit-start` / `edit-cancel` | setter only |
| `onvalidationerror` | `({row,rowIndex,field,error})` | invalid commit | grid.ts:2815, 2916; paste/index.ts:427 | `validation-error` | **bug**: setter-only → never fires from paste |
| `ontoolbarclick` | `(ToolbarClickDetail)` {item, rowIndex, row, event, triggerElement} | any toolbar button, after `item.onclick` | element-handlers.ts:421, 480 | **`action` / `onAction`**, source `row-toolbar` | `event`→`sourceEvent`; no dataset; no veto |
| `onrowaction` | | **dead** | grid.ts:212/942; wc:933 | remove | still in README:819, ai/*, showcase ×3 |
| `oncontextmenuopen` | `(ContextMenuContext)` | before cell menu opens | contextmenu/element-handlers.ts:86 | `context-menu-open` or `beforeContextMenuOpenCallback` | can't cancel |
| `onheadercontextmenuopen` | `(HeaderMenuContext)` | before header menu (not filler) | element-handlers.ts:186 | `header-menu-open` | "mutate the items" doc; wc setter only (:795) |
| `ondatarequest` | `(DataRequestDetail)` {sort, page, pageSize, trigger, mode, skip} | sort/page/pageSize/loadMore | grid.ts:2296 | `data-request` | `'init'` never fired; **header-menu sort doesn't fire it** (contextmenu/index.ts:685-694) |
| `onrowdelete` | `({rowIndex,row})` | Ctrl+Delete | cell-keydown.ts:430 | `row-delete` or built-in `action:'delete'` | |
| `onrowfocus` | `(RowFocusDetail)` {rowIndex,row,previousRowIndex} | row focus change | grid.ts:3215 | `row-focus` | |
| `oncellselectionchange` | `({range, cellCount})` | | grid.ts:1789, 1803, 1813 | `cell-selection-change` | no row/column selection events |
| `onbeforepaste` | `(BeforePasteDetail)` mutable `cancel` | before multi-cell paste | paste/index.ts:201 | `beforePasteCallback(ctx)` → `false` | collides with native `onbeforepaste` |
| `onpaste` | `(PasteDetail)` | after multi-cell paste | paste/index.ts:508 | `paste-complete` / `onPasteComplete` | shadows `HTMLElement.onpaste` (defineProperty wc:488) |
| `oncolumnresize` / `oncolumnreorder` | detail | | resize/index.ts:171, reorder/index.ts:351 | `column-resize` / `column-reorder` | |
| `onexpandedpathschange` | `{path, expanded, expandedPaths}` | toggle only | grid.ts:1409 | `expand-change` | not for expandAll/collapseAll/expandSubtree |
| `onfilterchange` | `(filters)` **positional map** | every keystroke / setFilter | grid.ts:2084, 2095 | `filter-change` `{filters}` | setting it switches to server filtering (grid.ts:2037) |
| `onrowlockchange` | `(RowLockChangeDetail)` | lock/unlock by id | grid.ts:3344, 3365 | `row-lock-change` | `source` always `'external'` |
| `editorOptions.onselect` | `(option, row)` | dropdown pick | dropdown/interaction.ts:51 | `onOptionSelect(ctx)` | |
| `_onInteractionChange` | internal | | grid.ts:284 | — | |

## 4. Grid-level callbacks

| current | signature | contract | used | proposed |
|---|---|---|---|---|
| `customStylesCallback` | `()` | CSS | wc:1284 | cross-component |
| `rowClassCallback` | `(row, rowIndex)` | class | table.ts:418, 735 | `getRowClassCallback(ctx)` |
| `paginationLabelsCallback` | `(ctx)` | labels | table.ts:791 | `getPaginationLabelsCallback` |
| `summaryContentCallback` | `(ctx)` | HTML | table.ts:861 | `renderSummaryCallback` |
| `shortcutsHelpContentCallback` | `()` | HTML | shortcuts-help.ts:38 | ctx |
| `validationTooltipCallback` | `(ctx)` | HTML | table.ts:369, 686 | `getValidationTooltipCallback` |
| `cellToolbar` | 4 positional | items | event-listeners.ts:190 | `getCellToolbarItemsCallback(ctx)` |
| `fillDragCallback` | `(FillDragDetail)` sync | `false` cancels | fill-handle/index.ts:518 | `beforeFillCallback(ctx)` async |
| `createRowCallback` | `(pastedData, rowIndex)` | row | paste/index.ts:260 | ctx; **not proxied on element** |
| `createEmptyRowCallback` | `()` async ok | row | grid.ts:2212 | `getEmptyRowCallback(ctx)`? |
| `idValueCallback` | `(row)` | id | grid.ts:3232 | `getRowIdCallback(ctx)` |
| `treeChevronCallback` | `(ctx)` cached | HTML | grid.ts:1524 | `renderChevronCallback` |
| `isRowEditable` | `boolean \| (row)` | | grid.ts:3033 | `isRowEditable` + `getIsRowEditableCallback` |
| `rowLocking.isLockedCallback` / `getLockInfoCallback` | `(row, rowIndex)` | | grid.ts:3296, 3292 | ctx |
| `rowLocking.canEditLockedCallback` | `(row, lockInfo)` | | grid.ts:3457 | ctx |
| `rowLocking.lockTooltipCallback` | | **dead** | | |

Not in `QuickGridProps`: rangeShortcuts, rowLocking, idValueMember, idValueCallback,
onrowlockchange, onrowaction, fillDirection (not proxied), pasteMode, shouldValidateOnPaste,
createRowCallback, onbeforepaste, onpaste, labels, summaryMetadata. Docs say
`contextMenuX/YOffset` 0/4; code 8/0 (grid.ts:169, wc:365).

## 5. Column / editorOptions callbacks

| current | signature | contract | used | proposed |
|---|---|---|---|---|
| `filter` | `(filterValue, row)` | bool/null | grid.ts:2051, 2075 | `filterCallback(ctx)` |
| `cellClassCallback` | `(value, row)` | | cell.ts:83; table.ts:313, 631 | `getCellClassCallback(ctx)` |
| `formatCallback` | `(value, row)` | text | grid.ts:2571 | `getDisplayValueCallback(ctx)` |
| `templateCallback` | `(row)` | HTML | grid.ts:2565 | `renderCellCallback(ctx)` |
| `renderCallback` | `(row, element)` | **dead** | :165 | remove |
| `isEditable` | `boolean \| (row)` | | grid.ts:3025 | + `getIsEditableCallback` |
| `validateCallback` | `(value, row)` async | deprecated | grid.ts:2788 | remove |
| `beforeCommitCallback` | `(BeforeCommitContext)` async | ValidationResult/bool/string/null; `transformedValue` | grid.ts:2780, 2729; paste/index.ts:410 | `false` means *invalid* here — decide: keep as validation (rename `validateCallback`?) or align. **Drift**: paste treats `null` invalid, commit valid |
| `cellEditCallback` | `(CustomEditorContext)` | | custom-editor.ts:77 | `renderEditorCallback(ctx)` |
| `tooltipCallback` | `(value, row)` | | table.ts:352, 669 | `getTooltipCallback(ctx)` |
| `beforeCopyCallback` | `(value, row)` | value | cell-keydown.ts:67 (single cell only) | **`getCopyValueCallback(ctx)`** |
| `beforePasteCallback` | `(value, row)` | value | paste/index.ts:402, 554 | **`getPasteValueCallback(ctx)`** |
| `validationTooltipCallback` | `(ctx)` | | table.ts:369 | `getValidationTooltipCallback` |
| `editorOptions.loadOptions` / `optionsLoadTrigger` | | **dead** | | `getOptionsCallback(ctx)` |
| `editorOptions.searchCallback` | `(query, row, signal?)` | | dropdown/input-handlers.ts:169 | ctx |
| `editorOptions.get{Value,Display,Search,Icon,Subtitle,Disabled,Group}Callback` | `(option)` | | dropdown/options.ts:35-89 | ctx (`getDisabled` → `getIsDisabled`) |
| `editorOptions.renderOptionCallback` | `(option, ctx)` | | dropdown/rendering.ts:63 | single ctx |

## 6. Built-ins

| surface | built-ins | behaviour |
|---|---|---|
| row toolbar | add, delete, duplicate, moveUp, moveDown | none (consumer does the work in `ontoolbarclick`); click handler special-cases delete (close) and move* (keep open) by `item.id` (element-handlers.ts:407, 431) |
| cell menu | expand-all, collapse-all, expand-tree, collapse-tree | real (contextmenu/index.ts:53-109) |
| header menu | sortAsc, sortDesc (Ctrl multi), clearSort, hideColumn, freezeColumn, unfreezeColumn, columnVisibility (`show-all-columns`, `toggle-col-<field>`) | real (index.ts:663-715; element-handlers.ts:200-239); no veto |
| keyboard | Ctrl+Delete → onrowdelete + rowdelete; Delete clears cell; Ctrl+C | cell-keydown.ts:421-440; container-keydown.ts:55 |

Open: toolbar built-ins with no behaviour — implement (add/delete/duplicate/move) or keep as
"icon presets" whose behaviour is the consumer's `onAction`? Built-in action names: camelCase
(`sortAsc`, `moveUp`) vs kebab (`expand-all`) — pick kebab everywhere.

## 7. Facade candidates

Element proxies (wc): setFilter, isCellDirty/isRowDirty, selectRow, selectRowRange,
clearSelection, isRowSelected, getSelectedRowsData, copySelectedRowsToClipboard, selectCellRange,
clearCellSelection, getSelectedCells, copyCellSelectionToClipboard, isPathExpanded,
toggleExpandedPath, expandAll, collapseAll, draft/validation methods (:1151-1159), row/lock methods
(:1162-1178), column width/order (:1181-1187), focusCell, startEditing,
scrollToRowProgrammatically, showGoToRowDialog, openCustomEditor. Internal helpers on the element
to hide: render, renderConnector, clearAllSelections, commitOrCancelEditOnTransition,
updateRowFocusVisual, escapeHtml, getCurrentEditingColumn, getCurrentEditorOptions,
moveFocusAfterCommit. Engine-only (via `el.grid`): expandSubtree, collapseSubtree,
getRowTreeInfo, selectColumn, selectColumnRange, clearColumnSelection, selectAll,
copySelectedColumnsToClipboard, startEdit, cancelEdit, commitEdit, discardCellDraft, moveColumn,
getCellValue, fireDataRequest, setFocusedCell, clearFocusedCell, isCellEditable.

## 8. Tests / docs / showcase

- unit: `grid.tree.test.ts:131-133`, `grid.editability.test.ts`.
- e2e (`C:\Git\KM\web-grid\e2e\` over `docs/test/*.html`): toolbar, contextmenu, column-visibility,
  shortcuts, paste, fill-handle, resize-reorder, selection, validation, basic, datepicker,
  editors, tree-scroll, virtual-scroll.
- docs: examples-toolbar/contextmenu/shortcuts/basic + 14 more, 16 test pages,
  `docs/action-pipeline.md`; `ai/*.txt` (duplicated in `packages/web-grid/ai/`); README props
  :347-368, events :818-823; package README, usage.md, examples.md, CLAUDE.md, FEATURES-NOTES.txt.
- **showcase** `C:\Git\KM\web-grid-showcase\src` — 22 routes, heavy use: contextMenu 36,
  ondatarequest 28, onrowchange 25, headerContextMenu 19, dividerBefore 19, beforeCommitCallback 18,
  fillDragCallback 12, ontoolbarclick 10, rowToolbar 9, rangeShortcuts 8, oncolumnresize 8,
  oncolumnreorder 8, beforePasteCallback 8, rowShortcuts 7, beforeCopyCallback 6, onbeforepaste 6,
  onheadercontextmenuopen 6, cellToolbar 5, onrowaction 3. Must migrate with the grid.

## Drift summary

1. No real events: lowercase `on*` props only; one non-bubbling `rowdelete`; native-name clashes
   (`onpaste`, `onbeforepaste`, `onselect`); positional `onfilterchange` / `onselect`.
2. Three item shapes (toolbar / cell menu / header menu) + shortcuts using `action` as the handler.
3. No unified `action`; `ontoolbarclick` toolbar-only; no veto; toolbar built-ins have no behaviour.
4. Bugs: paste `onvalidationerror` never fires; floating toolbar ignores `hidden`; `minWidth`
   dropped; header submenu `onclick` never called; custom id runs built-in; paste/commit `null`
   disagreement; header sort skips `ondatarequest`; expand events only on toggle; dead
   `onrowaction` / `renderCallback` / `loadOptions` / `lockTooltipCallback`; lock `source` constant;
   offset default doc mismatch; setter-only `on*`.
5. Contracts: copy/paste transforms named before*; `fillDragCallback` sync false; `onbeforepaste`
   mutable cancel; `beforeCommitCallback` false = invalid; menu-open can't cancel; positional args;
   `cellToolbar` lacks suffix.
6. Facade split between element proxies and `el.grid`; unproxied props; unexported types; services
   → `*Engine`.

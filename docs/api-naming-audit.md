# Public API naming audit (2026-10-27)

Read-only audit of the public API names across the KeenMate web components, for the v2
unification (breaking renames allowed, no aliases). Abbreviations: **ms** multiselect, **drp**
daterangepicker, **tv** web-treeview, **svtv** svelte-treeview, **grid**, **dz** dropzone,
**ed** editor, **cp** commandpalette, **core**. Rulebook:
`C:\Git\BlissFramework\guidelines\web-components\naming-conventions.md` (+ `.decisions.md`).

Status: decisions are taken one concept at a time; each decided row is marked **DECIDED**.

## A. Verb glossary (proposed)

| Verb | Meaning | Keep distinct from |
|---|---|---|
| open / close / toggle + `isOpen` | stateful surface that takes focus and is dismissable (dropdown, calendar, dialog, menu, palette, custom editor); rulebook "logical state", `<dialog>.close` | show/hide |
| show / hide + `isVisible` | inline region / indicator, no dismissal, no focus (message, loader, summary, tooltip); rulebook "visual", `hidePopover` | open/close |
| select / deselect | change the value / UI selection set | check |
| check / uncheck | checkbox state, only where distinct from selection (tv) | select, highlight |
| focus | move the keyboard / virtual cursor ("active cell/node/option") | highlight |
| highlight | transient visual emphasis only (search-match marks, scroll flash) — never selection or cursor | focus, select |
| add | put into the collection, component picks the position | insert, create |
| insert | add at an explicit position / anchor | add |
| create | build a new data object (factory callbacks), never mutates the collection | add |
| remove | programmatic removal from the collection (client) | delete |
| delete | user-level destructive command (action id `delete`, Del key, `before*Callback` veto, `*-delete` event) | remove |
| clear | empty a set (selection, search, filters) = "remove all" | reset |
| reset | restore the initial / default state | clear |
| discard | throw away unsaved edits / drafts | cancel |
| cancel | stop an in-flight operation or pending mode (upload, edit, cut) | abort, dismiss |
| abort | only the platform `AbortSignal` (`signal`) in ctx | cancel |
| dismiss | internal: overlay closed without a choice (close reasons) | close |
| update | patch data (partial) | replace |
| replace | swap the whole thing | update |
| refresh | re-render from current data (sync) | reload |
| reload | re-fetch from the source (async, `Promise`) | refresh |
| commit | write a staged edit / selection into the value (method / config verb) | apply |
| apply | only as a button label / action id that triggers commit | commit |
| move | relocate a data item (row / node) | reorder |
| reorder | change order inside a list by UI gesture (columns) | move |
| drag / drop | the gesture events only | move, reorder |
| destroy | final teardown; the only teardown verb | |

## B. Concepts ranked by impact

1. **Selection vocabulary** (ms, drp, tv, svtv, grid, cp). ms `selectValue/deselectValue/toggleValue/selectAll/clearAll/setSelected/getSelected()/getValue()`, element `selectedValue/selectedItem`, action `clear-all`; drp `clearSelection()`, `selectToday()`, controller `getSelectedDate()/…`; grid `selectRow(i,mode)`, `selectRowRange`, `clearSelection()` = rows only + `clearCellSelection()` + `clearColumnSelection()`, element `getSelectedRowsData()` vs controller `getSelectedRows()`, `selectedRows: number[]`; tv select family + check family (`checkNode/checkNodes/checkAll/uncheckNode/clearChecked`, `isCheckedMember`, `cascadeCheckPolicy`); svtv inverted (highlight* = selection, select* = checkbox). → select/deselect + `clearSelection()` everywhere (ms `clearAll` → `clearSelection`, action `clear-selection`); check* stays for tv checkboxes, symmetric; svtv follows tv; grid: `clearSelection()` clears all kinds or explicit names.
2. **Getter style** (ms, drp, grid, dz, tv): element properties (`selectedValue`, `files`, `displayItems`, `selectedRows`, `selectedDate`) vs controller methods for the same data (`getValue()`, `getFiles()`, …); grid `selectedRows` vs `getSelectedRowsData` return different data; cp `setCommands(list)` + `commands`. → same name on both surfaces (readonly getter on controller, property on element); `get*()` only for parameterised lookups / computed snapshots; drop `set*` duplicates of settable properties.
3. **open/close vs show/hide** (ms, drp, cp, grid, tv, dz, core). Mostly consistent. Outliers: grid `showGoToRowDialog` → `openGoToRowDialog`; grid `shouldShowDropdownOnFocus` + `shouldOpenDropdownOnEnter` → `shouldOpenDropdownOn*`; grid `dropdownToggleVisibility`, `toolbarTrigger`; grid `closeContextMenu/closeToolbar` without `open*` vs tv `openContextMenu(path,x,y)`; drp internal `close-message` → `hide-message`. Events: cp emits `open`/`close`, ms + drp emit none (parity gap).
4. **Boolean flag / attribute dialects** (all). Attribute styles: ms short (`show-counter`, `enable-search`), drp + grid configKey-as-attribute (`is-summary-shown`, `is-virtual-scroll-enabled`). Same key → 3 attributes (`isVirtualScrollEnabled`: `enable-virtual-scroll` ms / `virtual-scroll` tv / `is-virtual-scroll-enabled` grid); same attribute → 2 keys (`show-checkboxes`: ms `isCheckboxesShown`, tv `shouldShowCheckboxes`); visibility suffix `is*Shown` / `is*Visible` / `shouldShow*`; ms `isCloseOnSelect` vs drp `shouldCloseOnSelect`. Missing prefixes: drp `disabled`, `enableTransitions`, `fullscreenAutofocus`, `fullscreenInput`; ms/drp `deferRender`; grid `treeDataSorted`; tv `tooltipFollowCursor`. → configKey `is*Shown` (visibility) / `should*` (policy) / `is*Enabled` (feature); attribute always short HTML form; same attribute for the same concept.
5. **Disabled / readonly**: drp configKey `disabled` → `isDisabled` (like dz); ms, tv, grid have no control-level disabled; ms no `formDisabledCallback`; readonly `isReadonly` (drp, ed) vs grid `mode:'read-only'`, enum `cellSelectionMode:'disabled'`. → `isDisabled`/`disabled` + `isReadonly`/`readonly` on every form-associated component; enums use `none`, not `disabled`.
6. **ctx / detail nouns**: ms `ItemContext {item}` in get*Callbacks vs `option` in before-callbacks / events; ms `action` detail has `item` (ActionItem) + `option`; cp `select` `{item, scope}`. → `item` reserved for ActionItem; otherwise domain noun (`option`, `row`, `node`, `file`, `command`, `date`). Unqualified `index` (forbidden): ms render ctx, dz `renderFileItemCallback`, grid `findRowById → {row, index}`. old/new: grid `oldValue/newValue/oldWidth`, dz `prevStatus/nextStatus`, grid `previousRowIndex` → `old*`/`new*`.
7. **remove / delete / clear / discard**: tv `removeNode` vs `deleteNodes` vs `deleteBranch`, `node-delete` after the fact; grid `removeRows`, action `delete`, `row-delete` is only a REQUEST (opposite of tv); dz `removeFile`, `clear()`, `beforeFilesRemoveCallback`, `file-remove` (client) + `file-delete` (server state), `uploaded-deletable`; ms `clearAll`, `clearSearch`. → glossary; grid `row-delete` request-shaped or really delete; pair plurals (dz `addFiles` vs `removeFile`, grid `insertRow` vs `removeRows`).
8. **search / filter / term**: ms `search(term)`, `clearSearch()`, `searchText`, `searchCallback` ctx has `term` AND `searchTerm`, `beforeSearchCallback({term})`; tv `filterNodes(text)`, `searchNodes(text)`, `searchText`; grid `setFilter(field, value)`, `filterCallback({filterValue})`, public `filterInputText(field)`; cp `openWith(query)`, `searchCallback({term})`. → `term` in every ctx, `searchTerm` property, `search(term)`/`clearSearch()`, `openWith(term)`; filter = criteria narrowing, search = match + navigate.
9. **focus vs highlight vs active**: grid `focusCell`, `focusedRowIndex`, `row-focus`; tv `focusNode`, `clearFocus`, `getFocusedNode`, `focus-change`; ms `tabBehavior:'select-highlighted'`; grid editor ctx `isHighlighted`; svtv highlight = selection. → focus = cursor everywhere (`select-focused`, `isFocused`); one event shape (`focus-change` or `<domain>-focus`).
10. **expand / collapse**: tv `expandAll(path?)`, `expandNodes`, `toggleNodeExpanded`, `get/setExpandedPaths`, `node-expand`/`node-collapse`, actions `expand`/`collapse`, `expandLevel`; grid `toggleExpandedPath`, `isPathExpanded`, `expandSubtree/collapseSubtree`, `expandedPaths`, `expand-change {isExpanded}`, actions `expand-tree`/`expand-all`, `defaultExpandDepth`, members `treePathMember/treeLevelMember/treeParentMember` (ms/tv `pathMember/levelMember/parentPathMember`), `treeSeparator` (ms/tv `treePathSeparator`). → grid adopts tv names.
11. **Event names / shapes**: dz `file-upload-complete` (>2 words); dz `files-reject`/`files-change` vs `file-add`; dz `files-change` + `change`, drp `select` + `change` identical detail; grid `edit-start`/`edit-cancel` → `cell-edit-*`; grid `paste-complete` vs tv `node-paste`; tv/svtv parity (`node-drag-reject` vs `onNodeDragDenied`, `node-copy` vs `onCopy`, `selection-change`/`checked-change` vs `onHighlightChange`/`onSelectionChange`); tv `checked-change` vs grid `expand-change`. → `<state-noun>-change` for sets (`selection-change`, `checked-change`, `expanded-change`, `focus-change`), `<domain>-<verb>` for acts, `change` only for the form value.
12. **Member ↔ get*Callback pairs**: ms `disabledMember` + `getIsDisabledCallback` (drp `isDisabledMember`); grid `rowLocking.lockedMember` + `getIsLockedCallback`; svtv `nodeClass`/`nodeContentClass` vs tv `getNodeClassCallback`. → `isDisabledMember`, `isLockedMember`.
13. **Count / limit / size**: dz `maxFileCount`, `maxVisibleFiles`; ms `badgesMaxVisible`, `collapseBadgesBelow`; cp `favoritesLimit`, `recentLimit`; drp `visibleMonthsCount`; virtual scroll ms `optionHeight`/`virtualScrollBuffer`, grid `virtualScrollRowHeight`, tv `virtualRowHeight`/`virtualOverscan`. → `max*`/`min*` + singular noun + `Count`; `*Size` only for bytes / px / `pageSize`; one `virtualScroll*` family.
14. **Messages / labels / empty text**: ms `showMessage(content, {type, autoHideMs})` vs drp element positional `showMessage(content, type, autoHide)`; drp `toggleMessage`, `toggleLoader`; labels: `labels` (ms, grid, cp), drp `customStrings`, dz `STATUS_LABELS` + ~8 `*Text`; "empty" has 5 names (ms `emptyMessage`/`noDataPlaceholder`, dz `emptyMessage`, tv `noDataText`, cp `emptyText`, grid `dropdownNoOptions`). → one `labels` per component (see i18n decision), key `empty`.
15. **update / refresh / reload**: ms `refresh()`, drp `refreshSummary()`, `reloadMonthData()` (only Promise), svtv `refreshNode`, `refreshSiblings`, `update(props)`, tv `updateNode`, grid `updateRowById`/`replaceRowById`, dz `updateFileProgress`. Mostly fits; verify ms `refresh()` doesn't fetch.
16. **cancel / abort / dismiss / discard**: grid `edit-cancel`, `cancel()` in `renderEditorCallback`, `discardDraft(row)` vs `discardRowDraft(rowIndex)`; dz `cancelFile`, status `cancelled` AND validation code `cancelled` for a vetoed add (→ `rejected`); tv `cancelCut`; svtv `cancelDrag`; core `dismissAllOverlays`, `isCancelled`.
17. **commit / apply / confirm**: drp `commitMode` but method `apply()`; grid `shouldCommitOnClickAway`, `commit(v)`; cp `isConfirmationShown`/`renderConfirmationCallback` = post-run feedback (misleading); dz `removeFile(id, {confirm})` = real prompt. → method `commit()`, `apply` only as action id / label.
18. **add / insert / create**: ms `add` event, `beforeAddCallback`, `isAddNewAllowed`; dz `addFiles`, `beforeFilesAddCallback`; tv `addNode`, `insertBranch`; grid `insertRow(row, afterRow)`, `createRowCallback`/`createEmptyRowCallback`, action `add`, `isNewRowEnabled`. Fits; plural in before-callbacks differs.
19. **scrollTo**: ms `scrollToIndex/Value/Group` → `boolean`; tv `scrollToPath` → `Promise<boolean>`; grid `scrollToRowProgrammatically(targetRow)`. → `scrollTo<Thing>` (grid `scrollToRow(rowIndex)`), one return type (`Promise<boolean>`).
20. **destroy / ready / host attributes**: `destroy()` on ms, ed, dz elements; only class/engine in tv, drp; none in grid; ed `getContent` alias of `getValue`; `ready()`/`isReady`/`defer` on ms, drp; host attribute `is-ready` (ms, ed) vs `data-ready` (dz). → all or none expose `destroy()`; one ready attribute.
21. **move / reorder**: grid `moveRow(row, ±1)`, actions `move-up`/`move-down`, `isColumnReorderAllowed` AND per-column `isMovable`, `setColumnOrder`; tv `moveNode`/`moveNodes`; dz `reorder-completed` (auto-sort of completed files). → columns `reorder` (`isReorderable`); dz e.g. `should-sink-completed`.
22. **Lower impact**: form field ms `formFieldId`, drp `formFieldName`, dz `name` → `formFieldName`; tv `selectionMode:'multi'` vs `'multiple'` → `multiple`; bare `mode` in grid, dz, ed with unrelated meanings; CSS parts only in ed, cp, dz satellites, ed `root` vs cp `container`; svtv `ContextMenuItem` `label/onclick/className` vs core `text/onClick/cssClass`; core `OpenMenuOptions.className` vs `cssClass`.

## C. Real semantic differences (keep different names)

select vs check (tv, two sets); filter vs search; remove vs delete; clear vs reset vs discard vs
cancel; show/hide vs open/close; reload vs refresh; insert vs add; grid's three selection kinds
(row / cell / column — separate, explicitly named).

## D. Conflicts with the rulebook as written

1. Enum casing: rulebook says SCREAMING_SNAKE, every component uses kebab (`select-all`, `read-only`); grid also has camelCase values (`mousePosition`, `pageSize`, `loadMore`). Fix the rulebook.
2. Short HTML-shaped attributes rule violated by drp and grid (`is-*` / `should-*`).
3. Boolean prefixes: drp `disabled`, `enableTransitions`, `fullscreenAutofocus`, `fullscreenInput`; ms/drp `deferRender`; grid `treeDataSorted`; tv `tooltipFollowCursor`.
4. Shared `showMessage(content, {type, autoHideMs})`: drp element is positional; grid, tv, dz have none.
5. One ctx, never positional: svtv callbacks positional; ms `selectedOrderCompareCallback(a,b)`; svtv transforms; svtv `onTreeKeydown` returns `true` to suppress (forbidden inverse).
6. Unqualified `index`: ms render ctx, dz render ctx, grid `findRowById`.
7. Bare `data`: tv `data` input, `getAllData()`.
8. Events: `file-upload-complete` (>2 words); core document event `km-overlay-activated` (past tense, prefixed); dz internal `dz-config-changed`.
9. `on*` reserved for event twins (SPEC §12.5): core options `onBeforeCompute`, `onBeforeShow`, `onPlaced`, `onDrift`; if a return value is consumed → `before*Callback`.
10. D-NC-12 (core ActionItem / `action`): dz row actions not on /actions; svtv own menu-item model; cp never uses built-ins (always `action:'custom'`).
11. Stale docs: dz `ai/*.txt` are copies of the multiselect docs; grid `ai/` missing `row-selection-change`, `column-selection-change`, `beforePageChangeCallback`.

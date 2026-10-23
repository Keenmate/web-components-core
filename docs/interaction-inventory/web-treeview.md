# web-treeview — interaction inventory (phase 0)

Read-only pass over `C:\Git\KM\web-treeview` (branch `feature/rc03-svelte-parity`, 2026-10-23).
**TC** = `src/controller/tree-controller.ts`, **CT** = `src/controller/types.ts`, **WC** =
`src/web-component.ts`, **TV** = `src/treeview.ts`, **TY** = `src/types.ts`, **DR** =
`src/renderer/dom-renderer.ts`. Target shape: `../interaction-model-plan.md`.

Internal `TreeController` = TC:75 (`extends EventEmitter<TreeControllerEvents>`), returned by
TV:123 and WC:631 `getController()`.

## 1. Menu items

| current | fields | file:line | proposed | notes |
|---|---|---|---|---|
| `ContextMenuItem` | `id?`, `label`, `icon?` (rendered as **textContent**), `shortcut?`, `isDisabled?`, `isVisible?`, `className?`, `onclick?: () => void\|Promise`, `shouldCloseOnClick?` (default true), `children?` | ltree/types.ts:31-50 | `MenuItem<TreeMenuContext>` | `label`→`text`, `className`→`cssClass`, `onclick()`→`onClick(ctx)`; add `action`, `tooltip`, `isDanger` (today `className:'danger'`), `get*Callback`s |
| `ContextMenuDivider` | `divider: true`, `label?` | ltree/types.ts:26-29 | `{divider:true, text?}` | |
| `ContextMenuEntry` | union | ltree/types.ts:52; TY:15; index.ts:87-89 | `MenuEntry` | |
| built-ins | none (copy/cut/paste/delete only as keys TC:2774-2809 + methods) | — | `action?: 'copy'\|'cut'\|'paste'\|'delete'\|'expand'\|'collapse'…` | |

## 2. Context menu flow

| step | current | file:line | proposed |
|---|---|---|---|
| trigger | body `contextmenu` → `data-tree-path` → `nodeCallbacks.onNodeRightClicked(node, event)` | DR:423-435, 705 | empty-space right-click does nothing |
| gate | `_onNodeRightClicked` requires a renderer or `contextMenuCallbackCb`, then `preventDefault` + `openContextMenu(node,x,y)` | TC:4022-4034 | no open hook/event |
| state | `openContextMenu` / `closeContextMenu`; global click/contextmenu/Esc/scroll close | TC:2883-2900, 3885-3938 | `openContextMenu` only on the engine |
| items | `contextMenuCallback(node, close) → ContextMenuEntry[]` per open — **knows the node** | DR:1676-1687 | `getContextMenuItemsCallback(ctx{node, nodeRef, controller, element, close})` |
| full custom | `renderContextMenuCallback(node, close, container)` | DR:1662-1673 | ctx |
| item render | `renderContextMenuItemCallback(item, node, btn)` (empty btn → default) | DR:1764-1766 | ctx |
| click | leaf, enabled, has `onclick` → `await item.onclick()` (no args); error → console.error; close unless `shouldCloseOnClick===false` | DR:1841-1854 | `onClick(ctx)` → `action` event → built-in; parents open submenu on hover (DR:1797-1840) |
| shortcut | document keydown matches `data-shortcut` vs `e.key` → `.click()` | DR:1868-1893 | no arrow-key menu nav |
| visibility | `isVisible===false` skips; `isDisabled` class; `id` → `data-item-id` | DR:1753-1761 | |

## 3. Contexts (CT)

| current | fields | line | proposed |
|---|---|---|---|
| `NodeRef<T>` | path, node\|null, parent\|null, siblings[] | CT:167-173 (built `nodeRef()` TC:1045) | keep |
| `NodeEventContext<T>` | = NodeRef | CT:179 | `NodeClickEventDetail` etc. + controller/element; also used for drag/drop-denied |
| `NodeDragContext<T>` | NodeRef + event: DragEvent, dragged: NodeRef[] | CT:189-193 | `NodeDragStartEventDetail` / `NodeDragOverEventDetail` |
| `DragStartContext<T>` | lead, dragged, event | CT:205-210 | `BeforeDragStartContext`; **not exported** |
| `DropGroup` | targetPath, position?, paths[] | CT:217-221 | keep; not exported |
| `BeforeDropContext<T>` | target, dragged, position, operation, event | CT:230-236 | keep; not exported |
| `NodeDropContext<T>` | source, target, dragged, dropped, position, operation, event | CT:251-261 | `NodeDropEventDetail` |
| `ClipboardEventContext<T>` | operation?, paths, nodes | CT:270-275 | `NodeCopy/Cut/DeleteEventDetail` |
| `SelectionChangeContext<T>` | paths: Set, nodes | CT:282-285 | `SelectionChange/CheckedChangeEventDetail` |
| `TreeKeydownContext<T>` | event, focusedNode, selectedNodes, controller: **TreeController** | CT:292-297 | `KeydownContext` with the facade |
| `NodeTransformContext<T>` | operation, phase, isRoot, index, position, source, target | CT:312-332 | fold `data` into ctx |
| `BeforeCopyContext` / `BeforeDeleteContext` / `BeforePasteContext` | operation?, paths, nodes / target{path,node}, entries | CT:339-377 | keep + controller/element |
| `NodeRenderContext` | deviceClass, container{w,h}, isExpanded, isChecked, isSelected, isFocused, level, hasChildren | CT:86-97 | single render ctx with `node` + container element |
| `PasteResult<T>` | success, count, skipped, error?, entries?, operation?, targetPath?, position? | clipboard.ts:27-38 | `NodePasteEventDetail` |
| `NodeCallbacks<T>` | engine-internal positional handlers | CT:41-53; exported index.ts:24 | drop from exports |

## 4. DOM events

Bridge at WC:426-431 calls the config `on*` first, then `this.emit(name, detail)` (registered
WC:432-444) — all bubbles + composed. Element map `TreeViewEvents` WC:261-277 types every detail
`unknown`; a typed `TreeEventMap` at TY:495-513 exists but isn't wired.

| current | detail | fired | `on*` twin | proposed | notes |
|---|---|---|---|---|---|
| `node-clicked` | NodeRef | TC:3987; **TC:2102 (checkbox toggle too)** | `onNodeClick` same | `node-click` | checkbox firing it = drift |
| `node-double-click` | NodeRef | TC:4008 (manual 400 ms) | `onNodeDoubleClick` | keep | |
| `copy` | {operation, paths, nodes} | TC:2402 | `onCopy` | `node-copy` / `onNodeCopy` | native composed collision |
| `cut` | same | TC:2445 | `onCut` | `node-cut` | collision |
| `paste` | **`{result: PasteResult}`** | TC:2508 (blocked), 2522, 2554, 2679 | `onPaste(result)` bare — differs (WC:436) | `node-paste`, flat detail | fires even when blocked |
| `delete` | {paths, nodes} | TC:2756 | `onDelete` | `node-delete` | |
| `node-drag-start` | NodeDragContext | TC:4114 | same | keep | |
| `node-drag-over` | NodeDragContext | TC:2969, 4454 | same | keep | high frequency |
| `node-drop` | NodeDropContext | TC:4400 | same | keep | |
| `node-drag-denied` / `node-drop-denied` | NodeRef | TC:4764 / 4810 | same | `node-drag-reject` / `node-drop-reject` | past tense |
| `selection-change` | {paths: Set, nodes} | TC:1790 | same | keep | `silent` suppresses |
| `checked-change` | {paths, nodes} | TC:1802 | same | keep | |
| `tree-changed` | `undefined` | WC:396 (every state-change); **TV:38** dup on inner container | none | `tree-change` + `onTreeChange` | drop TV:38 |
| `focused-node-changed` | {focusedNode} | WC:400 (snapshot diff) | none | `focus-change` + `onFocusChange` | ignores `silent`; `focusNode(_options)` ignores options (TC:2012) |
| `data-changed` | {data} | **never emitted** (TY:507, docs/usage.md:319) | — | delete (or implement `data-change`) | |
| `search-text-changed` | {searchText} | **never emitted** (TY:509) | — | delete (or `search-change`) | |
| (new) `action` | — | — | — | `action` + `onAction`, `source:'context-menu'`, + node/nodeRef | |

Internal engine bus `TreeControllerEvents` (CT:647-651): `state-change` (TC:344, 352),
`config-change` (TC:3880), `data-change` (never emitted).

## 5. `on*`

`onNodeClick`, `onNodeDoubleClick`, `onNodeDragStart`, `onNodeDragOver`, `onNodeDrop`,
`onSelectionChange`, `onCheckedChange` — keep (TY:284-366, WC:219-239). `onCopy`/`onCut`/`onPaste`/
`onDelete` → `onNode*`. `onNodeDragDenied`/`onNodeDropDenied` → `…Reject`. Notes:
- `onTreeKeydown(ctx) → boolean|void` (`true` suppresses) is an **interceptor** →
  `beforeKeydownCallback(ctx)`, `false` cancels (TY:371, CT:555, WC:242; TC:2817-2828).
- `indexingCompleteCallback()` (TY:248) → `index-complete` event + `onIndexComplete`.
- `renderStartCallback` / `renderProgressCallback(stats)` / `renderCompleteCallback(stats)`
  (TY:383-385, TC:890-897) → `render-start` / `render-progress` / `render-complete` + `onRender*`.
- WC `type` strings: `onDelete`/`onSelectionChange` say `unknown`.

## 6. Callbacks

| kind | current | signature | contract | file:line | proposed |
|---|---|---|---|---|---|
| before | `beforeCopyCallback` / `beforeCutCallback` | `(BeforeCopyContext)` sync | `string[]` replace, `false` block | TY:317-320; TC:2380-2424 | async-capable; WC:232-233 type strings wrong |
| before | `beforePasteCallback` | `(BeforePasteContext)` sync | `{targetPath?, position?}` redirect, `false` block | TY:323; TC:2497-2515 | blocked still fires `paste` → must not |
| before | `beforeDeleteCallback` | `(ctx)` sync | `string[]` narrow, `false` | TY:327; TC:2734-2741 | |
| before | `beforeDropCallback` | `(BeforeDropContext)` **async** | `false`, `{position?, operation?}`, `DropGroup[]` fan-out, `true`/void | TY:347; TC:4251-4270 | docs/usage.md:211 shows old 5-arg form |
| before | `beforeDragStartCallback` | `(DragStartContext)` sync | `string[]`, `false` | TY:369; TC:4075-4090 | **must stay sync** (dragstart) — rulebook exception |
| before | `beforeCheckboxToggleCallback` | **`(node, checked, affectedPaths)`** | `false`, `string[]`, `true`/void | TY:277-281; TC:2063-2067 | `beforeCheckToggleCallback(ctx)`; **not in WC INPUTS** |
| menu | `contextMenuCallback` | `(node, close)` | entries | TY:247; WC:201; DR:1678 | `getContextMenuItemsCallback(ctx)` |
| transform | `nodeOutputTransformationCallback` / `nodeInputTransformationCallback` | `(data, ctx)` | data / null skips | TY:330-333; TC:2844-2853, 2533, 4328, 4370 | `data` into ctx; docs/usage.md:246-250 stale names |
| get | `getDisplayValueCallback`, `getSearchValueCallback`, `getIsExpandedCallback`, `getIsCheckedCallback`, `getIsSelectableCallback`, `getIsDropAllowedCallback`, `getIsDraggableCallback`, `getIsCollapsibleCallback`, `getAllowedDropPositionsCallback`, `getNodeTooltipCallback` | `(node)` | | TY:173, 237-245 | `(ctx{node,…})`; getIsExpanded/Checked/Selectable/DropAllowed **missing from WC INPUTS** |
| get (misnamed) | `iconCallback`, `iconColorCallback`, `nodeClass`, `nodeContentClass` | `(node)` | | TY:204-220 | `getIconCallback`, `getIconColorCallback`, `getNodeClassCallback`, `getNodeContentClassCallback` |
| other | `sortCallback` | `(items)` | sorted | TY:246 | `(ctx{items})` |
| render | `renderNodeCallback(node, container, ctx)`, `renderIconCallback(node, value, iconEl, ctx)`, `renderEmptyStateCallback` / `renderEmptyZoneCallback` / `renderLoadingCallback` / `renderHeaderCallback` / `renderFooterCallback(container)`, `renderContextMenuCallback`, `renderContextMenuItemCallback` | positional | | TY:212, 388-400 | single ctx; WC type strings omit ctx |
| other | `customStylesCallback()` | | | WC:194, 467 | cross-component decision |
| other | `initializeIndexCallback()` | | | CT:442 | internal |
| new | `beforeActionCallback` | | | | |

## 7. Facade candidates

Element methods (WC:533-790): expandAll, collapseAll, expandNodes, collapseNodes,
toggleNodeExpanded, filterNodes, searchNodes, scrollToPath, closeContextMenu, getExpandedPaths,
setExpandedPaths, getVisibleFlatNodes, getNodeByPath, getAllData, moveNode, removeNode, addNode,
updateNode (return `any`), copyNodeWithDescendants, moveNodes, duplicateNodes, getTree, getController,
insertBranch, replaceBranch, deleteBranch, select*/check*/clear*/is*, focusNode, clearFocus,
getInsertResult, nav* (11), copyNodes, cutNodes, pasteNodes, cancelCut, deleteNodes,
hasClipboardContent, getClipboardOperation, update(partial), renderer.

TV-only: applyChanges, getTreeNodes, getConfig (stub `{}`), setRenderer.
Engine extras: on/emit/offAll, tree, nodeCallbacks, nodeRef, getChildren, getSiblings,
refreshSiblings, refreshNode, openContextMenu, handleKeydown, drag/touch primitives, ~60 config
accessors incl. focusedNode/selectedPaths/checkedPaths/cutPaths, `contextMenuCallbackCb`.

Consumers reaching into the engine: examples-interaction.html:695, examples-tree-editor.html
(295, 304, 478, 554, 647, 677, 683, 688 — `.focusedNode`, `.getSiblings`), `TreeKeydownContext`,
`TreeViewRenderer.mount(container, controller: TreeController)` (renderer/types.ts:13 — keeps the engine).

**Facade** = element method set + `getFocusedNode()`, `getChildren`, `getSiblings`, `nodeRef`,
`applyChanges`, `openContextMenu(path, x, y)`; hide drag/touch/virtual/`updateProps`/`getSnapshot`.
Exports: index.ts:21-22 export `TreeController`/`EventEmitter`; missing `BeforeDropContext`,
`DragStartContext`, `DropGroup`, `SelectMode`, `TreeMutationOptions`, `CheckboxMode`, `CascadeCheckPolicy`.

## 8. Tests / docs to update

- No unit tests; e2e only: `context-menu.spec.ts:82-211`, `silent-selection.spec.ts`,
  `feature-port.spec.ts` (on*/before*, "onPaste fires when blocked"), `clipboard-extended.spec.ts`,
  `drag-drop.spec.ts:51`, interaction, keyboard-nav, selection-focus, checkbox-mode, member-props,
  basic, branch-operations.
- fixtures: `test/context-menu.html:86-124`, `feature-port.html:72-92`, `clipboard-extended.html:70-96`,
  `drag-drop.html`, `basic.html`, `interaction.html`, `silent-selection.html`, `keyboard-nav.html`,
  `selection-focus.html`, `checkbox-mode.html`, `member-props.html`.
- docs: `docs/usage.md:206-250, 300, 303-321`, `docs/examples.md:96, 246-290`, `CLAUDE.md:~160-190`,
  README:32; generated `web-types.json`, `custom-elements.json`, `vscode.html-custom-data.json`.
- examples: context-menu (57), tree-editor (44), logging (23), interaction, basic, drag-drop, …;
  `scripts/rename-selected-checked.mjs`.

## Drift summary

1. Static menu, no ctx, `onclick()` no args, no built-ins/`action`/veto; `label`/`className`/`onclick` names; icon as text.
2. Positional callbacks: checkbox-toggle, contextMenu, render*, transforms, every get*, sort, onPaste.
3. Interceptors: only drop async; `onTreeKeydown` inverted interceptor; blocked paste still emits; checkbox-toggle not settable.
4. Events: past tense ×5; native collisions copy/cut/paste (delete is fine but renamed for symmetry); two phantom events; no twins for tree/focus change; paste detail wrapped; checkbox fires node-click; tree-changed dispatched twice.
5. No controller/element on details; event map `unknown`.
6. Engine public (`getController`, export, keydown ctx, examples).
7. INPUTS gaps + wrong CEM type strings.
8. Stale docs (5-arg beforeDrop, old transform names, phantom events).

# web-multiselect — interaction inventory (phase 0)

Read-only pass over `C:\Git\KM\web-multiselect` (2026-10-23). Key files: `src/types.ts`,
`src/multiselect.ts` (engine `WebMultiSelect`), `src/web-component.ts` (`MultiSelectElement`),
`src/index.ts`. Target shape: `../interaction-model-plan.md`.

## 1. Action items

| current | fields / signature | file:line | proposed | notes |
|---|---|---|---|---|
| `ActionButton<T>` | `action: 'select-all'\|'clear-all'\|'custom'` (required), `text`, `cssClass?`, `row?`, `tooltip?`, `isVisible?`, `isDisabled?`, `onClick?`, `getIsVisibleCallback?`, `getIsDisabledCallback?`, `getTextCallback?`, `getClassCallback?`, `getTooltipCallback?` | types.ts:363-399 | `ActionItem<ActionContext>` (`action?` = `'select-all'\|'clear-all'`), + `id`, `icon`, `shortcut`, `isDanger`, `getIconCallback`; keep `row?` as a layout extra | custom buttons keyed only by index (`data-button-index`) |
| `onClick` | `(multiselect: any, ctx?) => void\|Promise` | types.ts:388; multiselect.ts:2678 | `onClick(ctx)` | 1st arg leaks the engine; only for `custom` (:2673-2679); promise not awaited |
| `getIsVisibleCallback` / `getIsDisabledCallback` / `getTextCallback` / `getClassCallback` / `getTooltipCallback` | `(ms, ctx?)` | types.ts:390-398; multiselect.ts:1594, 1602, 1610, 1614, 5585 | `(ctx)` | disabled precedence callback > static > built-in (1565-1574); text inserted **unescaped** (1621); tooltip fallback `find(action)` (5581) |
| internal `data-action` | `add-new`, `show-selected`, `clear-count`, `remove-hidden`, `remove` | multiselect.ts:1837, 2053-2095, 2661-2682, 2744-2790 | separate internal namespace (e.g. `data-ms-action`) from user `action`/`id` | handler at :2661 treats **any** `[data-action]` as a button → `renderOptionContentCallback` markup with `data-action` gets hijacked |

## 2. Contexts and facades

| current | fields | file:line | proposed / notes |
|---|---|---|---|
| `ActionContext<T>` (extends `PresentationContext`) | `button`, `selectedValues`, `selectedOptions`, `options`, `selectedCount`, `optionCount`, `isOpen`, `searchTerm`, `controller`, `element` + presentation | types.ts:307-328; multiselect.ts:3059-3074 | `button`→`item`; + `action`, `id`, `source`, `sourceEvent`, `triggerElement`, `dataset`. Runtime `controller` is the **keyboard** controller (:3070) |
| `MultiSelectKeydownContext<T>` | `event`, `key`, `isOpen`, `presentation` (`'floating'\|'fullscreen'`), `searchTerm`, `focusedIndex`, `focusedOption`, `filteredOptions`, `selectedValues: ReadonlyArray<string>`, `controller: MultiSelectKeyboardController` | types.ts:336-357; multiselect.ts:2511-2522 | `KeydownContext` + element + full presentation; `selectedValues` type differs from ActionContext |
| `OptionContentRenderContext` | index, isSelected, isFocused, isMatched, isDisabled, tree fields (isTreeNode?, isBranch?, isLeaf?, childCount?, level?, depth?, path?, isSelectable?, isIndeterminate?) + presentation | types.ts:145-176 | + `item`, controller, element (single arg) |
| `BadgeContentRenderContext` | displayMode, isInPopover + presentation | types.ts:181-186 | + item, controller, element; sometimes absent |
| `SelectedContentRenderContext` | = PresentationContext | types.ts:193 | + item, controller, element |
| `GroupLabelRenderContext<T>` | groupName, members, selectedMembers, selectedCount, memberCount, selectableCount, checkState + presentation | types.ts:207-222 | + controller, element; groupName also positional |
| `SearchTermContext` (core) | target, behavior, match | types.ts:15,19; multiselect.ts:400-406 | + `term` |
| `SearchCallbackContext<T>` (core) | searchTerm, entries (lazy) | multiselect.ts:2448-2451 | + `term`, `signal` — **core `/search` type change** |
| `MultiSelectController<T>` | getSelected, getValue, getOptions, setSelected(values,{notify}), selectAll, clearAll, toggleValue, open, close, toggle, search, clearSearch, scrollToValue/Group/Index, showMessage, hideMessage | types.ts:230-267 | keep as facade; claims to mirror element methods but element lacks selectAll/clearAll/toggleValue (web-component.ts:903-1054); `scrollTo*` return boolean on element, void here |
| `MultiSelectKeyboardController<T>` | above + focusNext/Previous/First/Last/PageUp/PageDown/NextMatch/PreviousMatch, focusIndex, toggleFocused, selectValue, deselectValue, setSearch (deprecated) | types.ts:274-297; multiselect.ts:2988-3043 | one controller, keyboard methods as a keydown-only extension type |
| `WebMultiSelect` | engine, exported index.ts:12 | multiselect.ts:57 | → `MultiSelectEngine`, stop passing to callbacks |
| `VirtualScroll` | engine | virtual-scroll.ts:42 | → `VirtualScrollEngine` |

## 3. DOM events

All via `BlissElement.emit` (bubbles + composed by default); EVENTS web-component.ts:270-276.

| current | detail | emitted | proposed | notes |
|---|---|---|---|---|
| `select` | `MultiSelectEventDetail`: option, selectedOptions, selectedValues | web-component.ts:662 (bridge from engine `onSelect`, multiselect.ts:3571) | `select` / `SelectEventDetail` + controller/element/presentation | Select-All emits one per item |
| `deselect` | same | web-component.ts:669 (:3574) | `DeselectEventDetail` | Clear-All per item |
| `change` | selectedOptions, selectedValues | web-component.ts:676 (:3577, setSelected notify :4973) | `ChangeEventDetail` | no source/reason |
| `add` | value, option?, selectedOptions, selectedValues | web-component.ts:682 (engine `onAddNew` :3404) | `AddEventDetail` | fires even when no option created |
| `ready` | `undefined` | web-component.ts:591 | `{controller, element}` | missing from web-types.json |
| (missing) `action` | — | — | `action` + `onAction` + `beforeActionCallback` | no click event today; built-ins not observable/vetoable |
| `MultiSelectEventDetail<T>` | catch-all | types.ts:1107-1116 | split per event | |

## 4. `on*`

| current | signature | file:line | proposed |
|---|---|---|---|
| engine `onSelect` / `onDeselect` | `(option)` | types.ts:1013-1015; multiselect.ts:3571, 3574 | `(detail)` |
| engine `onChange` | `(selectedOptions[])` | types.ts:1017; :3577, :4973 | `(detail)` |
| engine `onAddNew` | `({value, option?})` | types.ts:1002; :3404 | `onAdd(detail)` |
| element `onSelect`/`onDeselect`/`onChange`/`onAdd`/`onReady` | `(e: CustomEvent)` (core managed) | web-component.ts:323-327 (comment :259-262 admits the clash) | `(detail)` — core change |
| legacy `MultiSelectOptions.on*` | bare args, deprecated | types.ts:1146-1148 | remove |
| missing engine `onReady`, `onAction` | | | add |

## 5. before* / interceptors

| current | signature | contract | file:line | proposed | drift |
|---|---|---|---|---|---|
| `beforeSelectCallback` | `(option, selectedOptions)` sync | `false` vetoes; string vetoes + warning toast | types.ts:956; multiselect.ts:3308 | `(ctx{option, selectedOptions, source, …})` async, `false`/value | bypassed by Select-All, setSelected, group cascade, toggleGroup (3450, 3496) |
| `beforeDeselectCallback` | same | same | types.ts:966; :3334 | same | bypassed by Clear-All, inline ✕ |
| `beforeSearchCallback` | `(term) → string\|null` | `null` cancels, string replaces | types.ts:931; :2260 | `(ctx{term})` `false` cancels | |
| `keydownCallback` | `(ctx) → boolean\|void` | `true` = handled | types.ts:1011; :2511-2523 | `beforeKeydownCallback(ctx)` `false` suppresses built-in | inverted contract |
| `addNewCallback` | `(value) → T\|null\|Promise` | `null` cancels | types.ts:996; :3366 | `beforeAddCallback(ctx{value})` → `T\|false` async | |
| (missing) `beforeActionCallback` | | | | new | |

String-as-message in before-select: replace with `ctx.controller.showMessage(…)` + `return false`.

## 6. get*Callbacks — all `(item[, ctx])` → `get…Callback(ctx{item, …})`

`getValueCallback` (types.ts:420), `getDisplayValueCallback` (:425), `getBadgeDisplayCallback`
(:434, ctx sometimes absent), `getSelectedOrderCallback` (:452), `selectedOrderCompareCallback(a,b)`
(:454 — comparator; decide exception), `getFullTitleCallback` (:464), `getBadgeClassCallback`
(:471), `getSearchValueCallback` (:490), `getIconCallback` (:495), `getSubtitleCallback` (:508),
`getPathCallback` (:524), `getIsSelectableCallback(node: LTreeNode)` (:546 — tree node, not item),
`getGroupCallback` (:570), `getDisabledCallback` (:592 → `getIsDisabledCallback`),
`getSelectedItemClassCallback` (:626), `getValueFormatCallback(selectedValues)` (:650),
`getAddNewTextCallback(value)` (:708), `getSearchTermCallback(term, ctx)` (:946),
`getCounterCallback(count, moreCount?)` (:1023), `getCountLabelCallback(selected, total)` (:1033),
`getBadgeTooltipCallback` (:1046), `getRemoveButtonTooltipCallback` (:1051),
`getOptionTooltipCallback` (:1075). CEM `type` strings at web-component.ts:227-240 omit the ctx arg.

## 7. render* / other

| current | signature | file:line | proposed |
|---|---|---|---|
| `renderOptionContentCallback` | `(item, ctx)` | types.ts:599; :1678, 1795 | `(ctx{item,…})` |
| `renderBadgeContentCallback` | `(item, ctx)` | types.ts:601; :4824 | ctx |
| `renderBadgeCallback` | `(item, ctx) → string\|HTMLElement\|null` | types.ts:612; :4806 | ctx; remove via `data-action="remove"` collides |
| `renderSelectedItemContentCallback` | `(item, ctx)` | types.ts:619 | ctx |
| `renderSelectedContentCallback` | `(item, ctx)` | types.ts:633; :1975 | ctx |
| `renderGroupLabelContentCallback` | `(groupName, ctx)` | types.ts:577; :1334 | ctx |
| `searchCallback` | `(term, signal, ctx)` async | types.ts:979; :2452 | `(ctx{term, signal, entries})` |
| `customStylesCallback` | `()` | types.ts:473; web-component.ts:717 | cross-component decision (drp same) |

## 8. Tests / docs to update

- e2e: `action-buttons.spec.ts` (:41-131), `events-api.spec.ts` (:55, :64), `keyboard.spec.ts`
  (:196-230), `search.spec.ts` (:582), `single-select-events.spec.ts` (:74-76),
  `options-update.spec.ts` (:123, :160), clear-button :61, group-select :99, tree-cascade :102,
  add-new, counter, custom-rendering, groups, mobile-features, external-search, search-debounce, builder.
- fixtures: `test/action-buttons.html` (15), `events-api.html` (7), `search.html`,
  `single-select-events.html`, `tab-behavior.html`, `defer-gate.html`, `options-update.html`, `tree.html`.
- unit: `before-select.test.ts` (positional), `defer-gate.test.ts`, `search-abort`,
  `search-debounce`, `tree-async-search`, `placeholder`, `set-attributes`.
- CEM sources: web-component.ts INPUTS `type`/`description` (:213, :217-256), EVENTS (:263-276);
  generated `custom-elements.json`, `web-types.json` (no `ready`), `vscode.html-custom-data.json`.
- exports `src/index.ts` :12, :58, :76-79.
- docs: README, `docs/usage.md` (46), `docs/examples.md` (47), `docs/api-reference.html`,
  `docs/accessibility.md`, `FEATURES.md`, `MIGRATION-STATUS.md`; `ai/*.txt` (action-buttons 56,
  custom-rendering 36, events-callbacks 31, search-features 28, typescript-types 16, …);
  `examples-*.html` (action-buttons 100, events-callbacks 40, custom-rendering 36, data-api 33, basic 32, …).

## Drift summary

- Engine leaks: every item callback is `(engine, ctx?)`; `WebMultiSelect` exported.
- Built-in buttons unobservable: `onClick` only for `custom`; no `action` event / veto.
- Item fields missing (`id`, `icon`, `shortcut`, `isDanger`); index keying; unescaped text.
- Shared `data-action` namespace hijacks rendered content.
- Runtime controller is the keyboard one; controller ≠ element methods.
- Two `on*` contracts with the same names (engine bare args vs element CustomEvent); neither gets the detail; `onAddNew` vs `add`.
- Details: no controller/element/presentation; one catch-all detail; `ready` empty.
- before* contracts: `false|string`, `null`, `null/undefined`, `true` — four different cancel sentinels; only add is async.
- Bulk ops bypass vetoes but still emit per-item events.
- Positional args nearly everywhere in get*/render*/search.
- `getDisabledCallback` naming; `getIsSelectableCallback` gets a tree node.
- Engine classes not `*Engine`.
- `actionButtons` description claims defaults that don't render.

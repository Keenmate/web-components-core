# Unified interaction model — plan

Started 2026-10-23. Goal: every Keenmate component exposes action items (buttons, toolbars,
menus), callback contexts and events in **one shape**, defined and checked by core. Breaking
changes are accepted; they ship together with the rc15 renames (see `code-review-plan.md`).

## Why

The same concepts are re-implemented per component and have drifted:

- **Action items** — 6 flavours: ms `ActionButton`, drp `ActionButton`, grid `RowToolbarItem`,
  grid `ContextMenuItem`, grid `HeaderMenuItem`, treeview `ContextMenuItem`. Different names for
  text (`text` / `title` / `label`), visibility (`isVisible` / `visible` / `hidden`), dynamic values
  (`get*Callback` vs `bool | fn` unions vs static only), handler (`onClick(ms, ctx?)` / `onClick(ctx)`
  / `onclick({row})` / `onclick()`), dividers (`group` / `dividerBefore` / divider entry).
- **Contexts** — escape hatch is `element` (ms), `picker` (drp), raw row (grid) or nothing
  (treeview); only ms/drp extend `PresentationContext`; "controller" means a public facade in
  ms/drp but the internal state engine in treeview.
- **Events** — names: `date-select`, `cp-select`, `node-clicked` vs `node-double-click`,
  grid's lowercase `onrowdelete` props, camelCase `onNodeClick`. Payloads: drp shares one detail
  between `onSelect` and its DOM event; treeview's typed event map says `unknown`; grid passes
  a different ad-hoc object to each handler; none carry `controller` / `element`.

## Decided

1. **The ms/drp pattern is the standard.** Static field + separate `get*Callback(ctx)` for the
   dynamic version; callbacks take **one** argument, `ctx`. No `bool | fn` unions.
   - ms `onClick(multiselect, ctx?)` → `onClick(ctx)`.
   - drp `isVisibleCallback` / `isDisabledCallback` → `getIsVisibleCallback` / `getIsDisabledCallback`.
   - Booleans follow is/should/has/can (`isDanger`, not `danger`; no `hidden`).
2. **Breaking is OK** — clean renames, no deprecated aliases (same as the rc15 renames).
3. **Dividers are their own entry**, never a flag on an item: `{ divider: true, text? }`
   (+ `createMenuDivider(text?)` factory). Plain object, not a class, so JSON / data-attribute menus
   work. Grid's `dividerBefore` and toolbar `group` go.
4. **Children are flexible:** static `children`, or `getChildrenCallback(ctx)` returning entries
   **or a Promise** (lazy submenu, loading row until it resolves). Callback wins. Any depth;
   items and dividers mix. An item with children opens its submenu and never closes the menu.
5. **Context is generic.** `ActionItem<Ctx>` knows nothing about `Ctx`; each surface defines its
   own (grid row menu: `row`, `rowIndex`, `column`, `colIndex`, `cellValue`; treeview menu:
   `node`; …). The context is built when the menu/toolbar opens for that row/node and the same
   object goes to every callback and to `onClick` — no closures needed.
6. **String shorthand everywhere:** a built-in action may be a bare string in any item array
   (`rowToolbar: ['add', 'delete']`, `actionButtons: ['today', 'clear']`); core expands it to
   `{ action }` before resolving. New for ms/drp.
7. **Event helper is `emitWithCallback(name, detail)`** (not `notify` — too vague).

## Decided (event safety + hooks)

8. **`before*Callback(ctx)` contract, everywhere:** one `ctx` argument, may be async; return
   `false` → cancel, nothing → continue unchanged, a replacement → continue with that
   (treeview `beforeCopyCallback` returning a narrowed `string[]` is the model). Inventory
   today: drp async + result object, grid `beforeCommitCallback` async, treeview sync
   `string[] | false`, ms positional `(option, selectedOptions)` → `boolean | string`.
9. **Per-value transforms are `get*Callback`, not `before*`.** Grid column
   `beforeCopyCallback(value, row)` / `beforePasteCallback(value, row)` run per cell and can't
   cancel → `getCopyValueCallback({ value, row, column })` / `getPasteValueCallback({ text, row,
   column })` (like `getDisplayValueCallback`); JSDoc says when it runs.
10. **Component events are `composed: false`, dispatched on the host** (core `dispatch()` default
    changes from `composed: true`). A component on the page still bubbles through the page; one
    nested in another component's shadow DOM (e.g. an ms cell editor inside grid) can't leak
    out and be mistaken for the outer one (retargeting would report the outer host as
    `e.target`). Slotted components still bubble with the right `e.target`. Phase 1.
11. **No event name may reuse a native event that crosses shadow DOM** (`click`, `focus*`,
    `key*`, `pointer*`, `input`, `copy` / `cut` / `paste`, …). Treeview `copy` / `cut` / `paste`
    collide today (a page `copy` listener gets the native ClipboardEvent *and* treeview's) →
    `node-copy` / `node-cut` / `node-paste`. Non-composed natives (`select`, `change`) are fine.
    The rename doesn't touch clipboard behaviour (grid uses the system clipboard; grid A → grid B
    / Excel already works).
12. **`action` is reserved for built-ins.** Custom items are `action: 'custom'` + `id`; the event
    detail carries both (`if (e.detail.id === 'archive')`). A future built-in can never hijack a
    custom item. Grid used `id` loosely for both → changes.
13. **Reserved detail names checked at compile time:** core's types reserve `action`, `item`,
    `id`, `source`, `sourceEvent`, `triggerElement`, `dataset` (+ `controller`, `element`,
    presentation fields); a surface context that redeclares one fails to compile. Context stays
    flat (`onAction(({ row }) => …)`), not nested.

## Proposed core shape (`@keenmate/web-components-core/actions`)

```ts
interface ComponentContext<C, E extends HTMLElement = HTMLElement> extends PresentationContext {
  controller: C;      // the component's public facade
  element: E;         // the host element (escape hatch)
}

interface ComponentController {           // base; components extend
  showMessage(content: string | HTMLElement, opts?: { type?: MessageType; autoHideMs?: number }): void;
  hideMessage(): void;
}
interface OpenableController { open(): void; close(): void; toggle(): void; readonly isOpen: boolean; }

interface ActionItem<Ctx, A extends string = string> {
  action?: A; id?: string; text: string; icon?: string; tooltip?: string; shortcut?: string;
  cssClass?: string; isVisible?: boolean; isDisabled?: boolean; isDanger?: boolean; isActive?: boolean;
  getTextCallback?(ctx: Ctx): string;        getIconCallback?(ctx: Ctx): string;
  getTooltipCallback?(ctx: Ctx): string;     getClassCallback?(ctx: Ctx): string | string[];
  getIsVisibleCallback?(ctx: Ctx): boolean;  getIsDisabledCallback?(ctx: Ctx): boolean;
  getIsActiveCallback?(ctx: Ctx): boolean;
  onClick?(ctx: Ctx): void | Promise<void>;
}
interface MenuItem<Ctx, A> extends ActionItem<Ctx, A> {
  children?: MenuEntry<Ctx, A>[];
  getChildrenCallback?(ctx: Ctx): MenuEntry<Ctx, A>[] | Promise<MenuEntry<Ctx, A>[]>;
  shouldCloseOnClick?: boolean;   // default true
}
interface MenuDivider { divider: true; text?: string }
type MenuEntry<Ctx, A> = MenuItem<Ctx, A> | MenuDivider;

resolveActionItem(item, ctx)    // → { text, icon, tooltip, cssClass, isVisible, isDisabled };
                                //   callback wins; a throwing callback is logged, static fallback
resolveMenuEntries(entries, ctx) // drops hidden items, trims leading/trailing/double dividers
createMenuDivider(text?)
```

## Events — same shape as callbacks

Every user-facing happening (node focused, date picked, row changed, file added, action
clicked) is **one event with one detail type**, delivered two ways that can't drift:

- the DOM `CustomEvent` (via `BlissElement.emit`, typed event map — no `unknown`), and
- the matching `on*` config notification, called with **the same detail object**
  (drp's "re-emit the canonical detail" pattern, generalised).

Detail = event-specific fields **+ `ComponentContext`** (`controller`, `element`, presentation
flags), so a handler can act without reaching for the element. Core helper on BlissElement:
`this.emitWithCallback(name, detail)` → adds the context, calls `config.on<Name>(detail)`, then
emits the DOM event with the same object. Plain `this.emit()` stays for DOM-only events
(`ready`, anything without a config notification).

Veto hooks stay callbacks (`before*Callback(ctx)` → `false` cancels) and get the same context
base. Naming to settle (see questions): event names kebab-case, present tense, no component
prefix (`node-click`, `date-select`, `row-change`), notification `onNodeClick` / `onRowChange`.

## Phases

0. **Inventory** (no code) — per component: every action item type, every callback context,
   every DOM event + `on*` notification + `before*Callback`, with current name → new name and
   detail fields. Output: a table per component appended here. Settle open questions.
1. **Core `/actions` + event helper** — `dispatch()` default `composed: false`; types, `resolveActionItem`, `resolveMenuEntries`,
   `createMenuDivider`, `emitWithCallback()` on BlissElement; unit tests; SPEC §12.x section; CLAUDE.md note;
   CEM/web-types: event descriptions generated from the detail types where possible.
2. **web-daterangepicker** — `ActionButton` → `ActionItem`; `custom-action` → unified action
   event; contexts on `ComponentContext` (keeps `picker` as an extra); events/notifications.
   Fixes the stale `context-callbacks.spec.ts:77` + `web-component.ts:202` description.
3. **web-multiselect** — `onClick(ctx)`; `ActionContext` on `ComponentContext`; `showMessage`
   opts; events/notifications.
4. **web-treeview** — context menu → `MenuEntry` with `node` context + callbacks; rename the
   internal `TreeController` (e.g. `TreeEngine`) and add a public controller facade; event map
   typed; `node-clicked` & co renamed; `on*` share the event detail.
5. **web-grid** — row toolbar, row context menu, header menu → `ActionItem` / `MenuEntry`
   (unions → callbacks, `danger`/`hidden`/`dividerBefore`/`group` gone, `onclick` → `onClick`,
   header submenu → `children` / `getChildrenCallback`); lowercase `on*` props → camelCase
   notifications sharing the event detail; public controller facade.
6. **dropzone, commandpalette, editor** — events/notifications/contexts only (no action items
   today); `cp-*` prefix decision applies to commandpalette.
7. **rc15** — publish core, switch components from `file:`, release notes with one migration
   guide covering renames + interaction model.
8. **Consumers** (showcases, LiveView wrappers, test apps) — separate plan:
   `docs/consumer-migration-plan.md`.

Each component: own commit(s), CHANGELOG entry with a migration section, tests updated
(unit + e2e), docs/README/web-types regenerated.

## Rulebook

The decisions are written into the BlissFramework rulebook (read when scaffolding a component):
`C:\Git\BlissFramework\guidelines\web-components/naming-conventions.md` (+ `.decisions.md`
D-NC-6/8/11/12, `.checks.md` / `.checks.sh` C-NC-2 now covers `emit()` / `emitWithCallback()`,
past tense, composed-native names, component prefix). BlissFramework is not a git repo — a
backup of the previous files is in `%TEMP%/bliss-naming-backup-20261023-203855`.

## Decided (round 3)

14. **One `action` event (option A).** Every component fires `action` (DOM event + `onAction`
    via `emitWithCallback`) for every clicked item. Detail: `action`, `id`, `item`, `source`
    (`'action-buttons' | 'row-toolbar' | 'context-menu' | 'header-menu' | …`), `sourceEvent`,
    `triggerElement`, `dataset` (button `data-*`), plus the surface's context. Replaces drp
    `custom-action` / `onCustomAction` and grid `ontoolbarclick`; ms and treeview gain it.
    Reason: HTML-authored buttons (drp `showMessage` content) have no `onClick`; frameworks /
    LiveView / htmx bind DOM events; one listener for all actions.
    a. fires for built-ins too (`today`, `select-all`, `delete`), not only `custom`;
    b. `beforeActionCallback(ctx)` → `false` cancels the built-in; may be async; the item is
       busy while waiting (second click ignored);
    c. order: item `onClick` → built-in behaviour → `action` event (2026-10-26, #15: the event
       is a notification after the fact — listeners see the state the built-in left).
15. **`controller` = public facade only**; internal state classes are `*Engine` (treeview
    `TreeController` → `TreeEngine`). In the rulebook.
16. **Event names:** kebab-case, present tense, no component prefix (`node-click`, `select`
    not `cp-select`), never a composed native name (rule 11). In the rulebook + C-NC-2 check.
17. **`on*` twins are camelCase** (`onRowChange`; grid's `onrowchange` goes). In the rulebook.
18. **Every event carries `controller` + `element`** (incl. `ready`, `data-change`); the
    presentation fields (`presentation`, `isFullscreen`, `isModal`) only on popup components
    (ms, drp, commandpalette) — inline components don't have them. `emitWithCallback` adds
    them. `controller` / `element` are **non-enumerable** on the detail: destructuring works,
    `JSON.stringify` / LiveView `pushEvent(…, e.detail)` / `Object.keys` / logs see only data
    (spread `{...detail}` drops them — accepted). Presentation fields stay enumerable.

No open questions. Next: phase 0 (inventory).

## Phase 0 — how to run it, and what's already known

Run as one read-only agent per component (ms, drp, treeview, grid, dropzone, commandpalette,
editor) in parallel; each returns a table: current name → new name, kind (action item / context /
event / `on*` / `before*` / `get*`), current signature, detail fields, file:line. Merge here.

Already found (don't re-derive):
- **ms** `src/types.ts`: `MultiSelectController` (:230), `MultiSelectKeyboardController` (:274),
  `ActionContext` (:307, has `element`), `ActionButton` (:363, `onClick(multiselect, ctx?)`,
  `getIsVisibleCallback`…). Events via `this.emit`: `select`, `deselect`, `change`, `add`, `ready`.
  `beforeSelectCallback(option, selectedOptions)` / `beforeDeselectCallback` positional →
  `boolean | string`; `beforeSearchCallback(term)`.
- **drp** `src/types.ts`: `PickerContext { picker }` (:11), `DateRangePickerController` (:23),
  `ActionButton` (:236, `isVisibleCallback` / `isDisabledCallback`), `ActionButtonContext`
  (:278), `CustomActionEventDetail` (:964). `custom-action` fired in `date-picker.ts:2557`
  (`fireCustomActionEvent`, BEFORE `onClick`), detail `{ data, picker, controller }`; stale
  test `e2e/context-callbacks.spec.ts:77` + description `web-component.ts:202`. Events:
  `date-select`, `change`, `custom-action`, `ready`. `beforeDateSelectCallback` /
  `beforeMonthChangedCallback` async with result objects.
- **treeview**: internal `TreeController` (`src/treeview.ts:123`, `web-component.ts:631`
  `getController()`), contexts in `src/controller/types.ts` (NodeEventContext, NodeDragContext,
  Before*Context…); menu `ContextMenuItem` in `src/ltree/types.ts:31` (static only,
  `onclick()` no args, `shouldCloseOnClick`, `children`, `ContextMenuDivider`). Events (typed
  `unknown` in `web-component.ts`): `node-clicked`, `node-double-click`, `copy`, `cut`,
  `paste`, `delete`, `node-drag-start/over`, `node-drop`, `node-drag-denied`,
  `node-drop-denied`, `data-changed`, `focused-node-changed`, `search-text-changed`,
  `selection-change`, `checked-change`, `tree-changed`. `before{Copy,Cut,Delete,DragStart}
  Callback` sync `string[] | false | void`. Clipboard is internal (no system clipboard).
- **grid** `packages/web-grid/src/types.ts`: `RowToolbarItem` (:297), `ContextMenuItem` (:383),
  `HeaderMenuItem` (:422), contexts `ContextMenuContext` (:361), `HeaderMenuContext` (:404),
  `ShortcutContext` (:445). Notifications are lowercase props (:595–657: `onrowchange`,
  `ontoolbarclick`, `onrowfocus`, …), almost no DOM events (only `rowdelete` in
  `cell-keydown.ts`). Toolbar click flow `modules/toolbar/element-handlers.ts:385`. Column
  `beforeCopyCallback(value,row)` / `beforePasteCallback(value,row)` are per-cell transforms →
  `getCopyValueCallback` / `getPasteValueCallback`. Uses the system clipboard.
- **commandpalette**: events `cp-open`, `cp-close`, `cp-select`, `cp-complete`, `cp-command`,
  `cp-ready` → drop prefix (`cp-ready` → `ready`, `cp-open` → `open`, …).
- **dropzone / editor**: no action items; dropzone `before{FilesAdded,FilesRemoved}Callback`;
  editor events `mode-change`, `change`, `ready`.
- Rulebook check: `bash naming-conventions.checks.sh <component> <css-prefix>` (C-NC-2) —
  treeview fails (`tree-changed`, `focused-node-changed`), commandpalette fails (`cp-*`).


## Phase 0 — inventory results (2026-10-23)

Per-component tables (current → proposed, file:line, tests/docs to touch) are in
`docs/interaction-inventory/`: `web-multiselect.md`, `web-daterangepicker.md`, `web-treeview.md`,
`web-grid.md`, `dropzone-commandpalette-editor.md`. Each ends with a drift summary.

### Cross-cutting findings

1. **Core `static events` managed `on<Name>` props receive the `CustomEvent`, not the detail**
   (core `src/element/events.ts`). Every BlissElement component (ms, drp, treeview, cp, editor)
   inherits that. Decision 7/17 ("`on*` gets the same detail") therefore starts in core: the
   managed `on<Name>` becomes the config twin called by `emitWithCallback` with the detail; it
   is no longer a listener property. ms/drp also have a second, engine-side `onSelect` with a
   different signature under the same name — collapses into the one twin.
2. **Every component leaks its engine** — drp `ctx.picker` / `el.picker`, ms `WebMultiSelect` as
   1st arg of every item callback + export, treeview `getController()` + export, grid `el.grid`,
   dropzone `getStore()`, editor `el.engine`. → `el.controller` (facade) everywhere.
3. **`onClick` on built-in items is silently ignored** (ms, drp); built-ins emit nothing and
   can't be vetoed (all). Fixed by decision 14.
4. **Four different cancel sentinels** in before-hooks: `false`, a string (ms toast), `null`
   (ms search), `null/undefined` (ms add), `true` (ms/treeview keydown = "handled"), mutable
   `detail.cancel` (grid paste), result objects (drp). Decision 13 unifies.
5. **Positional args in most get*/render*/search/transform callbacks** (ms ~25, treeview ~20,
   grid ~25 incl. columns, dropzone all, cp search/steps, drp 2). See open question A.
6. **Shared `data-action` namespace** — ms treats any `[data-action]` inside rendered content
   as an action button; internal controls (`remove`, `add-new`, nav arrows) share the attribute
   with user actions. Rule: `data-action` / `data-id` are reserved for action items; internal
   controls use a prefixed attribute.
7. **Some before-hooks can't be async** — treeview `beforeDragStartCallback` (dragstart needs a
   sync answer), keydown interceptors (`preventDefault` must be sync). Rule amendment: "may be
   async unless the triggering native event needs a synchronous answer — then documented sync".
8. **Native-name clashes beyond events**: grid `onpaste` / `onbeforepaste` / `onselect` props
   shadow `HTMLElement` handler properties. Rule: `on*` twins must not equal a native
   `GlobalEventHandlers` property name.
9. **Phantom / dead API**: treeview `data-changed` / `search-text-changed` (typed, never
   emitted); grid `onrowaction`, column `renderCallback`, `loadOptions`, `lockTooltipCallback`.
   Remove in the component's phase.
10. **Incidental bugs** (fix in the component's phase, each with a test): drp all custom
    buttons share the first tooltip, `SummaryContext` field drift; ms runtime controller is the
    keyboard one, bulk ops bypass select vetoes; treeview checkbox toggle fires `node-clicked`,
    blocked paste still emits, `tree-changed` dispatched twice; grid paste never fires
    `onvalidationerror`, floating toolbar ignores `hidden`, `minWidth` dropped, header submenu
    `onclick` never called, custom item with a built-in id runs the built-in, header sort skips
    `ondatarequest`, expand events only on toggle.
11. **Core `/search` types**: ms needs `SearchCallbackContext` to carry `term` + `signal`
    (single-ctx `searchCallback`) — a core change in phase 1.
12. **Out of scope**: dropzone satellites are not BlissElement (no change here); dropzone row
    actions (pause/resume/retry) are hard-coded — could become built-in action items later.

### Open questions (phase 0)

A. **Scope of "one ctx argument"** — convert *all* callbacks (get*/render*/search/transform,
   incl. grid column + editorOptions callbacks) in this pass, or only the interaction surface
   (items, events, before*) now and the rest later? Recommendation: all, per component, in the
   same breaking release — breaking twice is worse.
B. **drp rich before-results** — `beforeDateSelectCallback` returns `{action:'accept'|'adjust'|
   'restore'|'clear', adjusted*, message, showInvalidRange}`; `beforeMonthChangedCallback`
   returns `{action, metadata, monthHeaders, message}`. Recommendation: `false` = restore,
   value = adjust, `null` = clear (documented), message via `ctx.controller.showMessage()`;
   month data loading split into its own `getMonthDataCallback(ctx)` (async, loader).
C. **grid `beforeCommitCallback`** is validation (`false` = invalid + error message,
   `transformedValue`), not a veto. Recommendation: rename `validateCallback(ctx)` returning
   `ValidationResult` (the deprecated old `validateCallback` goes), keeping the before*
   contract clean.
D. **grid toolbar built-ins** (`add`/`delete`/`duplicate`/`moveUp`/`moveDown`) have icons but no
   behaviour. Recommendation: implement them (row ops exist internally) so `action:'delete'`
   works like ms `select-all`; `beforeActionCallback` vetoes. Built-in names kebab-case
   everywhere (`move-up`, `sort-asc`).
E. **commandpalette `cp-command`** — a command *is* an action item. Recommendation: commands
   fire the unified `action` event (`source:'palette'`, `item` = the command, `selections`);
   `select` stays for search results; `complete` folds into `action`.
F. **Toggle state on `ActionItem`** — editor needs bold/italic "active"; grid freeze/visibility
   toggles and treeview could use it. Recommendation: add `isActive?` + `getIsActiveCallback`
   to core `ActionItem` (renders `aria-pressed`).

### Decided (phase 0, 2026-10-23)

19. **A** — all callbacks go to one `ctx` argument (get*/render*/search/transform, grid column
    + editorOptions callbacks too), per component, in the same breaking release.
20. **B** — drp before-hooks: `false` = restore, value = adjust, `null` = clear; messages via
    `ctx.controller.showMessage()`; month data loading → `getMonthDataCallback(ctx)`.
21. **C** — grid `beforeCommitCallback` → `validateCallback(ctx)` returning `ValidationResult`
    (old deprecated `validateCallback` removed).
22. **D** — grid toolbar built-ins (`add`, `delete`, `duplicate`, `move-up`, `move-down`) get real
    behaviour; built-in action names kebab-case everywhere (`sort-asc`, …).
23. **E** — commandpalette commands fire the unified `action` event (`source: 'palette'`,
    `item` = command, `selections`); `select` stays for search results; `complete` folds into `action`.

24. **F** — core `ActionItem` gains `isActive?` + `getIsActiveCallback(ctx)`: toggle state
    ("pressed"), not availability; renders `aria-pressed="true"` + `--active` modifier.
    **Renamed 2026-10-26** → `isToggled` / `getIsToggledCallback`, modifier `--toggled`;
    menu toggles render `role="menuitemcheckbox"` + `aria-checked`.
25. Rulebook amendments (findings 6–8) accepted and written: sync interceptor exception
    (dragstart / keydown; keydown returns `false`, never `true`); camelCase `on*` keeps off
    native `HTMLElement` handler props; `data-action` / `data-id` reserved for action items,
    internal controls use `data-<prefix>-action`. Backup of the previous rulebook:
    `%TEMP%/bliss-naming-backup-20261023-212646`.

Next: phase 1 (core).

### Phase 1 — done (2026-10-23)

- `emitWithCallback` was folded into **`emit()`**: once the `on<Name>` property is the
  detail-receiving twin (not a listener), a second method only adds a way to get it
  wrong. Events without a twin declare `property: false`. Rulebook updated.
- Core: `dispatch()`/`emit()` default `composed: false`; `emit()` attaches context
  (`controller` via `createController()`, `element`, non-enumerable; `eventContext()`
  extras), calls the twin with the detail, dispatches the same object; `el.controller`;
  composed-native lint; `runBeforeCallback` / `runBeforeCallbackSync`;
  `withComponentContext`; `/actions` (`ActionItem` … `runAction`); `/search`
  `SearchCallbackContext` + `term`, `signal`. SPEC §12.5 rewritten, §12.12 added.
- Consequence until each component's phase lands: components on `file:` core see
  `on*` receive the detail and events stop being composed — their tests that rely on
  the old behaviour fail until migrated (expected; drp is next).

### Phase 2 — web-daterangepicker done (2026-10-23, drp a1c0936)

Code + tests migrated; 284 chromium e2e pass. Docs / examples / ai notes being updated
separately. Conventions settled here that later phases reuse:

- **Element `createController()` delegates to the current engine** (flush first), and the
  element passes `hostElement` + `controller` into the engine options, so every context
  carries the element and a controller that survives `reinit()` rebuilds.
- **Engine `ctx(fields)`** = `withComponentContext(fields, controller, host, presentation)` —
  the one place contexts are built.
- **Engine reports through `on*` options** (`onSelect`, `onAction`, `onMonthChange`); the
  element bridges them to `this.emit(...)`. A standalone engine uses them as its twins.
- **Internal controls → `data-<prefix>-action`** (`data-drp-action`); `data-action` /
  `data-id` are only for action items, so any `[data-action]` inside the component is routed
  to `runAction` (footer button → its item; consumer HTML → synthetic item, `source` from the
  container: `message` / `summary` / `calendar`).
- **Render-time item callbacks get the surface ctx only** (no `action` / `item`) — the
  invocation fields exist only at activation.
- **"Message shown by the hook" detection**: `beforeSelectCallback` messages go through
  `ctx.controller.showMessage`; the engine counts public `showMessage` calls so it doesn't
  hide the consumer's message after an accept/adjust.
- **Change notifications detected at render** (`month-change`): compare the visible state
  with the last render instead of instrumenting every navigation path.
- **`customStylesCallback()` → `getCustomStylesCallback(ctx)`** — apply the same rename in
  ms / treeview / grid / dropzone (cross-component).
- **Raw engine accessors removed** (`el.picker`); the engine class stays exported as
  `*Engine` for standalone use only.

### Phase 3 — web-multiselect done (2026-10-23, ms 82499fb, 4af798a)

Code + tests migrated (146 unit, 384/397 chromium+mobile e2e — the rest load examples pages,
migrated with the docs). Core additions: `runBeforeCallbackEager` (63a51c0) and
`SearchTermContext.term` (806c160). New conventions for later phases:

- **Sync stays sync.** A flow that is synchronous today (ms: click → commit in the same tick)
  runs its before-hook through `runBeforeCallbackEager` and branches with a tiny
  `then(x, fn)`; only an async hook makes the flow async. Tests keep asserting synchronously.
- **Bulk gestures veto per item.** Select-All / Clear-All / group checkbox / tree-cascade /
  inline ✕ call `beforeSelect/DeselectCallback` once per affected item with
  `ctx.source` (`option | badge | group | select-all | clear-all | clear`); vetoed items are
  skipped, the rest apply in ONE commit (one `change`). Programmatic `setSelected` / form reset
  stay veto-free. Grid/treeview row ops should follow this.
- **Cheap per-item ctx on hot paths.** Data accessors (`getValueCallback`, …) run per option
  per pass, so `itemCtx(item)` = `Object.create(proto)` + `item`, the prototype carrying
  `controller` / `element` / presentation as getters (inherited ⇒ non-enumerable). Everything
  else uses `ctx()` (`withComponentContext`). Treeview / grid row callbacks: same pattern.
- **Badge-style ctx is always complete** — callbacks that used to get an optional 2nd arg now
  get defaults (`displayMode` = configured, `isInPopover` = false) instead of `undefined`.
- **`data-action` triggers anywhere in rendered content** route to `runAction` with
  `source` from the container (`option` / `badge` / `message`) and the row's item on the
  detail (`option`); they never trigger the container's own behaviour (row toggle).
  Synthetic items are cached per trigger element (WeakMap) so the busy guard works.
- **One controller.** ms had a keydown-only controller; it folded into the public one
  (focus methods are harmless when closed). `el.controller` delegates to
  `engine.getController()` after `flush()`.
- **Exception kept positional:** `selectedOrderCompareCallback(a, b)` — handed straight to
  `Array.prototype.sort`.
- **Decided (2026-10-24):** ms ships the breaking change as **3.0.0-rc01** (not 2.6.0 — `^2.x`
  consumers such as showcase `^2.5.0` / pure-admin would auto-pull a stable 2.6.0). The unpublished
  2.6.0-rc04 section was folded into `[Unreleased]`.

### Phase 4 — web-treeview done (2026-10-23, treeview ed5cb0c on `feature/rc03-svelte-parity`)

Code + tests migrated (210 chromium e2e incl. a new `interaction-model.spec.ts`). Treeview's
active line is `feature/rc03-svelte-parity` (55 commits ahead of its `prod`), so the phase was
committed there. Conventions added:

- **Adapt at the boundary when the engine is big.** `TreeEngine` (5k lines) keeps its internal
  positional hooks; `WebTreeView` (the wrapper the element and standalone users share) owns the
  public single-ctx config and adapts it in `mapToEngineConfig` / `mapToRendererConfig`.
  Adapters are **memoized per source function** — the engine compares callback identities
  (a changed `getDisplayValueCallback` rebuilds the tree), so a fresh wrapper per update would
  rebuild on every update. Grid should do the same.
- **Bridges built once** on the element (`#bridges` object), for the same identity reason; all
  callback inputs become `on:'update'` (full-config resend is free with memoized adapters — and
  fixes callbacks assigned after the build never reaching the engine).
- **Facade from a method-name list** (`createTreeViewController(getTarget)`): one builder for
  the element (`getTarget = flush + current view`) and a standalone view (`getTarget = this`),
  with empty-result defaults for reads before the first build.
- **Context menu = core menu items in the renderer**: `resolveMenuEntries` +
  `getMenuChildren` (lazy submenu with a loading row) + an `activateContextMenuItem` hook the
  wrapper supplies (`runAction`). Built-ins act on the node, or on the whole selection when the
  node is in it; their default text / disabled / danger come from a `defaults` function.
- **Synchronous before-hooks where the API returns synchronously** (`pasteNodes` →
  `PasteResult`, `deleteNodes` → counts): `beforeCopy/Cut/Paste/DeleteCallback` are documented
  sync (like keydown / dragstart); `beforeDropCallback` stays async.
- **Phantom API removed, not implemented** (`data-changed`, `search-text-changed`,
  `indexingCompleteCallback`, and `render*Callback` — the progressive `RenderCoordinator` is
  created in `TreeEngine` but never scheduled, so render stats never fired; follow-up if
  progressive-render notifications are wanted). Docs/examples: treeview 38a88c7, 0390ae1.

### Phase 5 — web-grid done (2026-10-24, grid 8924b1d + 434556a on `prod`)

Code + tests migrated (46 unit, 319 chromium e2e incl. a new `interaction-model.spec.ts`).
Grid had no events and three item shapes; it now matches ms / drp / treeview. Version:
**2.0.0-rc01** (decided 2026-10-24; all grid consumers use `^1.x`). Conventions added:

- **Engine notifies, element emits.** `GridEngine.attachHost(element, getController,
  notify)` gives the engine a ctx prototype (`controller` / `element` as getters — inherited,
  so non-enumerable and one allocation per per-cell ctx) and a `notify(name, detail)` that
  the element routes to `emit()`. Modules call `ctx.engine.notify(...)`; no `on*` storage
  in the engine. A standalone engine runs without a host (plain ctx, no events).
- **One item layer for every surface** (`modules/items`): built-in defaults per surface
  (`rowActionDefaults` / `cellMenuDefaults` / `headerMenuDefaults` — text from
  `labels`, state like "move-up disabled on the first row"), `activateGridItem` (core
  `runAction` + the built-in), and the built-ins. Toolbar, inline actions, cell toolbar,
  both menus and both shortcut kinds all go through it.
- **Built-ins do the work, factories shape the rows.** Row built-ins mutate `items`
  (`insertRow` / `removeRows` / `duplicateRow` / `moveRow`, also on the controller);
  `createEmptyRowCallback` / `createDuplicateRowCallback` let a consumer shape the new row
  instead of re-implementing the action. Ctrl+Delete stays a *request* event (`row-delete`) —
  deleting on a key without opt-in would surprise every editable grid.
- **Menu-open hooks are sync before-hooks that may replace** (`beforeContextMenuOpenCallback`
  → `false` / entries); they subsume the old "mutate the items in `on…open`" pattern.
- **Mode flags replace "presence of a handler"** — server-side filtering was "an
  `onfilterchange` is set"; with events that can't be detected, so it's `filterMode`.
- **Option callbacks inside nested config** (`editorOptions.get*Callback`) get the grid's
  ctx via a WeakMap from the options object to the grid's ctx factory, bound when
  `columns` are set — no signature threading through ~50 helper calls.
- **Shortcuts are action items bound to a key** (`shortcut` is the chord); a shortcut can
  name a built-in (`{ shortcut: 'Ctrl+D', action: 'duplicate' }`). Document-level toolbar
  shortcut listeners skip already-handled keydowns (`defaultPrevented`) — the focused cell's
  handler runs first.
- **Docs/examples by an agent** with the same migration scripts used for the fixtures
  (`mig_regex.py`, `mig_items.py` in `%TEMP%/wg-migrate`).

### Phase 6 — dropzone, commandpalette, editor done (2026-10-24, all on `prod`)

Run as three parallel agents on a shared brief, each verified afterwards (typecheck, unit, full
e2e on a private port):

| component | commits | unit | e2e | version |
|---|---|---|---|---|
| web-dropzone | 0cf400e, 98a3084 | 9 → 12 | 147 → 166 (+2 skipped) | **1.0.0-rc03** (decided; no stable 1.0.0 published) |
| web-commandpalette | 3f53918, 4452513 | 67 → 78 | 67 → 77 | **1.0.0-rc03** (decided; no stable 1.0.0 published) |
| web-editor | 79bd497, 6e11ed6 | 81 → 94 | 8 → 18 | **1.0.0-rc01** (decided; first release) |

Decisions made in this phase:
- **dropzone**: `DropzoneCore` → `DropzoneEngine`, `getStore()` → `el.controller`; the engine
  `notify()`s, the renderer patches the DOM, the element `emit()`s (non-composed, present
  tense: `file-add`, `files-change`, `file-upload-complete`, `ready`, …); satellites (not
  BlissElement) dispatch `summary-activate` / `queue-open` themselves with the store's context,
  and bind through an internal non-flushing controller copy (`store-link.ts`) — flushing from a
  satellite mid-dispatch tore the satellite down. `beforeFilesAddCallback` may return a
  replacement `File[]`; internal controls use `data-dz-action`. Row actions (pause / resume /
  retry) stay internal — not host-configurable items yet.
- **commandpalette**: `cp-*` prefix dropped; `cp-command` + `cp-complete` → one `action`
  (`source: 'palette'`, `selections`); a veto steps a finished wizard back to its last answer.
  `Command.name/shortcut/hotkey` → `text/trigger/shortcut`; `Result` / `Selection` /
  `UsageEntry` keep their data names (stored in recents — renaming would blank users' history).
  `signal` is non-enumerable on provider ctxs (callback args stay JSON for the LiveView bridge).
- **editor**: toolbar / selection toolbar / context menu are core action items (`action` =
  command name, defaults from the command registry incl. `isActive`); keyboard shortcuts stay
  ProseMirror keymaps (no `action` event, not vetoable); `el.engine` → `el.controller`; new
  `lock-change` event and `interactionHost` input. Pipeline `run(ctx, rt)` stays two-arg (plugin
  reducer contract, not a consumer callback).
- **All three**: `runAction` is async, so `action` fires a microtask after the click (ms, drp,
  treeview, grid behave the same). An eager `runAction` variant was suggested as optional.

Follow-ups found:
- ~~core: `toEnum(…, { shouldNullOnInvalid: true })` rejected `null` assigned as a property~~ —
  fixed in core 6a29a75 (both paths clear it).
- dropzone: `ai/*.txt` and `docs/api-reference.html` are stale copies from web-multiselect;
  `examples-sharepoint-collisions.html` queries rows with `document.querySelector` although they
  render in shadow DOM (possibly broken, not investigated); CLAUDE.md (user WIP) still documents
  the old names.
- editor: pipeline type fields `PipelineStage.interactive`, `PipelinePolicy.lock`,
  `InteractionResult.cancelled` predate the boolean rule (rename later).
- grid (from phase 5): focus after a move-row built-in; built-ins run after the `action`
  event; lock tooltip text not i18n'd; shortcuts help omits the range shortcuts.
- consumers: the `keen-web-commandpalette` LiveView bridge needs the changes listed in
  `docs/consumer-migration-plan.md`.

### Input presets — `getBatchValuesCallback` (2026-10-24, core f690ce8; grid 23faaa4 → efbc94a)

Grid was the one component bypassing core's property path: its constructor replaced every
engine-backed accessor with a synchronous `engine[key] = value` proxy (no validation, no
reflection), for two reasons — `mode` cross-writes sibling inputs (a preset), and
read-after-write of engine-derived state. Both now go through core:

- **Core `InputDef.getBatchValuesCallback(value, config)`** returns `{ configKey: value }` for
  other inputs, staged in the same batch, each through its own converter. Inputs set explicitly
  in that batch win, whatever the order (markup attribute order too); a rejected explicit write
  isn't explicit; one level only; runs on property / attribute / removal, not at construction.
  Before the first connect, batch values reflect at the connect flush (reflecting mid-upgrade
  swallowed the markup's attribute replay). Known gap: an invalid attribute string counts as
  explicit. SPEC §6.2.
- **Grid:** proxies + `reinit()` presence-gating removed — invalid property values now warn and
  keep the previous one (`el.pageSize = null`). `MODE_PRESETS` (grid.ts) feeds both the engine's
  `mode` setter (standalone engine) and the input; `#applyConfig` applies `mode` first so core's
  resolved values land after the engine's preset (kept deliberately — no order dependence for the
  consumer). Read-after-write follows core's convention: `this.flush()` at the top of public
  methods and computed getters, and in the controller's engine accessor; `el.engine` is internal
  and fed on the flush. `cellSelectionMode` became an input (`cell-selection-mode`); UI-driven
  input writes (page-size select, freeze menu) use `setAttributes()`. e2e `inputs.spec.ts` (8);
  full suite 328 pass.

Next: web-multiselect review (user, next session). Phase 7 (rc15 publish) — on hold until the
user's `file:` testing is done.


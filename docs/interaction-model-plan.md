# Unified interaction model — plan

Started 2026-10-23. Goal: every KeenMate component exposes action items (buttons, toolbars,
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
   (+ `menuDivider(text?)` factory). Plain object, not a class, so JSON / data-attribute menus
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
  cssClass?: string; isVisible?: boolean; isDisabled?: boolean; isDanger?: boolean;
  getTextCallback?(ctx: Ctx): string;        getIconCallback?(ctx: Ctx): string;
  getTooltipCallback?(ctx: Ctx): string;     getClassCallback?(ctx: Ctx): string | string[];
  getIsVisibleCallback?(ctx: Ctx): boolean;  getIsDisabledCallback?(ctx: Ctx): boolean;
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
menuDivider(text?)
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
   `menuDivider`, `emitWithCallback()` on BlissElement; unit tests; SPEC §12.x section; CLAUDE.md note;
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
    c. order: item `onClick` → `action` event → built-in behaviour.
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


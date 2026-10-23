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
flags), so a handler can act without reaching for the element. Proposed core helper:
`this.notify(name, detail)` → builds the context, calls `config.on<Name>` then emits the event.

Veto hooks stay callbacks (`before*Callback(ctx)` → `false` cancels) and get the same context
base. Naming to settle (see questions): event names kebab-case, present tense, no component
prefix (`node-click`, `date-select`, `row-change`), notification `onNodeClick` / `onRowChange`.

## Phases

0. **Inventory** (no code) — per component: every action item type, every callback context,
   every DOM event + `on*` notification + `before*Callback`, with current name → new name and
   detail fields. Output: a table per component appended here. Settle open questions.
1. **Core `/actions` + event helper** — types, `resolveActionItem`, `resolveMenuEntries`,
   `menuDivider`, `notify()` on BlissElement; unit tests; SPEC §12.x section; CLAUDE.md note;
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

## Open questions

1. String shorthand in item arrays (`['add', 'delete']` → `{ action }`) — default: keep,
   core normalises.
2. One `action` DOM event (detail `{ item, action, ...ctx }`) replacing drp `custom-action`,
   grid `ontoolbarclick`, … — default: yes.
3. Rename treeview's internal `TreeController` → `TreeEngine` — default: yes.
4. Event names: kebab-case present tense without component prefix (drop `cp-`)? — default: yes,
   except where it collides with a native event (`change`, `select`, `copy`, `paste`, `delete`
   need a check: native `select`/`copy`/`paste` bubble from inner inputs).
5. Notification naming: `onNodeClick` (camelCase config key) everywhere; grid's lowercase
   `onrowchange` properties go — default: yes.
6. Does every event detail carry `ComponentContext`, or only "interaction" events (not
   `ready` / `data-changed`)? — default: interaction events only.

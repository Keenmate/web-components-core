# web-daterangepicker — interaction inventory (phase 0)

Read-only pass over `C:\Git\KM\web-daterangepicker` (2026-10-23). Paths relative to that repo.
Target shape: `../interaction-model-plan.md`.

## 1. Action items

| kind | current | fields / signature | file:line | proposed | notes |
|---|---|---|---|---|---|
| item type | `ActionButton` | `action: 'today'\|'now'\|'clear'\|'apply'\|'custom'` (**required**), `text`, `cssClass?`, `tooltip?`, `isVisible?`, `isDisabled?`, `onClick?(ctx)`, `isVisibleCallback?`, `isDisabledCallback?`, `getTextCallback?`, `getClassCallback?`, `getTooltipCallback?` | src/types.ts:236-272 | `ActionItem<DateRangePickerActionContext>`; `action?` built-ins only; add `id`, `icon`, `shortcut`, `isDanger`, `getIconCallback`; `isVisibleCallback`→`getIsVisibleCallback`, `isDisabledCallback`→`getIsDisabledCallback` | `'custom'` sentinel; no `id` → multiple custom buttons indistinguishable; `text` → innerHTML (date-picker.ts:850) |
| defaults | `getDefaultButtons()` | today (not time mode), now (not date mode), clear, apply (`commitMode==='apply'`) | date-picker.ts:881-917 | same, as `ActionItem` | gated by `isTodayButtonShown` / `isNowButtonShown` / `isClearButtonShown` / `commitMode` |
| render | `renderButtons()` | callback → static → default; `data-action=<action>`; stores `_customOnClick`, `_buttonConfig` | date-picker.ts:801-876 | — | **bug**: `onClick` only runs for `data-action="custom"` (:1567) — ignored on built-ins |
| tooltip | `attachActionButtonTooltips()` | `buttons.find(btn => btn.action === action)` | date-picker.ts:925-958 | by index / `id` | **bug**: all custom buttons get the first one's tooltip |
| config | `actionButtons` | `ActionButton[]` (property only) | types.ts:553; web-component.ts:169 | keep name, new item shape | |
| internal `data-action` | — | prev, next, unified-prev, unified-next, toggle-rolling, toggle-unified-rolling, today, now, clear, apply, close-message, custom | date-picker.ts:1562-1629 | built-ins via `action` + `beforeActionCallback`: today/now/clear/apply; nav stays internal | fullscreen close button (ui.ts:414) is not an item |
| menus | — | none | — | n/a | |

## 2. Contexts

All except `ActionButtonContext` = `PickerContext {picker}` + `PresentationContext` (core
`overlay/presentation.ts:65`, built by `presentationCtx()` date-picker.ts:2655). **None carry
`element`.**

| current | fields | file:line | proposed / notes |
|---|---|---|---|
| `PickerContext` | `picker` (raw engine) | types.ts:11 | drop; base = `{controller, element, presentation, isFullscreen, isModal}` |
| `ActionButtonContext` | picker, controller, presentation, `action`, `button`, `data?` | types.ts:278; built date-picker.ts:815, 941, 1587-1594 | `ActionContext`: + element, `item` (was `button`), `id`, `source`, `sourceEvent`, `triggerElement`, `dataset` (was `data`; only set on click) |
| `SelectionContext` | picker, controller, presentation, `mode`, `date?`, `range?`, `subRanges?`, `enabledDates?` | types.ts:921; selection.ts:39-52 | + element |
| `MonthChangeContext` | picker, controller, presentation, year, month, monthIndex, firstVisibleDate, lastVisibleDate | types.ts:176; navigation.ts:95, ~160, 313 | + element; also used on initial load (navigation.ts:41) |
| `DayContext` | picker, presentation, date, dateString, dayNumber, isDisabled, isSelected?, isStartDate?, isEndDate?, isInRange?, isToday, isWeekend, monthIndex?, `element?` (= **day cell**) | types.ts:868; date-picker.ts:1017, rendering.ts:384, 538, 622 | + controller + host element; cell → `cellElement`; tooltip paths pass `element: null` |
| `SummaryContext` | picker, presentation, days, nights, startDate, endDate, dateRanges?, dates?, enabledDates?, disabledDates?, selectionMode, `rangeDisabledHandling?`, localeStrings, isPreview? | types.ts:831; rendering.ts:1422, ~1523 | + controller, element; **drift**: runtime passes `disabledDatesHandling` (rendering.ts:1430) |
| `MonthHeaderContext` | picker, presentation, month, monthIndex, monthName, year | types.ts:891; rendering.ts:149 | + controller, element |
| `UnifiedHeaderContext` | picker, presentation, firstMonth, lastMonth, anchorMonth, monthNames | types.ts:906; rendering.ts:180 | + controller, element; doc says innerHTML, runtime textContent (types.ts:602) |
| `FormValueSelection` | selectionMode, pickerMode, items | src/form-value.ts:27 | ctx `{controller, element, selection}` (now positional) |

## 3. DOM events

Core `dispatch()` defaults bubbles+composed (core `src/element/dispatch.ts:21-22`); EVENTS
table has no overrides.

| current | detail | emitted | proposed | notes |
|---|---|---|---|---|
| `date-select` | `SelectEventDetail` (= `DatePickerEventDetail`): date?, dateRange?, formattedValue, enabledDates?, disabledDates?, dateRanges?, dates?, getEnabledDateCount?(), getTotalDays?() | web-component.ts:579 `#emitSelect` (bridge `cfg.onSelect` :539, `#handleDateSelect` :546); detail built `buildSelectDetail()` date-picker.ts:1105 | `select` + `SelectEventDetail` + controller/element/presentation | `formattedValue` overwritten by host (:565) |
| `change` | same object | web-component.ts:580 | keep `change` (non-composed native — allowed) + `ChangeEventDetail` | |
| `custom-action` | `CustomActionEventDetail {data, picker, controller}` | date-picker.ts:2557-2566 `fireCustomActionEvent`, dispatched on `this.calendar` (inside shadow root) | `action` + `ActionEventDetail` | fires **before** `onClick` (1580 vs 1583-1595); never for built-ins; `data` empty for config buttons |
| `ready` | `undefined` | web-component.ts:442 | `ready` + `{controller, element}` | |
| internal `drp-picker-activated` | picker instance | date-picker.ts:2576-2579 on `document` | keep internal | e2e/single-active.spec.ts, docs/accessibility.md |
| — (missing) | — | — | `month-change` + `onMonthChange` | only a before-hook exists |

## 4. `on*`

| current | signature | file:line | same detail? | proposed |
|---|---|---|---|---|
| engine config `onSelect` | `(detail: SelectEventDetail)` | types.ts:367; interaction.ts:381, 990; selection.ts:398, 501, 542, 613, 979 | yes, but mutated after (web-component.ts:565); overwritten by the element (:539); not in INPUTS | `onSelect` twin of `select` via `emitWithCallback` |
| element managed `onDateSelect` / `onChange` / `onCustomAction` / `onReady` | `(e: CustomEvent<…>)` | web-component.ts:255-257, :199-204 (onReady untyped) | **no — gets the CustomEvent** (core `events.ts` contract) | `on<Name>(detail)` — **core change** |
| `ActionButton.onClick` | `(ctx)` awaited | types.ts:256; date-picker.ts:1583-1595 | n/a | runs first for every item |

## 5. Callbacks

| current | signature | contract | file:line | proposed |
|---|---|---|---|---|
| `beforeDateSelectCallback` | `(ctx: SelectionContext)` sync/async (loader) | `BeforeSelectResult {action:'accept'\|'adjust'\|'restore'\|'clear', adjusted*, message?, showInvalidRange?}`; throw = invalid | types.ts:656; selection.ts:29-128 | `beforeSelectCallback(ctx)`: `false` cancels, value (Date/DateRange/DateRange[]) replaces; message via `ctx.controller.showMessage` |
| `beforeMonthChangedCallback` | `(ctx: MonthChangeContext)` sync/async | `{action:'accept'\|'block', metadata?: Map, monthHeaders?: Map, message?}` | types.ts:701; navigation.ts:41-, 108, 173, 236-345 | `beforeMonthChangeCallback(ctx)` `false` = block; split data loading out (e.g. `getMonthDataCallback`) — open question; runs on initial open too |
| `AsyncValidationResult` | deprecated alias | — | types.ts:170 | remove |
| `getDateMetadataCallback` | `(DayContext) → DayMetadata\|null` | | types.ts:511; date-picker.ts:1016 | ok |
| `getMonthHeaderCallback` / `getUnifiedHeaderCallback` | `(ctx) → string` textContent | | types.ts:624 / 604 | ok (fix doc) |
| `badgeTooltipCallback` / `dayTooltipCallback` | `(DayContext) → string\|null` HTML | | types.ts:534-535; rendering.ts:382-405, 536-560 | `getBadgeTooltipCallback` / `getDayTooltipCallback` |
| `formatSummaryCallback` | `(SummaryContext) → string` HTML | | types.ts:582; rendering.ts:1421, 1522 | `renderSummaryCallback` |
| `renderDayCallback` / `renderDayContentCallback` | `(DayContext) → HTMLElement\|string\|null` | | types.ts:523, 531 | ok |
| `customStylesCallback` | `() → string` (no ctx) | | types.ts:514; web-component.ts:181, 734-746 | `getCustomStylesCallback(ctx)` — cross-component (ms has the same) |
| `getValueFormatCallback` | `(selection)` positional | | web-component.ts:150, 647; form-value.ts:74 | `(ctx)` with `ctx.selection` — cross-component |
| — | `beforeActionCallback` | | — | new |

## 6. Controller / engine

| name | members | file:line | notes |
|---|---|---|---|
| `DateRangePickerController` | getSelectedDate/Range/Ranges/Dates/Datetime, `isOpen`, selectToday, clearSelection, apply, open, close, toggle, setPresentation, prevMonth(i?), nextMonth(i?), lock, unlock, showMessage(content,type?,autoHide?), hideMessage, showSummary, hideSummary | types.ts:23-66; memoized `getController()` date-picker.ts:2739-2768 | missing selectNow, toggleMessage, show/hideLoader, refreshSummary; `showMessage` → opts object (plan); element exposes `picker`, not `controller` (web-component.ts:1049) |
| `DateRangePicker` | engine | src/date-picker.ts | → `DateRangePickerEngine`; stop leaking as `ctx.picker` / `el.picker` (keep `el.picker` deprecated? — decide in phase 2) |
| `WebDaterangepickerElement` | open/close/toggle/clearSelection/show/hide/toggle Message/Summary/Loader, lock family, value, selected* | web-component.ts:904-1049 | the `element` |

## 7. `showMessage` HTML → custom-action

`showMessage` writes `innerHTML` into `.drp__message-text` (ui.ts:781-829). One delegated click
listener on `this.calendar` (date-picker.ts:1537) matches `closest('[data-action="custom"]')`
(:1567) anywhere in the calendar (message, summary, renderDay output, config buttons); dropped if
the `actions` aspect is locked (:1570); copies `dataset` minus `action` into `data`
(:1572-1577); fires the event, then `_customOnClick` (stub `{action:'custom', text:''}` for HTML
buttons, :1583-1595). Migration: HTML buttons use `data-action="custom" data-id="…"` (or
`data-id` alone), `dataset` → `detail.dataset`, `source: 'action-buttons'|'message'|'summary'|'day'`,
`triggerElement` = matched element.

## 8. Tests / docs to update

- e2e: `context-callbacks.spec.ts` (:98 `['data','picker']` — stale now), `events-api.spec.ts:76-95`,
  `callbacks.spec.ts`, `callbacks-extra.spec.ts`, `imperative-feedback.spec.ts`, `single-active.spec.ts`.
- fixtures: `test/context-callbacks.html`, `callbacks.html`, `misc-features.html`, `events-api.html`;
  `test/COVERAGE.md:128,181,189(stale),202,205`, `test/FINDINGS.md:9`.
- `src/web-component.ts:189-204` EVENTS descriptions (:202 stale).
- `API.md:415-417, 486, 492, 499-552` — **badly stale** (invented `data-*` passthrough, flat detail,
  positional `beforeDateSelectCallback`, `{allow:false}`).
- README (4), `docs/usage.md` (20), `docs/examples.md`, `docs/accessibility.md`.
- generated: `web-types.json`, `custom-elements.json`, `vscode.html-custom-data.json`.
- examples: `examples-action-buttons.html` (28; :935-936 positional `(p) =>` stale),
  `examples-events-callbacks.html` (56), `examples-data-api.html` (40), basic / custom-rendering /
  logging / time-picker / badges-tooltips, `index.html`.
- `ai/action-buttons.txt` (positional `(picker) =>` throughout — fully stale),
  `ai/events-callbacks.txt`, `ai/basic-usage.txt`, `ai/INDEX.txt`, `ai/disabled-dates-handling.txt`,
  `ai/date-restrictions.txt`.

## Drift summary

1. `custom-action` fires before `onClick`; built-in `onClick` never runs; no event/veto for built-ins.
2. `action` required with `'custom'` sentinel; no `id`/`icon`/`shortcut`/`isDanger`;
   `isVisibleCallback`/`isDisabledCallback` naming; first-custom-tooltip bug; empty `data`.
3. `date-select` → `select`; `custom-action` → `action`; `ready` has no detail.
4. No detail carries `element`/presentation; select detail has no `controller`.
5. Element `on*` get the CustomEvent (core contract); config `onSelect` overwritten + mutated.
   No month-change notification.
6. Before-hooks use `{action:'accept'|…}` objects; `beforeMonthChangedCallback` past tense, runs on load.
7. Render/get contexts lack `controller`; `DayContext.element` = cell; `SummaryContext` field drift;
   `customStylesCallback` no ctx; `getValueFormatCallback` positional.
8. Engine `DateRangePicker` leaks as `ctx.picker` / `el.picker`; no `el.controller`.
9. Docs already stale before migration (API.md, ai/action-buttons.txt, examples :935, test :98).

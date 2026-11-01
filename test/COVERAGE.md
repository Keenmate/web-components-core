# E2E Test Coverage Checklist

Tracks which features of `@keenmate/web-components-core` have end-to-end (real-browser) coverage in
`e2e/`. Each row is one observable behaviour. Status legend:

- `✗` — no coverage
- `△` — partial coverage (some paths)
- `✓` — covered

**Spec** points at the file under `e2e/`, **Fixture** at the dedicated minimal page under `test/`
(styled by `test/test-fixtures.css`, no example chrome — the devkit kit is not injected there). Specs
hit **no example pages**, only fixtures; the one exception is `examples.spec.ts`, a smoke test of the
example site (pages load, demo elements defined, kit chrome present — nothing behavioural). Fixture
elements are test-only and never import the example pages' `examples-*-card.ts`, so examples and tests
evolve independently. Unit tests (`src/**/*.test.ts`, jsdom) cover the same behaviour at the module
level; the e2e suite is for what needs a real browser (layout, focus, ElementInternals, media queries,
shadow DOM event paths).

Bugs and friction found while writing the tests go in [`NOTES.md`](NOTES.md).

---

## 1. Input table & converters

| Feature | Status | Spec | Fixture |
| ------- | :----: | ---- | ------- |
| Attribute and property writes share one pipeline (toInt) | ✓ | `inputs.spec.ts` | `inputs.html` |
| Reflection of a property write (`shouldReflect`) | ✓ | `inputs.spec.ts` | `inputs.html` |
| Removing an attribute resets to the default | ✓ | `inputs.spec.ts` | `inputs.html` |
| Non-reflected input leaves the attribute alone | ✓ | `inputs.spec.ts` | `inputs.html` |
| toList reflects as a joined list | ✓ | `inputs.spec.ts` | `inputs.html` |
| toBool('presence') reflects as presence / removal | ✓ | `inputs.spec.ts` | `inputs.html` |
| toText / toEnum attribute parsing (valid values) | △ | `inputs.spec.ts` | `inputs.html` |
| toFunction callback input: set re-renders, null clears | ✓ | `inputs.spec.ts` | `inputs.html` |
| Invalid attribute on reflected input: warn, keep, write back | ✓ | `inputs.spec.ts` | `inputs.html` |
| Invalid attribute on non-reflected input: warn, keep, markup untouched | ✓ | `inputs.spec.ts` | `inputs.html` |
| Invalid property value (toInt range, toEnum): warn, keep | ✓ | `inputs.spec.ts` | `inputs.html` |
| Valid write after invalid ones is accepted silently | ✓ | `inputs.spec.ts` | `inputs.html` |
| Invalid value BEFORE any valid one keeps the default | ✗ | | |

## 2. Reactivity & batching

| Feature | Status | Spec | Fixture |
| ------- | :----: | ---- | ------- |
| `on: 'update'` → update(partial) with only changed keys | ✓ | `reactivity.spec.ts` | `reactivity.html` |
| `on: 'reinit'` → full rebuild | ✓ | `reactivity.spec.ts` | `reactivity.html` |
| `on: 'none'` → stored, no hook | ✓ | `reactivity.spec.ts` | `reactivity.html` |
| Mixed batch → reinit only (update partial suppressed) | ✓ | `reactivity.spec.ts` | `reactivity.html` |
| Loose writes coalesce on the microtask (0 sync calls, 1 merged partial) | ✓ | `reactivity.spec.ts` | `reactivity.html` |
| One flush per tick across awaited writes | ✓ | `reactivity.spec.ts` | `reactivity.html` |
| setAttributes() / batch() flush synchronously as one call | ✓ | `reactivity.spec.ts` | `reactivity.html` |
| whenSettled() read-after-write | ✓ | `reactivity.spec.ts` | `reactivity.html` |
| flush() in an imperative method (stale vs fresh read) | ✓ | `reactivity.spec.ts` | `reactivity.html` |
| Configure detached then append → one build with the full config | ✓ | `reactivity.spec.ts` | `reactivity.html` |
| getBatchValuesCallback presets (same batch, reflected) | ✓ | `reactivity.spec.ts` | `reactivity.html` |
| Explicit write in the same batch beats the preset | ✓ | `reactivity.spec.ts` | `reactivity.html` |
| getLiveValue: getter = live state, config = assigned value | ✓ | `reactivity.spec.ts` | `reactivity.html` |
| getLiveValue: read while staged returns the assignment | ✓ | `reactivity.spec.ts` | `reactivity.html` |

## 3. Lifecycle (defer / ready / moves / removal / destroy / hook errors)

| Feature | Status | Spec | Fixture |
| ------- | :----: | ---- | ------- |
| First build order reinit → connect → onReady twin → ready event → whenReady() | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |
| isReady false sync after append, true one microtask later | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |
| ready event detail.element === el; `[ready]` attr; `:state(ready)` | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |
| After build: reinit-level → reinit, update-level → update, mixed → reinit | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |
| defer holds the first build (no hooks while held) | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |
| release() builds once with everything set while held | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |
| Removing the `defer` attribute releases | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |
| defer is latched after the first build | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |
| DOM move / reorder → disconnect + connect, no rebuild, transient state survives | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |
| Config changed while detached applies on reconnect, before connect() | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |
| removedCallback: never on a synchronous move, fires after real removal | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |
| Re-add after removedCallback → connect only (no forced reinit) | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |
| destroy() → disconnect → destroyCallback, isDestroyed | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |
| destroy() idempotent; writes after destroy run no hooks, whenSettled still resolves | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |
| Reconnect after destroy warns ("was destroyed") and stays inert | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |
| Throwing reinit() rethrown to the flusher; owed rebuild retried on next flush | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |
| Failed FIRST build: no connect()/ready until a flush succeeds | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |
| Failed first build inside connectedCallback surfaces as an uncaught page error | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |

## 4. Environment & responsive rules

| Feature | Status | Spec | Fixture |
| ------- | :----: | ---- | ------- |
| getEnvironment()/classifyDevice(): mouse = desktop at any width, breakpoint follows width | ✓ | `responsive.spec.ts` | `environment.html` |
| observeEnvironment (discrete, category flip only) vs observeViewport (every size change) | ✓ | `responsive.spec.ts` | `environment.html` |
| classifyDevice on simulated snapshots (touch short side, mouse = desktop) | ✓ | `responsive.spec.ts` | `environment.html` |
| configureBreakpoints moves lines globally; restoring defaults restores the bucket | ✓ | `responsive.spec.ts` | `environment.html` |
| resolvePresentation: map per class, defaults, forced mode | ✓ | `responsive.spec.ts` | `environment.html` |
| Touch emulation: iPad portrait = tablet device / mobile bucket; iPhone 13 = mobile / mobile | ✓ | `responsive.spec.ts` | `responsive.html` |
| Instance responsive map: breakpoint axis, device entry beats breakpoint entry, reinit on on:'reinit' key | ✓ | `responsive.spec.ts` | `responsive.html` |
| Base shows through when no map entry applies (ctx.config = base) | ✓ | `responsive.spec.ts` | `responsive.html` |
| Precedence page map → page cb → tag map → tag cb → explicit attr → instance map → instance cb (key by key) | ✓ | `responsive.spec.ts` | `responsive.html` |
| Responsive overrides never reflect | ✓ | `responsive.spec.ts` | `responsive.html` |
| Instance callback `null` = ignore page rules | ✓ | `responsive.spec.ts` | `responsive.html` |
| Dropping a layer restores the base; page rules don't leak across tags with other keys | ✓ | `responsive.spec.ts` | `responsive.html` |
| Instance callback on a custom width re-runs continuously; update() only on a changed result | ✓ | `responsive.spec.ts` | `responsive.html` |
| Fixture fits a 390px viewport (no horizontal overflow under iPhone emulation) | ✓ | `responsive.spec.ts` | `responsive.html` |

## 5. Forms (association, disabled, validity)

| Feature | Status | Spec | Fixture |
| ------- | :----: | ---- | ------- |
| el.form honours form="id"; light-DOM hidden inputs submit (inside + outside) | ✓ | `forms.spec.ts` | `forms.html` |
| Component formResetCallback; delegated change sees target.form | ✓ | `forms.spec.ts` | `forms.html` |
| isDisabled reflects; fieldset never writes isDisabled; disabledChanged only on flips; disabled drops out of FormData | ✓ | `forms.spec.ts` | `forms.html` |
| Non-reflecting isDisabled on a form-associated class warns once per class | ✓ | `forms.spec.ts` | `forms.html` |
| setFormatError: :invalid/customError, blocks submit unless novalidate, message sources, foreign anchor rejected, null clears | ✓ | `forms.spec.ts` | `forms.html` |
| Not form-associated: no-constraint validity answers, el.form === null inside a <form> | ✓ | `forms.spec.ts` | `forms.html` |

## 6. Page-wide controls (registry, logging, loader, style injection)

| Feature | Status | Spec | Fixture |
| ------- | :----: | ---- | ------- |
| window.components: tag keys only, non-enumerable logging / renderLoaderCallback | ✓ | `page.spec.ts` | `page-wide.html` |
| Registry entry created before core loaded is adopted (same object, props kept) | ✓ | `page.spec.ts` | `page-wide.html` |
| getInstances() connect order (add / move re-tracks last / remove); getRegisteredTags(); shouldAutoDefine:false + register() | ✓ | `page.spec.ts` | `page-wide.html` |
| Logging: default warn; [TAG:CAT] #id labels; invalid attr routed to INIT (or CORE:ELEMENT without a bundle) | ✓ | `page.spec.ts` | `page-wide.html` |
| Logging: page switch (CORE included), per instance, per tag, per category | ✓ | `page.spec.ts` | `page-wide.html` |
| Loader precedence instance > page > default; role/aria-label; throwing hook → logged + default; cleanup; remove() restores | ✓ | `page.spec.ts` | `page-wide.html` |
| adoptStyles shares one sheet; createStyleSlot replaces in place, null removes | ✓ | `page.spec.ts` | `page-wide.html` |

## 7. Events & before-callbacks

| Feature | Status | Spec | Fixture |
| ------- | :----: | ---- | ------- |
| emit(): twin first with the detail, then listeners (same object), el.on(), bubbles to parent + document | ✓ | `events.spec.ts` | `events.html` |
| Event detail: enumerable eventContext() extras, non-enumerable controller/element | ✓ | `events.spec.ts` | `events.html` |
| Throwing twin logged (console.error), DOM event still fires | ✓ | `events.spec.ts` | `events.html` |
| Non-composed event stops at a shadow root; composed row leaks out | ✓ | `events.spec.ts` | `events.html` |
| runBeforeCallback: unset/undefined continue, false rejects, value replaces, async awaited, throw rejects + logs | ✓ | `events.spec.ts` | `events.html` |
| runBeforeCallbackEager: sync hook same tick, redirect, async deferred, sync false | ✓ | `events.spec.ts` | `events.html` |

## 8. Actions (`/actions`)

| Feature | Status | Spec | Fixture |
| ------- | :----: | ---- | ------- |
| runAction order beforeActionCallback → onClick → built-in → twin → action event; aria-busy during | ✓ | `actions.spec.ts` | `actions.html` |
| beforeActionCallback false cancels | ✓ | `actions.spec.ts` | `actions.html` |
| Throwing onClick / built-in logged, event still fires | ✓ | `actions.spec.ts` | `actions.html` |
| Busy guard: second activation during async before-callback ignored | ✓ | `actions.spec.ts` | `actions.html` |
| resolveActionItem: component-default disabled, hidden items, toggle aria-pressed | ✓ | `actions.spec.ts` | `actions.html` |
| HTML data-action button joins in; extra data-* → detail.dataset, source "message" | ✓ | `actions.spec.ts` | `actions.html` |

## 9. Menu (`/menu`)

| Feature | Status | Spec | Fixture |
| ------- | :----: | ---- | ------- |
| openMenu context menu: roles, named divider, disabled callback, menuitemcheckbox, danger; leaf closes then runs | ✓ | `menu.spec.ts` | `menu.html` |
| Menu toggle keeps menu open + re-renders; Escape closes; beforeActionCallback veto | ✓ | `menu.spec.ts` | `menu.html` |
| Submenus static (2 levels) + lazy getChildrenCallback (loading row); outside-click dismiss | ✓ | `menu.spec.ts` | `menu.html` |
| Menu keyboard: Shift+F10, Home/End/arrows skip disabled + wrap, → / ← submenu, shortcut key, Tab closes, focus return | ✓ | `menu.spec.ts` | `menu.html` |
| Dropdown from a button: keyboard activation focuses first item; hidden item omitted | ✓ | `menu.spec.ts` | `menu.html` |
| Menu theming: page --km-menu-* + per-instance --_km-menu-* layer | ✓ | `menu.spec.ts` | `menu.html` |
| Menu dismiss on scroll / window blur | ✗ | | |

## 10. Positioning (`/positioning`: tooltip, popover, anchor)

| Feature | Status | Spec | Fixture |
| ------- | :----: | ---- | ------- |
| createTooltip: shows on hover, hides on leave; portaled to body, position: fixed | ✓ | `tooltip.spec.ts` | `tooltip.html` |
| createTooltip: shows on keyboard focus, hides on blur | ✓ | `tooltip.spec.ts` | `tooltip.html` |
| Follow-cursor + show delay: a stationary hover anchors at the cursor, not the trigger corner | ✓ | `tooltip.spec.ts` | `tooltip.html` |
| Follow-cursor: tracks the pointer across the trigger | ✓ | `tooltip.spec.ts` | `tooltip.html` |
| BlissElement-owned tooltip (connect build, on:'reinit' rebuild) | ✓ | `tooltip.spec.ts` | `tooltip.html` |
| createPopover: portaled, open/close/toggle, outside-click (page handler) | ✓ | `popover.spec.ts` | `popover.html` |
| createPopover: placement + offset + matchWidth exact | △ (exact only) | `popover.spec.ts` | `popover.html` |
| anchor(): fixed, resolved left/top, placement + offset; re-anchor | ✓ | `anchor.spec.ts` | `anchor.html` |

## 11. Null-clear contract

| Feature | Status | Spec | Fixture |
| ------- | :----: | ---- | ------- |
| Null-clear: engineConfig preserves null → engine reverts to default; delete-null loop contrast | ✓ | `nullclear.spec.ts` | `nullclear.html` |

## 12. Search (`/search`)

| Feature | Status | Spec | Fixture |
| ------- | :----: | ---- | ------- |
| /search normalized vs case-insensitive matching + highlight | ✓ | `search.spec.ts` | `search.html` |
| matchesSearchTerm lazy prepared value skipped for regex | ✓ | `search.spec.ts` | `search.html` |
| Regex compiler keeps last valid pattern | ✓ | `search.spec.ts` | `search.html` |
| findHighlightRanges NFC text from NFD input; wrapRanges escape | ✓ | `search.spec.ts` | `search.html` |
| getSearchTermCallback RegExp raw; object → none + objectTermCallback | ✓ | `search.spec.ts` | `search.html` |

## 13. Real-browser regressions

| Feature | Status | Spec | Fixture |
| ------- | :----: | ---- | ------- |
| el.form null on non-form-associated BlissElement | ✓ | `core-regressions.spec.ts` | `regressions.html` |
| Throwing environment listener doesn't stop others (discrete + viewport) | ✓ | `core-regressions.spec.ts` | `regressions.html` |
| Throwing theme listener doesn't stop others | ✓ | `core-regressions.spec.ts` | `regressions.html` |
| setAttributes() warns about a non-input key (other keys still apply) | ✓ | `core-regressions.spec.ts` | `regressions.html` |

## 14. Example site (smoke only)

| Feature | Status | Spec | Fixture |
| ------- | :----: | ---- | ------- |
| Example site smoke: index 12 cards, every page loads + elements defined, kit chrome | ✓ | `examples.spec.ts` | (example pages) |

# @keenmate/web-components-core

The shared foundation of the Keenmate web components: a reactive input model, the `BlissElement`
base class and the page-wide helpers every component builds on.

## What is it

A **library, not a component**. It defines no element of its own; it consolidates the
custom-element plumbing that the shipping components (`web-multiselect`, `web-daterangepicker`,
`web-treeview`, `web-dropzone`, `web-grid`, …) each used to re-implement — one input table with
converters for attributes, properties and callbacks, the `BlissElement` lifecycle, typed events,
categorized logging and the `window.components` global — into one package, so correctness lives
in a single place and can't drift.

Around that core sit the helpers several components need on the same page: device / viewport
classification and presentation (floating panel vs fullscreen sheet), page-wide responsive rules,
theme context, motion level, a shared scroll lock and overlay tree, container scroll, and the
`/positioning`, `/menu`, `/search`, `/actions`, `/testing` and `/cem` subpaths.

> **[`docs/SPEC.md`](docs/SPEC.md) is the source of truth** for design intent. This README is
> the landing page; read the relevant SPEC section before changing behavior.

## What's New in v1.0.0-rc25

Upgrade guide: the [1.0.0-rc25 release notes](release-notes/1.0.0-rc25.md); full list: the [CHANGELOG 1.0.0-rc25 section](CHANGELOG.md).

The consolidation release: the copies the Keenmate components kept of the same plumbing move into core. No change for apps on the released components; component authors adopt the helpers, implement `iconsChanged()` and regenerate their manifests.

- **`/locale` — one page-wide locale and one label chain** — Every component resolved its UI strings, separators and date patterns its own way. The new `/locale` subpath reads `window.components.locale` (locale, date / time format, week start, separators, labels, `translateCallback`, `parseNumberCallback`) and derives the rest from `Intl`. `createLabels(host, defaults, getOwn, { tag })` resolves instance → page dictionary → English with flat `<elementType>.<name>` keys prefixed by the component name (`web-grid.buttons.add`), so an app assigns its whole translation JSON once. Unset `ariaLabels.x` / `tooltips.x` follow a translated visible twin (WCAG 2.5.3), number params are locale-formatted, and `parseNumber` now checks group positions (`'1.5'` in `de` is no longer 15). The opt-in `localeChanged()` hook re-renders on a change.
- **Icons — `renderIcon`, a page hook, and `iconsChanged()`** — An icon string now has one reading in every component and in `/menu`: markup raw, a built-in name masked from `--base-icon-<name>`, then the element's own and the page-wide `window.components.renderIconCallback`, then icon-font classes (`<i class="<prefix>__icon fa-solid fa-folder">`), then text. Because the page hook may be set after components rendered, setting or replacing it calls the opt-in `iconsChanged()` hook (`observeIconHook()` outside a BlissElement). A word that isn't built-in (`'gear'`) is no longer drawn as text — use a built-in name or map it in the hook.
- **Modals, panels, dialogs — `startModalSession`, `startPanelSession`, `/dialog`** — The components wired their modals by hand and none trapped focus. `startModalSession()` makes the page inert, traps Tab, handles Escape through the overlay tree, phone Back, the backdrop and the scroll lock with one `end()`, and swallows the ghost click of a press-opened panel. `startPanelSession()` is the non-modal sibling for drawers the page stays usable around. `/dialog` adds styled, translatable `openDialog` / `confirmDialog` / `promptDialog` to replace `window.confirm` / `window.prompt`; `Z_INDEX` fixes the stacking tiers.
- **Lists and keyboard — `/a11y`, `createVirtualWindow`, `createSelection`** — `createActiveDescendant` (focus stays in the input) and `createRovingFocus` (one tab stop, RTL-aware, typeahead) replace the per-component key handling and never scroll the page. `createVirtualWindow` renders only the visible rows of a fixed-row list (pinned rows, a header above row 0) and replaces the multiselect, treeview and grid copies; `createSelection` owns the selected keys and anchor with click / Ctrl / Shift rules.
- **Drag, clipboard, text input — touch-capable and IME-safe** — `createPointerDrag` runs in-page drags on pointer events, so a long press drags with a finger, the container auto-scrolls and Escape cancels; `createLayer` draws the ghost outside the component in its theme. `observePageDrag` gives drop targets the page-wide "files over the page" state. `copyText` falls back to `execCommand` on plain-http intranets, and `observeTextInput` / `isImeEnter` deliver one callback per committed text through IME composition.
- **Tooltips fade out** — `createTooltip` keeps a hidden tooltip mounted until its opacity transition ends, with core's `TOOLTIP_CSS` (fade + 4px slide on `--base-duration-fast`, in `@layer component` so component rules win) on every `.km-tooltip`; reduced motion removes it at once. `data-placement` carries the resolved placement after flip / shift. The delegated mode (`selector`) serves every matching target with one tooltip, replacing the per-cell / per-day layers web-grid and web-daterangepicker built over `anchor()`.
- **Responsive rules — the `container` axis** — Rules can be keyed by the component's OWN width (`narrow` / `medium` / `wide`, lines from `--base-container-narrow` / `-medium` read at the element), so a component in a sidebar adapts on a wide monitor. It replaces per-component thresholds such as web-daterangepicker's `compact-below`.
- **Forms and labels — `isRequired`, `{ctx.*}` templates** — None of the form-associated components could be made required, and web-dropzone set its minimum-count validity straight on the internals, wiping core's flags. A class with an `isRequired` row now implements `isValueEmpty()` and calls `refreshRequired()`; core sets `valueMissing` (never while readonly / disabled), `aria-required` on the host and on the focused inner input, and `:state(required)`, through `setValidityFlag` so a format error and a missing value never clear each other. Label templates read dotted paths (`{ctx.remaining}`): a component passes its text spot's context, and `ctx.count` is the number the noun agrees with, so one generic `translateCallback` (i18next / ICU) pluralizes every key.
- **`/cem` — the manifest is the public API** — `blissAnalyzerConfig()` now runs `publicApiPlugin()`: private / protected members and everything `src/index.ts` doesn't re-export are dropped, following re-export chains (web-treeview's manifest went from 19k to 12k lines). Regenerate each component's `custom-elements.json`; `isPublicApiOnly: false` keeps the full output.

## What's New in v1.0.0-rc24

Upgrade guide: the [1.0.0-rc24 release notes](release-notes/1.0.0-rc24.md); full list: the [CHANGELOG 1.0.0-rc24 section](CHANGELOG.md). Also carries 1.0.0-rc23, which was never published.

Phone sheets finished, and one rule for animations. No code change needed unless you style the menu sheet's header padding / title weight.

- **One sheet header — `SHEET_CHROME_CSS` + `createSheetHeader()`** — `/menu`, web-grid, web-multiselect, web-daterangepicker and web-dropzone each drew the top bar of their phone sheet on their own. Core now builds it: a title and a round 44px ✕ whose tap area reaches the corner, themed with `--km-sheet-*` page-wide and `--<prefix>-sheet-*` per component (19 shared suffixes).
- **`claimBackEntry()` — one phone Back gesture, and the page keeps its scroll** — Four copies of "push a history entry so Back closes the sheet" become one helper: one entry for the page, Back runs the newest `onBack`, the next sheet takes the entry over. Closing a sheet no longer scrolls the page to the top: the browser had recorded scroll 0 while the page was locked.
- **`/menu` — side drawer, per-device presentation, animations** — `presentation: 'drawer'` + `side`, a `presentationMap` per device class (`{ tablet: 'drawer' }`), an open menu that follows a device-class change, the standard `menu-presentation` / `menu-side` inputs via `createMenuPresentationInputs()`, and a slide + fade on the motion tokens. Menus now stack at 9001 (was 10000).
- **`animateOut()` and one motion switch** — Something that disappears has to wait for its closing animation; `animateOut(elements, { className, doneCallback })` adds the class, waits for each element's own `animationend` (with a timeout for hidden tabs), runs `doneCallback` at once when motion is off, and can be cancelled mid-close. `motion` is the only animation switch — no `is…AnimationEnabled` inputs; one animation is turned off with its own `--<prefix>-<what>-animation-duration: 0s` token.
- **Follow-cursor tooltip scrolls with its trigger** — On a phone a tapped card kept its tooltip floating over the page after the card scrolled away; the cursor point is now kept relative to the trigger.

Earlier releases: [1.0.0-rc22](release-notes/1.0.0-rc22.md) · [1.0.0-rc21](release-notes/1.0.0-rc21.md) · [1.0.0-rc20](release-notes/1.0.0-rc20.md) · [1.0.0-rc19](release-notes/1.0.0-rc19.md) · [1.0.0-rc18](release-notes/1.0.0-rc18.md) · [1.0.0-rc17](release-notes/1.0.0-rc17.md) · [1.0.0-rc16](release-notes/1.0.0-rc16.md) · [1.0.0-rc15](release-notes/1.0.0-rc15.md) · [1.0.0-rc14](release-notes/1.0.0-rc14.md)

## Demos & docs

- **Demo site** — `npm run dev` (http://localhost:15000): one page per area, every chapter live on small demo elements. The pages are listed in [docs/examples.md](docs/examples.md).
- [Usage / API reference](docs/usage.md) — inputs and converters, `BlissElement`, environment, responsive rules, motion, registration, logging, every subpath, the API index.
- [Theming](docs/theming.md) — the theme context and the menu's `--km-menu-*` / `--base-*` contract.
- [Examples](docs/examples.md) — worked patterns beyond the quick start.
- [Accessibility](docs/accessibility.md) — the menu keyboard, ARIA, focus return, overlays, motion.
- [Reactivity and batching](docs/reactivity-and-batching.md) — how the pipeline coalesces bursts, `reinit()` vs `update()`, mass updates.
- [SPEC](docs/SPEC.md) — full design intent and the decisions log.

## Install

```
npm install @keenmate/web-components-core
```

One runtime dependency, **`@floating-ui/dom`**, used only by the `/positioning` subpath, so it
stays out of the base import graph unless you position. The logging engine is vendored.

## Quick start

```ts
import { BlissElement, define, toInt, toText, type InputDef } from '@keenmate/web-components-core';

class HelloCounter extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'label', attribute: 'label', converter: toText({ default: 'Clicks' }), on: 'update' },
    { configKey: 'count', attribute: 'count', converter: toInt({ min: 0, default: 0 }), on: 'update', shouldReflect: true },
  ];

  #output?: HTMLElement;

  protected override reinit(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = '<button part="button"></button>';
    this.#output = root.querySelector('button')!;
    this.#render();
  }

  protected override update(): void {
    this.#render();
  }

  #render(): void {
    this.#output!.textContent = `${this.config.label}: ${this.config.count}`;
  }
}

define('hello-counter', HelloCounter);
```

Each input is one row: its converter parses the attribute (`<hello-counter count="3">`) **and**
validates the property (`el.count = 3`), so both entry points share one pipeline. A burst of
changes coalesces into one `update()`; an invalid value warns, keeps the previous one and fires
`input-rejected`. See [usage.md](docs/usage.md) for the lifecycle, events and the rest of the API.

## Browser support

Modern evergreen browsers (Chrome, Edge, Firefox, Safari) with native custom elements, shadow
DOM, `adoptedStyleSheets` (a `<style>` fallback is built in) and CSS `@layer`. SSR-safe: every
entry point imports without a DOM. No polyfills shipped.

## About

Authored and maintained by [Keenmate s.r.o.](https://keenmate.com/).
The library ships standalone with sensible light/dark defaults for what it renders (the shared
menu); when mounted inside [Pure Admin](https://pureadmin.io/) — or any
host that publishes the `--base-*` taxonomy via
[`@keenmate/theme-designer`](https://www.npmjs.com/package/@keenmate/theme-designer) — it adopts the host's colors,
typography, and sizing automatically. There is no runtime
dependency on Pure Admin; the integration is opt-in via CSS
variables.

## Built with BlissFramework

Follows the [BlissFramework component guidelines](https://blissframework.dev/)
for structure, naming, theming and documentation.

## License

MIT — see [LICENSE](LICENSE).

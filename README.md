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

## What's New in v1.0.0-rc22

Upgrade guide: the [1.0.0-rc22 release notes](release-notes/1.0.0-rc22.md); full list: the [CHANGELOG 1.0.0-rc22 section](CHANGELOG.md).

Phone menus, custom CSS for the elements a component mounts, and four fixes found while moving web-grid and web-dropzone onto core's popups. No code change needed.

- **`/menu` — a bottom sheet on phones** — On a phone a context or column menu opened as a small floating panel next to the press, while web-multiselect, web-dropzone and web-grid's cell editors already used a full-width sheet. `openMenu()` now takes `presentation: 'auto' | 'floating' | 'sheet'`; the default `'auto'` uses the same `resolvePresentation()` switch as those components, so every component's menus become a bottom sheet on phones with no component change: a backdrop, safe areas, 44px rows from `--base-touch-target-min`, a header from the new `title` option, a close button, submenus that drill in with a Back row, and the phone Back button going up one level or closing. New `onClose` reasons `'back'` and `'close-button'`; tablet and desktop are unchanged, and `'floating'` opts out.
- **Custom CSS — a managed child takes its owner's styles** — web-dropzone's bulk mode mounts its own picker, list and progress elements, each with its own shadow root, so CSS a page gave the dropzone never reached most of what the user sees. `createCustomStyles()` takes `getOwner`: the child then also gets the owner's page and instance layers, ordered child page → owner page → owner instance → child instance, and refreshes when either changes. Without an owner nothing changes.
- **Theme — no mixed scheme on a panel moved to `<body>`** — `inheritThemeFrom` copied each theme attribute from its own nearest carrier, so a section's `data-theme="dark"` above a light component reached the panel next to the component's `data-context-theme="light"`, and the panel turned dark. Above the component host core has resolved, `data-theme` / `data-bs-theme` are no longer copied; the host's own `data-theme` still is.
- **Scroll lock — no phantom padding on a wide phone page** — `lockBodyScroll()` computed the scrollbar width as `innerWidth - clientWidth`, which on a zoomed-out phone page measured the horizontal overflow (651px in web-grid's phone fixture) and shoved the page sideways when a sheet opened. It now measures the root's width before and after pinning, so only a vertical scrollbar that actually disappears is compensated: 0 on touch devices and with overlay scrollbars.
- **`/cem` — renamed imports are found** — `registerComponent('web-grid', _GridElement)` with an aliased import produced "No components found", because the plugin matched the class by its written name, and a registration analyzed before its class module could be missed. Aliases, default imports and relative re-exports now resolve to the declaration, linking no longer depends on module order, and an unresolvable registration is a build warning naming the tag.
- **SPEC — readonly text surfaces and store / satellite components** — §6.4: a readonly editor or code view needs focus, select and copy; a moving caret is optional. §6.4 / §11.4: only a satellite that is itself a data-input surface gets `isDisabled` + `isReadonly`, satellite events go through `emit()` (so the `on*` callback and the manifest entry come free), and satellites take their owner's custom CSS.

## What's New in v1.0.0-rc21

Upgrade guide: the [1.0.0-rc21 release notes](release-notes/1.0.0-rc21.md); full list: the [CHANGELOG 1.0.0-rc21 section](CHANGELOG.md).

The upgrade covers the gaps the alignment of all seven components found in core, each validated in every component before release, and the disabled / readonly rule for data-input components. No code change needed.

- **Scroll close — the browser's own scrolls no longer close a layer, the component's own scroller does** — WebKit fires `focus` (which opens a focus-triggered popover) a frame before it scrolls the focused input into view, and Firefox follows that scroll with a 1px correction; both closed a just-opened calendar or dropdown. `watchScrollClose()` (used by `createPopover()` and `openMenu()`) now gives a focus-opened, not-yet-visible reference two frames to settle and needs a 3px move. A right-click menu now belongs to the element under the pointer, so scrolling web-grid's or web-treeview's body closes it instead of leaving it at stale coordinates.
- **Positioning — one field → panel gap, `--base-dropdown-offset`** — web-multiselect opened its dropdown 4px below the field and web-daterangepicker its calendar 8px, so one form had two gaps. `anchor()` (and so `createPopover()` and an element-anchored `openMenu()`) now uses the page token `--base-dropdown-offset` from `@keenmate/base-css-variables` 2.0.1 (`4px`) as its default `offset`, read on the reference element, and components pass none. The token inherits, so a page sets it on `:root`, a section or a component tag; an explicit `offset` still wins, and tooltips and right-click menus keep their own spacing.
- **`/cem` — the same sources give the same manifest** — `blissAnalyzerConfig()` now runs `stableOutputPlugin()` right after the inputs plugin. It converts every manifest string to LF, because a Windows `autocrlf` checkout put CRLF into descriptions. It also sorts the modules by path, because the analyzer's order varied from run to run. Two builds in a row now leave `custom-elements.json`, `web-types.json` and the VS Code data unchanged, so components drop their local workaround. Shared input rows imported from a sibling module (`...SATELLITE_INPUTS`) now reach the manifest too.
- **Persisted UI state — one way, `createStateStore()`** — web-dropzone kept its popover size through `storage-key` + `persistStateCallback`, web-grid its column widths / order in localStorage only, and web-commandpalette its favorites under `usage-key`; three names, three key formats, three callback shapes. SPEC §12.17 now defines one: the input rows `storage-key` (unset = off), `loadStateCallback` and `saveStateCallback` (the whole state), and one handle, `createStateStore()`, that keeps it in `localStorage['km-state:<tag>:<key>']` by default or hands it to the host. Rulebook C-CA-17 rejects a component's own `localStorage` code.
- **Scroll — `scrollContainerToBox()` for a row that isn't rendered** — `scrollIntoContainer(el)` needs an element, so a virtual list jumping to a row by index (`scrollToIndex()`, PageUp / PageDown) carried its own math: web-multiselect, web-treeview and web-grid each had a copy of the start / center / end / nearest arithmetic. The target is now a box in content coordinates (`{ top: index × rowHeight, height }`) with the same rules and `scroll-padding`, plus `insetTop` for a sticky header; `getScrollTopForBox()` computes without scrolling, for a list that renders its window first.
- **`deepActiveElement()` and `escapeHtml()` on the main index** — the element that really has focus, looking inside shadow roots (core had two private copies, web-commandpalette a third), and the HTML escape that was only on `/search`, which now takes any value (`null` → `''`, numbers stringified). `/search` keeps exporting the same function.
- **Disabled / readonly — one rule for data-input components** — SPEC §6.4 now says every component the user enters or changes data in has both `isDisabled` and `isReadonly` (`disabled` / `readonly`, presence booleans, reflected), with native meaning. Disabled means no interaction, not focusable and not submitted. Readonly means the data can't change but the component stays focusable, navigable and copyable, and its value is submitted. Calls from code still work under both. Show / launch components (a command palette) have neither.

Earlier releases: [1.0.0-rc20](release-notes/1.0.0-rc20.md) · [1.0.0-rc19](release-notes/1.0.0-rc19.md) · [1.0.0-rc18](release-notes/1.0.0-rc18.md) · [1.0.0-rc17](release-notes/1.0.0-rc17.md) · [1.0.0-rc16](release-notes/1.0.0-rc16.md) · [1.0.0-rc15](release-notes/1.0.0-rc15.md) · [1.0.0-rc14](release-notes/1.0.0-rc14.md)

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

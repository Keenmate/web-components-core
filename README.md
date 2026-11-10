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

## What's New in v1.0.0-rc21

**[Release notes](release-notes/1.0.0-rc21.md)** cover the upgrade: the gaps the alignment of all seven components found in core, each validated in every component before release, and the disabled / readonly rule for data-input components. No code change needed.

- **Scroll close — the browser's own scrolls no longer close a layer, the component's own scroller does** — WebKit fires `focus` (which opens a focus-triggered popover) a frame before it scrolls the focused input into view, and Firefox follows that scroll with a 1px correction; both closed a just-opened calendar or dropdown. `watchScrollClose()` (used by `createPopover()` and `openMenu()`) now gives a focus-opened, not-yet-visible reference two frames to settle and needs a 3px move. A right-click menu now belongs to the element under the pointer, so scrolling web-grid's or web-treeview's body closes it instead of leaving it at stale coordinates.
- **Positioning — one field → panel gap, `--base-dropdown-offset`** — web-multiselect opened its dropdown 4px below the field and web-daterangepicker its calendar 8px, so one form had two gaps. `anchor()` (and so `createPopover()` and an element-anchored `openMenu()`) now uses the page token `--base-dropdown-offset` from `@keenmate/base-css-variables` 2.0.1 (`4px`) as its default `offset`, read on the reference element, and components pass none. The token inherits, so a page sets it on `:root`, a section or a component tag; an explicit `offset` still wins, and tooltips and right-click menus keep their own spacing.
- **`/cem` — the same sources give the same manifest** — `blissAnalyzerConfig()` now runs `stableOutputPlugin()` right after the inputs plugin. It converts every manifest string to LF, because a Windows `autocrlf` checkout put CRLF into descriptions. It also sorts the modules by path, because the analyzer's order varied from run to run. Two builds in a row now leave `custom-elements.json`, `web-types.json` and the VS Code data unchanged, so components drop their local workaround. Shared input rows imported from a sibling module (`...SATELLITE_INPUTS`) now reach the manifest too.
- **Persisted UI state — one way, `createStateStore()`** — web-dropzone kept its popover size through `storage-key` + `persistStateCallback`, web-grid its column widths / order in localStorage only, and web-commandpalette its favorites under `usage-key`; three names, three key formats, three callback shapes. SPEC §12.17 now defines one: the input rows `storage-key` (unset = off), `loadStateCallback` and `saveStateCallback` (the whole state), and one handle, `createStateStore()`, that keeps it in `localStorage['km-state:<tag>:<key>']` by default or hands it to the host. Rulebook C-CA-17 rejects a component's own `localStorage` code.
- **Scroll — `scrollContainerToBox()` for a row that isn't rendered** — `scrollIntoContainer(el)` needs an element, so a virtual list jumping to a row by index (`scrollToIndex()`, PageUp / PageDown) carried its own math: web-multiselect, web-treeview and web-grid each had a copy of the start / center / end / nearest arithmetic. The target is now a box in content coordinates (`{ top: index × rowHeight, height }`) with the same rules and `scroll-padding`, plus `insetTop` for a sticky header; `getScrollTopForBox()` computes without scrolling, for a list that renders its window first.
- **`deepActiveElement()` and `escapeHtml()` on the main index** — the element that really has focus, looking inside shadow roots (core had two private copies, web-commandpalette a third), and the HTML escape that was only on `/search`, which now takes any value (`null` → `''`, numbers stringified). `/search` keeps exporting the same function.
- **Disabled / readonly — one rule for data-input components** — SPEC §6.4 now says every component the user enters or changes data in has both `isDisabled` and `isReadonly` (`disabled` / `readonly`, presence booleans, reflected), with native meaning. Disabled means no interaction, not focusable and not submitted. Readonly means the data can't change but the component stays focusable, navigable and copyable, and its value is submitted. Calls from code still work under both. Show / launch components (a command palette) have neither.

## What's New in v1.0.0-rc20

**[Release notes](release-notes/1.0.0-rc20.md)** cover the upgrade: gaps the first component alignments found in core itself — fonts in custom CSS, values set before a component loads, overlay and menu dismissal, the phone scroll lock, and theme on portaled panels.

- **Custom CSS — `@import`ed fonts work in a shadow root** — Chromium ignores `@font-face` inside a shadow root, so an icon font a page imports through `customStyles` / `getCustomStylesCallback` drew boxes. `createCustomStyles()` now also links each `@import` once in the document `<head>`, shared by every instance and released when the last one stops importing it or is removed from the page; `layer()` / media / `supports()` are kept, and a stylesheet the page links itself is reused. A page that loads its fonts itself switches it off with `window.components.shouldHoistImports = false` (or per component type).
- **Custom CSS — one adoption for every component** — `docs/usage.md` shows the one way a component adopts `createCustomStyles()` (two input rows, one handle), and rulebook check C-CA-15 enforces it. Core warns when a page sets `window.components[tag].customStyles` for a component that never applies it, instead of silently ignoring the value.
- **Values set before a component loads are kept** — `el.value = …` (web-multiselect, web-daterangepicker) or `el.items` / `el.columns` (web-grid) assigned before the component's script loaded hid the component's setter for good. Core now lifts every such early property and replays it through the real setter before the first build; components need no rescue code.
- **Overlays — dismissal that holds up** — An outside click whose propagation a page handler stops (web-treeview's checkbox) closes overlays again. `createPopover()` closes when its reference leaves the page (`'reference-removed'`, a re-rendered row). `openMenu()` now closes on scroll by the popover's rule, one shared helper: only a scroll that moves what the menu belongs to — no unrelated scroller, no bare mouse wheel.
- **Phone sheets over a page wider than the screen** — `lockBodyScroll()` also locks `<html>` sideways while held, so the browser no longer stays zoomed out and a fullscreen sheet (web-daterangepicker, web-commandpalette) fills the screen. web-multiselect did this on its own until now.
- **Portaled panels keep the component's theme and motion** — `anchor()`'s `inheritThemeFrom` also copies the effective scheme `data-context-theme` (Tailwind `.dark`, `setThemeMode()`, `theme-source`) and `data-motion` onto a panel moved to `<body>`, so tooltips, popovers and menus match the component.
- **Input-table check — dead class members** — An input named like the component's own getter / setter / method silently replaced it; the once-per-class check now warns. The SPEC also records the rule that core hooks stay `protected` (batch writes are `setAttributes()`, rulebook C-CA-14).

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

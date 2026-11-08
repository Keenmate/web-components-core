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

## What's New in v1.0.0-rc19

**[Release notes](release-notes/1.0.0-rc19.md)** cover the upgrade: `createPopover()` grows to carry a component's big dropdown (web-multiselect's now runs on it), outside clicks are decided when the click ends, and three renames.

- **`createPopover()` — open, mounted and anchored kept apart** — A component-owned panel can stay mounted (`shouldKeepMounted`, open / close toggle `visibleClass`), open without being positioned (`isAnchored: false` / `setAnchored()` for a fullscreen sheet) and re-read its reference while open (`reanchor()`, `reference` as a function). The panel can live in a `ShadowRoot`, stays `visibility: hidden` until its first position, and `onClose(reason)` now fires for every close, including `close()` / `destroy()` (`'api'`).
- **Close rules — scroll, resize and functions** — `shouldCloseOnScroll` closes like a native select: only a scroll of the page or a scroller around the reference, once the reference has actually moved (a scroll inside the panel or a late scroll event never counts). `shouldCloseOnResize`, every `shouldCloseOn*` as a function asked each time, `getInsideElements` and `returnFocusTo` complete the set; the overlay tree (`registerOverlay()`) takes the same options.
- **Overlay tree — outside clicks decided when the click ends** — An overlay closes only when the click both started and ended outside it, after the page's own handlers ran (like the browser's popover light dismiss). A page button that drives an overlay through its API no longer closes it on the press for the click to reopen it; an API method can call `claimCurrentClick()`. A keyboard click and a cancelled touch close nothing.
- **Page-wide custom CSS per component type** — `window.components[tag].customStyles` (or `getCustomStylesCallback(ctx)`) styles every instance of a component on the page, before each instance's own custom CSS. Components adopt it through `createCustomStyles()`.
- **`theme-source="closest"` — follows a section themed later** — A section that gets `data-theme="dark"` after the component connected now reaches it; core re-resolves whenever an ancestor gains or loses a theme signal.
- **`anchor()` — `fallbackPlacements`, sizes restored** — The placements flip tries, in order; `destroy()` puts back the `width` / `min-width` / `max-width` / `max-height` it wrote.
- **Renames (BREAKING)** — `PointerType` → `PointerAccuracy` and `ExtractedType` → `ExtractedTypeAnnotation` (the rulebook's closed type-suffix set); `lockPlacement` is the named mode `PlacementLock` (`'initial' | 'freeze' | false`), so `true` becomes `'initial'`. No aliases.

## What's New in v1.0.0-rc18

**[Release notes](release-notes/1.0.0-rc18.md)** cover the upgrade: the results of a full code review, with every API change in this one release so each component migrates once.

- **Page-wide state — many components, one page** — The scroll lock, breakpoints, overlay dismissal, instance registry and logging switch are shared by every component's bundled copy of core, so two components built against different copies no longer fight over the page. A throwing hook or listener no longer silences the others or leaves an element half-activated.
- **Overlay tree — nested overlays** — A menu inside a dropdown, or a dropdown inside a modal `<dialog>`, keeps its parent open. Escape closes one level at a time and outside clicks are routed through the tree.
- **Logging — the closest level wins** — The level resolves element → type → page → `warn`, with `resetLogging()` at every layer. BREAKING: `el.disableLogging()` now silences.
- **API — renames (BREAKING)** — Notification hooks are `on*` (`onClose`, `onPlaced`, `onDrift`, …); also `createMenuDivider()`, `openMenu({ labels: { loading } })`, `toEnum({ isNullable })`, the page hook `renderLoadingCallback`, and the default loader class `<prefix>__loader`.
- **`input-rejected` — refused values are reported** — Every invalid attribute / property write fires `input-rejected` (`{ configKey, value, reason?, kept, … }`) before it returns, and `setAttributes()` returns the list, so a framework wrapper can surface the error instead of only a console warning.
- **Converters — safer inputs** — Strict number parsing, `el.x = undefined` resets, `toText` accepts `''`, and a new `toCssLength()`. `wrapRanges()` escapes by default, with `highlightHtml()` for trusted labels.

See [`CHANGELOG.md`](CHANGELOG.md) for the full list.

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

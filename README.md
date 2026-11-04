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

## What's New in v1.0.0-rc18

**[Release notes](release-notes/1.0.0-rc18.md)** cover the upgrade: the results of a full code review, with every API change in this one release so each component migrates once.

- **Page-wide state — many components, one page** — The scroll lock, breakpoints, overlay dismissal, instance registry and logging switch are shared by every component's bundled copy of core, so two components built against different copies no longer fight over the page. A throwing hook or listener no longer silences the others or leaves an element half-activated.
- **Overlay tree — nested overlays** — A menu inside a dropdown, or a dropdown inside a modal `<dialog>`, keeps its parent open. Escape closes one level at a time and outside clicks are routed through the tree.
- **Logging — the closest level wins** — The level resolves element → type → page → `warn`, with `resetLogging()` at every layer. BREAKING: `el.disableLogging()` now silences.
- **API — renames (BREAKING)** — Notification hooks are `on*` (`onClose`, `onPlaced`, `onDrift`, …); also `createMenuDivider()`, `openMenu({ labels: { loading } })`, `toEnum({ isNullable })`, the page hook `renderLoadingCallback`, and the default loader class `<prefix>__loader`.
- **`input-rejected` — refused values are reported** — Every invalid attribute / property write fires `input-rejected` (`{ configKey, value, reason?, kept, … }`) before it returns, and `setAttributes()` returns the list, so a framework wrapper can surface the error instead of only a console warning.
- **Converters — safer inputs** — Strict number parsing, `el.x = undefined` resets, `toText` accepts `''`, and a new `toCssLength()`. `wrapRanges()` escapes by default, with `highlightHtml()` for trusted labels.

## What's New in v1.0.0-rc17

**[Release notes](release-notes/1.0.0-rc17.md)** cover the upgrade: the motion level, plus one rename in the rc16 scroll API.

- **`motion` — one motion level for every component** — `motion="auto | none | snappy | smooth"` on every component, `window.components.motion` page-wide, and `data-motion` on any element (a section, `<html>`) for everything inside, with or without base-css-variables. Components follow through the shared `--base-duration-*` / `--base-scroll-behavior` tokens; **the OS reduced-motion setting always wins**. Live demo: `examples-motion.html`.
- **`scrollIntoContainer()` — `revealContainer` → `shouldRevealContainer` (BREAKING)** — The rc16 option follows the boolean naming rule; same behaviour.

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

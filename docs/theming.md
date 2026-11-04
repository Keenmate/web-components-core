# Theming — @keenmate/web-components-core

Core is a library, not a component: it ships **no component stylesheet of its own**. Each
component owns its CSS, its `--<prefix>-*` variables and its theme container (see that
component's `docs/theming.md`). What core contributes to theming is:

- **The theme context** — every `BlissElement` host gets `data-context-theme="dark|light"`
  when the page asks for a scheme, so a component's CSS can switch without
  `:host-context()`. See below.
- **The motion tokens** — `motion` / `data-motion` drive the shared `--base-duration-*` /
  `--base-scroll-behavior` tokens (CSS from `adoptMotionStyles()`); see
  [usage.md → Motion level](usage.md#motion-level-none--snappy--smooth).
- **The CSS of the modules it renders** — the `/menu` context / dropdown menu (`MENU_CSS`),
  which reads the `--base-*` theme taxonomy, a page-wide `--km-menu-*` layer and the
  component's own variables. See [Menu theming](#menu-theming).
- **The default loader element** — `renderLoader()` draws `<span class="<prefix>__loader">`
  but does **not** style it: the component's CSS draws the class. A page can replace the
  loader everywhere with the `renderLoadingCallback` hook (see
  [usage.md → API index](usage.md#api-index), `publishLoaderHook()`).
- **Overlay theme inheritance** — `anchor()` / `createPopover()` take `inheritThemeFrom`,
  which copies `data-theme` onto a layer portaled to `<body>` so it keeps its component's
  scheme (C-CS-10).

Standalone, every value falls back to a built-in light / dark default; inside
[Pure Admin](https://pureadmin.io/) or any page that publishes the `--base-*` taxonomy (for
example via [`@keenmate/theme-designer`](https://www.npmjs.com/package/@keenmate/theme-designer)),
the menu adopts the host's colours and typography.

## Theme context (dark / light)

Every `BlissElement` host carries `data-context-theme="dark|light"` when the page
asks for a scheme, so component CSS needs no `:host-context()` (unsupported in
Firefox, partial in Safari):

```css
:host([data-context-theme="dark"])  { color-scheme: dark; }
:host([data-context-theme="light"]) { color-scheme: light; }
/* per-instance forcing, declared last so it wins */
:host([data-theme="dark"])  { color-scheme: dark; }
:host([data-theme="light"]) { color-scheme: light; }
```

Resolution, highest first: `data-theme` on the component (its CSS) →
`setThemeMode('dark' | 'light')` → the component's `theme-source` → the page
(`<html>`, then `<body>`: `data-theme`, `data-bs-theme`, `.dark` / `.light`) →
nothing (the inherited `color-scheme` applies). Detection runs **once** per
watched element and is cached; one shared `MutationObserver` per element
re-detects on a signal change, and components hear only real changes.

```ts
import { setThemeMode, getThemeContext } from '@keenmate/web-components-core';

setThemeMode('dark');  // force every component ('auto' = detect again)
getThemeContext();     // the detected page scheme: 'dark' | 'light' | null
```

```html
<my-el theme-source="closest"></my-el>      <!-- nearest ancestor with a signal -->
<my-el theme-source=".admin-panel"></my-el> <!-- a chosen element -->
```

Override `themeChanged(scheme)` for JS-side theming; `static hasThemeContext = false`
opts a component out. See [SPEC §12.10](SPEC.md) and `examples-theme.html`.


## Menu theming

Every menu value resolves, highest precedence first:
**component variable** (one instance) → **`--km-menu-*`** (every menu on the page) →
**`--base-*`** (theme) → literal default.

```css
:root { --km-menu-bg: #fffbe6; }                      /* every menu on the page */
web-tree-view.files { --wtv-context-menu-bg: #eef; }  /* just this tree's menu */
```

A component that renders a menu maps its variables onto the **private**
`--_km-menu-*` layer, with no fallback, and never sets `--km-menu-*` itself:

```css
:host {
  --_km-menu-bg: var(--wtv-context-menu-bg);          /* unset → falls through to --km-menu-bg */
  --_km-menu-hover-color: var(--wtv-context-menu-hover-color);
}
```

The full variable list (with each one's `--base-*` fallback and default) ships as
[`component-variables.manifest.json`](../component-variables.manifest.json)
(`@keenmate/web-components-core/component-variables.manifest.json`).


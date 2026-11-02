## Style injection (`src/dom/adopt-styles.ts`, SPEC §12.8 — implemented)

Two zero-dep free functions in the main index (core stays render-agnostic — no
shadow-DOM assumptions in `BlissElement`, so these are NOT methods).
`adoptStyles(root, ...cssStrings)` adopts static shared stylesheets (cached
`CSSStyleSheet` per string, shared across instances, `<style>` fallback,
SSR-safe, dedup per root) — the `main.css?inline` case. `createStyleSlot(root, {
position?, cssClass? })` → `{ set, clear, destroy }` is a per-instance
replaceable `<style>` slot for the `customStylesCallback` case (consistent
position so re-set replaces; `<style>`-based so user `@import` works). Authoring
rules (`@layer` order, `?inline`) stay CSS-guideline, not code.

## Loader (`src/dom/render-loader.ts`, SPEC §12.14 — implemented)

`renderLoader(host, container, context, { label, prefix, renderLoadingCallback? })`
→ idempotent `remove()`. Precedence: instance hook (option key present wins, else
`host.renderLoadingCallback`) > `window.components.renderLoaderCallback` > default
`<span class="<prefix>-loader" aria-hidden>`. Only the highest present hook runs; if it
throws → logged + default drawn. Container always `role="status"` (+ `aria-label` when
`label` non-empty); `remove()` drops only nodes the render added and restores the
previous `role` / `aria-label`. The page hook is a non-enumerable accessor published by
`publishLoaderHook()` (from `registerComponent()` + every `renderLoader()`); it adopts a
plain property assigned earlier. No CSS here — the component owns `.<prefix>-loader`.

## Container scroll (`src/dom/scroll-container.ts`, SPEC §12.15 — implemented)

`findScrollContainer(el, { stopAt?, axis? })` / `scrollIntoContainer(el, { block, inline,
behavior, container?, shouldRevealContainer?, stopAt?, axis? })` — scroll the ONE container around
`el`, never the page. Flat-tree walk (`assignedSlot` → parent → shadow host; local
`flatParent`, `composedParent` itself is unchanged — theme / containing-block rely on it).
Never returns html/body/scrollingElement. Honours container `scroll-padding` + element
`scroll-margin`; logical `inline` (RTL swaps start/end); no `scrollTo()` when < 1px on both axes.
No container → `el.scrollIntoView({ block, inline, behavior })` (the caller's request goes to
the page), returns `null`. Uses `el.ownerDocument.defaultView` (iframe-safe). Limits: scaled
containers, vertical writing modes, nested scrollers (innermost only). jsdom has no layout: the unit test
fakes geometry; the real checks are `e2e/scroll.spec.ts` (`test/scroll.html`). Headless
Chromium doesn't animate smooth scrolling — don't write tests that depend on a running glide.

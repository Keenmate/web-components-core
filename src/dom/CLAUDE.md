## Style injection (`src/dom/adopt-styles.ts`, SPEC §12.8 — implemented)

Two zero-dep free functions in the main index (core stays render-agnostic — no
shadow-DOM assumptions in `BlissElement`, so these are NOT methods).
`adoptStyles(root, ...cssStrings)` adopts static shared stylesheets (cached
`CSSStyleSheet` per string, shared across instances, `<style>` fallback,
SSR-safe, dedup per root) — the `main.css?inline` case. `createStyleSlot(root, {
position?, className? })` → `{ set, clear, destroy }` is a per-instance
replaceable `<style>` slot for the `customStylesCallback` case (consistent
position so re-set replaces; `<style>`-based so user `@import` works). Authoring
rules (`@layer` order, `?inline`) stay CSS-guideline, not code.

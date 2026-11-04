## CEM tooling (`src/cem/`, SPEC §12.6 — implemented)

`@keenmate/web-components-core/cem` is a **build-time-only** subpath (no runtime
dependency — the analyzer injects `typescript`). `blissInputsPlugin()` teaches
`@custom-elements-manifest/analyzer` to read the `static inputs` / `static
events` tables (invisible to the stock analyzer). All extraction is in the pure,
unit-tested `extractBlissClass(ts, node, sourceFile)`; the plugin is a thin
analyze-then-`moduleLinkPhase`-merge wrapper. `blissAnalyzerConfig()` is the
shared config preset (it analyzes `index.ts` — where `registerComponent()` runs; it excludes
only tests / specs / declarations). Extracted data is keyed by module path + class name. The plugin also recognizes core's `registerComponent()`
(via `parseRegisterComponentCall` / `extractRegistrations`) as a custom-element
definition — the stock analyzer only knows `customElements.define()` — so it sets
`customElement`/`tagName` and adds the `custom-element-definition` export.
`toEnum` types resolve through `as const` and shared members-consts (e.g. a
hoisted `const PLACEMENTS = […] as const`), not just inline array literals.
Core-declared inputs (not table rows) are added by the plugin via
`withCoreDeclared()` (`core-declared.ts`): `defer`/`shouldDefer`,
`theme-source`/`themeSource`, `motion`, the `ready` event on every table-driven class;
`responsive` + `responsiveCallback` only with a `static inputs` table
(`ExtractedClass.hasInputTable`), plus `BlissElement`'s own public API (`CORE_DECLARED_API`:
`release`, `destroy`, `whenReady`, …; a test fails if a name disappears from the class).
Own declarations of the same name win. Keep
`CORE_DECLARED_INPUTS` in sync when core adds a global attribute/property.
**Source-of-truth split (SPEC §8 amendment):** the table +
converter give the *structure* (attr↔prop, type, default, `shouldReflect`, enum
members); the optional `description`/`deprecated` fields on each `InputDef` /
`EventDef` row (or a leading comment) give the *prose*. Those doc fields are
ignored at runtime. Keep `static inputs`/`static events` as literals (or a
hoisted `const … as const`) — the extractor reads AST literals, not runtime
values. It also flattens `...SHARED` spreads of a same-file const array, reads a row given as a
same-file const object, `static get inputs() { return […] }` and `const X = class …`; anything
else (a spread of an import / `Base.inputs`, `.concat()`) goes into `ExtractedClass.warnings`,
which the plugin prints as `[keenmate-bliss-inputs]` build warnings (review L-07). Rich prose goes in `description` as a **template literal** (multi-line
markdown, bullet lists — preserved verbatim; the leading-comment fallback
flattens to one line, so use the field for structured text, and no `${}`
interpolation or the AST reader skips it). `InputDef.type` (a string) overrides
the converter-derived manifest type — the escape hatch for precise callback
signatures / generics that `toFunction()` (always `Function`) can't express. Note
the type is inferred from the converter *call name*, so a local wrapper (e.g.
`const cb = () => toFunction()`) defeats inference — use `type` there.

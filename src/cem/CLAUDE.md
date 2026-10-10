## CEM tooling (`src/cem/`, SPEC §12.6 — implemented)

`@keenmate/web-components-core/cem` is a **build-time-only** subpath (no runtime
dependency — the analyzer injects `typescript`). `blissInputsPlugin()` teaches
`@custom-elements-manifest/analyzer` to read the `static inputs` / `static
events` tables (invisible to the stock analyzer). All extraction is in the pure,
unit-tested `extractBlissClass(ts, node, sourceFile)`; the plugin is a thin
analyze-then-`moduleLinkPhase`-merge wrapper. `blissAnalyzerConfig()` is the
shared config preset. The plugin also recognizes core's `registerComponent()`
(via `parseRegisterComponentCall` / `extractRegistrations`) as a custom-element
definition — the stock analyzer only knows `customElements.define()` — so it sets
`customElement`/`tagName` and adds the `custom-element-definition` export.
`toEnum` types resolve through `as const` and shared members-consts (e.g. a
hoisted `const PLACEMENTS = […] as const`), not just inline array literals.
**Source-of-truth split (SPEC §8 amendment):** the table +
converter give the *structure* (attr↔prop, type, default, `reflect`, enum
members); the optional `description`/`deprecated` fields on each `InputDef` /
`EventDef` row (or a leading comment) give the *prose*. Those doc fields are
ignored at runtime. Keep `static inputs`/`static events` as literals (or a
hoisted `const … as const`) — the extractor reads AST literals, not runtime
values. Rich prose goes in `description` as a **template literal** (multi-line
markdown, bullet lists — preserved verbatim; the leading-comment fallback
flattens to one line, so use the field for structured text, and no `${}`
interpolation or the AST reader skips it). `InputDef.type` (a string) overrides
the converter-derived manifest type — the escape hatch for precise callback
signatures / generics that `toFunction()` (always `Function`) can't express. Note
the type is inferred from the converter *call name*, so a local wrapper (e.g.
`const cb = () => toFunction()`) defeats inference — use `type` there.

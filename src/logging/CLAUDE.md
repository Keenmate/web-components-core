## Logging (`src/logging/`, SPEC §12.1 — implemented)

`createLoggers(namespace, categories?)` returns categorized `NAMESPACE:CATEGORY`
loggers over a vendored `loglevel` port (`log-core.ts` — no npm dependency), each with a
color-coded `%c` prefix done in a `methodFactory` (ordering-safe:
`%c[label]` + CSS, then raw args — messages stay uncoloured). Categories default
to `INIT/DATA/UI` and can be redefined or extended. `enableLogging()` defaults to
`debug`; `disableLogging()` → silent. `createPerfLogger(namespace)` is the opt-in
timing companion. `loglevel-plugin-prefix` was **dropped** (its browser `%c`
handling is the ordering bug we avoid) — an amendment to §12.1's original text.

Levels coalesce, closest first (rc19): element (`el.enableLogging`) → type, per
category (the bundle's controls, or a persisted `km-log:*` level) → page
(`window.components.logging`) → `warn` (`DEFAULT_LOG_LEVEL`). Nothing is set by
default; `resetLogging()` clears a layer at every level. Engine mapping: the type
level is the loglevel logger's OWN level (`setLevel` / `resetLevel`), the page level
its DEFAULT level (`setDefaultLevel`, which in the vendored port never writes the own
level — never re-bind methods with `setLevel(getLevel())`, use `rebuild()`).
`global-logging.ts` is the page switch published as the non-enumerable
`window.components.logging`; its state lives on `globalThis[Symbol.for(...)]` because
each component bundles its own core copy. Every `createLoggers()` enlists there and
gets the page level via `setPageLevel`; a bundle from an older copy (no
`setPageLevel`) gets it pushed through `setLogLevel`, and older controls are taken over.
`element-logger.ts` routes core's own messages (`coreLog()`):
element's own bundle → `[NS:CAT] #id`, no bundle → `[CORE:CAT] tag#id`, no
element → `[CORE:CAT]`. Instance loggers look `console[method]` up per call (so
test spies / collectors installed later see the lines). Tests assert lines via
`console-line.test-util.ts` (`consoleLine(args)` strips the `%c` + CSS args;
excluded from the build).

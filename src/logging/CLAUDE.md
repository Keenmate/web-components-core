## Logging (`src/logging/`, SPEC §12.1 — implemented)

`createLoggers(namespace, categories?)` returns categorized `NAMESPACE:CATEGORY`
loggers over a vendored `loglevel` port (`log-core.ts` — no npm dependency), each with a
color-coded `%c` prefix done in a `methodFactory` (ordering-safe:
`%c[label]` + CSS, then raw args — messages stay uncoloured). Categories default
to `INIT/DATA/UI` and can be redefined or extended. `enableLogging()` defaults to
`debug`; `disableLogging()` → silent. `createPerfLogger(namespace)` is the opt-in
timing companion. `loglevel-plugin-prefix` was **dropped** (its browser `%c`
handling is the ordering bug we avoid) — an amendment to §12.1's original text.

Default level for every bundle is `warn` (`DEFAULT_LOG_LEVEL`, applied once per
named logger; a persisted `km-log:*` level wins). `global-logging.ts` is the
page-wide switch published as the non-enumerable `window.components.logging`;
its state lives on `globalThis[Symbol.for(...)]` because each component bundles
its own core copy. Every `createLoggers()` enlists there and adopts a global
level already set. `element-logger.ts` routes core's own messages (`coreLog()`):
element's own bundle → `[NS:CAT] #id`, no bundle → `[CORE:CAT] tag#id`, no
element → `[CORE:CAT]`. Instance loggers look `console[method]` up per call (so
test spies / collectors installed later see the lines). Tests assert lines via
`console-line.test-util.ts` (`consoleLine(args)` strips the `%c` + CSS args;
excluded from the build).

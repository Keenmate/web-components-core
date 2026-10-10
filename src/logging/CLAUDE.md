## Logging (`src/logging/`, SPEC §12.1 — implemented)

`createLoggers(namespace, categories?)` returns categorized `NAMESPACE:CATEGORY`
loggers over **`loglevel`** (core's one runtime dependency), each with a
color-coded `%c` prefix done in a `methodFactory` (ordering-safe:
`%c[label]` + CSS, then raw args — messages stay uncoloured). Categories default
to `INIT/DATA/UI` and can be redefined or extended. `enableLogging()` defaults to
`debug`; `disableLogging()` → silent. `createPerfLogger(namespace)` is the opt-in
timing companion. `loglevel-plugin-prefix` was **dropped** (its browser `%c`
handling is the ordering bug we avoid) — an amendment to §12.1's original text.

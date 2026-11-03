# 06 — logging / cem / testing + public API surface (cold review, 2026-11-03)

Scope: `src/logging/*`, `src/cem/*`, `src/testing/*`, `package.json`, every `index.ts`, `tsconfig*.json`, `README.md`, plus cross-cutting duplication and naming. Probes lived in `src/{logging,cem,testing}/__probe-api-*.test.ts`. All have been deleted. No other file was modified. The `__probe-*` files still in the tree belong to the parallel reviewers.

## Summary (sorted by severity)

| ID | Sev | Category | Where | One-liner | Status |
|---|---|---|---|---|---|
| L-01 | High | bug | `logging/global-logging.ts:59-62`, `log-core.ts:133` | An invalid level passed to the page-wide switch is stored before validation. After that, every later `createLoggers()` (any lazy-loaded component, any core copy) throws at module eval | CONFIRMED |
| L-02 | Medium | bug | `logging/log-core.ts:81-96,165-168` | `setLogPersistKeyPrefix` is a per-copy module variable, and CORE loggers read storage at import, so the prefix can never apply to CORE. Reads use the old key and writes use the new one | CONFIRMED |
| L-03 | Medium | bug | `logging/create-loggers.ts:112-118` vs `log-core.ts:113` | Instance loggers emit `debug`/`trace` via `console.debug`, which Chrome hides by default ("Verbose"). `el.enableLogging()` output is invisible, while the type logger's `debug` goes to `console.log` | by reading |
| L-04 | Medium | bug | `cem/config.ts:45` | The default `exclude` contains `**/index.ts`, which is exactly where every component calls `registerComponent()`. Tag recognition is dead under the preset. Components work around it with a duplicate `customElements.define` | CONFIRMED by reading configs |
| L-05 | Medium | bug | `cem/plugin.ts:80,97,103,113` | Extracted data and registrations are keyed by bare class name. A same-named class in another module gets the first class's attributes, core-declared inputs and `tagName` | CONFIRMED |
| L-06 | Medium | bug | `cem/extract.ts:158-227` | Converter inference gaps: `toList({itemType:'int'})` comes out as `string[]`. No default for `toBool('default-true'/'default-false')`, `toText()` (`''`) or `toEnum` (null). `shouldNullOnInvalid` enums miss `\| null`. `toFunction()` comes out as `Function` (no `\| null`) | CONFIRMED |
| L-07 | Medium | bug | `cem/extract.ts:289-333` | Spread rows (`[...SHARED_ROWS, …]`) are dropped. Class expressions and `static get inputs()` are invisible. A subclass with no own table is not a "Bliss class" | CONFIRMED |
| L-08 | Medium | docs-drift/design | `cem/core-declared.ts:219-250` | The manifest documents only five core-declared fields plus the `ready` event. All core public methods and props (`release`, `destroy`, `whenReady`, `isReady`, `whenSettled`, `flush`, `enableLogging`, `disableLogging`, `isLoggingEnabled`, `isDestroyed`, `validity`/`checkValidity`/`reportValidity`, `setAttributes`, `batch`) are missing, because BlissElement lives in node_modules, outside the analyzer globs | by reading |
| L-09 | Medium | design | `logging/element-logger.ts:29`, `global-logging.ts:23-30` | Every core copy makes its own `CORE` bundle (N copies → N `CORE:ELEMENT` loggers). `coreLogging.setCategoryLevel` reaches only the caller's copy, `getCategories()` dedupes and hides this, and the page-wide switch has no per-category control | CONFIRMED |
| L-10 | Medium | design/duplication | 7 × `state()` (logging, loader, responsive, breakpoints, motion, theme, scroll-lock) | Hand-rolled `globalThis[Symbol.for]` getters with three key styles and no shape version. The first-loaded core version (rc15 vs rc17 on one page) fixes the shape for everyone. Needs one `sharedState(key, version, init)` helper | speculative |
| L-11 | Medium | design (cross-cutting) | `global/instances.ts:14` | `REGISTRY` is a per-copy module Map. The public `getRegisteredTags()` / `getInstances()` only see elements of the importing copy, so a devtools overlay with its own core sees nothing | by reading |
| L-12 | Medium | test-gap/missing-helper | `testing/fixtures.ts:30-33,14` | `defineOnce` silently accepts a different constructor for an existing tag. `TAG_SEQ` is per copy, so two copies both issue `bliss-test-0` and a test silently runs against the other class | CONFIRMED |
| L-13 | Medium | missing-helper | `testing/*`, `logging/console-line.test-util.ts` | `/testing` has no console/log capture (`consoleLine` is excluded from the build), no reset for page-wide state (`__reset*` are unexported, and `__resetGlobalLogging` resets only `level`), and no `waitForEvent` / `spy.next()` | by reading |
| L-14 | Low | bug/design | `logging/log-core.ts:219-221`, `create-loggers.ts:22-30` | Public `Logger.setLevel(x)` persists to localStorage by default (loglevel semantics), and the `Logger` type exposes no way to clear it. The value comes back on every page load | CONFIRMED |
| L-15 | Low | bug | `global-logging.ts:378-383`, `perf-logger.ts:385-429` | Unbounded growth: the global bundle `Set` gains an entry per `createLoggers` / `createPerfLogger` call, forever. Perf `spans` are recorded even when PERF is silent. Nested `start()` calls with the same label overwrite each other | CONFIRMED |
| L-16 | Low | naming/bug | `element/bliss-element.ts:858-870` | Instance `disableLogging()` CLEARS the override (warnings still print), while bundle/global `disableLogging()` silences everything. `isLoggingEnabled` compares string literals, so it is `true` for `'SILENT'` or a bogus level | by reading |
| L-17 | Low | duplication | `log-core.ts:124`, `create-loggers.ts:106`, `bliss-element.ts:869`, `global-logging.ts:64` | Level normalization is done three ways (throws / silently → SILENT / literal compare). `'debug'` is duplicated instead of reusing `DEFAULT_ENABLED_LEVEL` | by reading |
| L-18 | Low | design | `global-logging.ts:90-100` vs `render-loader.ts:76`, `motion.ts:93`, `responsive.ts:167` | Four `window.components` publishers with different semantics. Logging is a read-only data property that refuses a pre-set value; the others are accessors that adopt one. `publishLoaderHook` is public; the other three are not | by reading |
| L-19 | Low | bug | `cem/extract.ts:113-127` | Leading-comment fallback: a multi-line `//` block keeps only its last line. JSDoc tags (`@deprecated`, `@default`) are flattened into the prose instead of being mapped | CONFIRMED |
| L-20 | Low | test-gap | `testing/fixtures.ts:75-92` | `mountBeforeUpgrade` on an already-defined tag silently skips the pre-upgrade path it exists to test | CONFIRMED |
| L-21 | Low | bug/docs | `testing/fixtures.ts:47-66` | `mount({container})` is not tracked by `cleanup()`. A detached container gives an unconnected element, despite the doc saying it "is connected" | CONFIRMED |
| L-22 | Low | packaging | `package.json`, `cem/index.ts` | `/cem` d.ts imports `typescript` but there is no optional peerDep. No `engines`, no `./package.json` export. `CemPackageDoc` (in `CemPlugin`'s signature) is not exported | by reading |
| L-23 | Low | packaging/tree-shaking | `logging/element-logger.ts:29` | A top-level `createLoggers('CORE')` mutates `globalThis` and `window.components` at import, under `"sideEffects": false` | by reading |
| L-24 | Low | docs-drift | `README.md`, `src/cem/CLAUDE.md` | About 60 runtime exports are undocumented in README (`runBeforeCallback*`, `renderLoader`, `createPerfLogger`, `setLogPersistKeyPrefix`, overlay coordination, `observeEnvironment`, …). The cem CLAUDE.md core-declared list omits `motion` | by reading |
| L-25 | Nit | naming | `dom/render-loader.ts:7-8,50`, `positioning/types.ts:135,137,149`, `menu/types.ts:50`, `actions/resolve.ts` | `renderLoadingCallback` vs `renderLoaderCallback` vs `RenderLoaderCallback`. Notification-only hooks carry the `*Callback` suffix (`placedCallback`, `computedCallback`, `closeCallback`, `driftCallback`). `menuDivider()` is a factory with no verb | by reading |

---

## Findings

### L-01 — High — bug — invalid global level poisons the page
`src/logging/global-logging.ts:59-62` (`applyAll`) and `src/logging/log-core.ts:133` (`normalizeLevel` throws).

- **What goes wrong:**
  - `applyAll` sets `created.level = level` before any bundle validates the level.
  - `setLogLevel('verbose')` (a devtools typo) throws partway through the bundle loop, so earlier bundles are changed and later ones are not.
  - `state().level` is left as `'verbose'`. `registerGlobalLoggingTarget` then calls `bundle.setLogLevel('verbose')` for every bundle created afterwards, so `createLoggers()` throws.
  - The state is shared across copies on `globalThis`. Any component loaded afterwards (lazy route, second bundle) fails at module evaluation.
- **Probe:** `setLogLevel('verbose')` threw a TypeError, and the next `createLoggers('PB')` also threw `TypeError: setLevel() called with an invalid level: verbose`.
- **Fix:**
  - Validate in `applyAll` first (export a non-throwing `isLogLevel` / `toLevelNumber` from log-core).
  - Warn and ignore an invalid level; never store it.
  - In `registerGlobalLoggingTarget`, wrap `setLogLevel` in try/catch.
  - Also guard the copy of `applyAll` inside a bundle: a throw there should not abort the loop.

### L-02 — Medium — bug — persist key prefix is per-copy and can't reach CORE
`src/logging/log-core.ts:81` (module `let persistKeyPrefix`) and `:165-168` (persisted level read in the constructor).

- **What goes wrong:**
  - `coreLogging = createLoggers('CORE', …)` runs when the main index is imported, so CORE's persisted levels are always read under `km-log:`.
  - Calling `setLogPersistKeyPrefix('app')` afterwards (the only possible order) changes later writes only. `storageKey()` is computed per call, so CORE reads `km-log:CORE:*` and writes `app:CORE:*`.
  - The prefix is also per copy: copy A's setting is invisible to copies B…N, so every other component keeps using `km-log`. The README promise ("call at app startup") cannot be met.
- **Probe:**
  - With `app:CORE:ELEMENT=DEBUG` in storage, after `setLogPersistKeyPrefix('app')`, CORE ELEMENT stayed at 3 (warn) while a new bundle read 1 (debug).
  - `setLevel('error')` then wrote `app:CORE:ELEMENT`.
  - A `vi.resetModules()` second copy still reported `km-log`.
- **Fix:**
  - Move the prefix into the shared `globalThis` logging state.
  - On prefix change, re-read persisted levels for all known loggers (all copies, via the shared bundles set).
  - Or drop the API: it is unused.

### L-03 — Medium — bug — per-instance debug output hidden in Chrome by default
`src/logging/create-loggers.ts:112-118` maps `trace`/`debug` → `console.debug`. `log-core.ts:113` maps the type logger's `debug` → `console.log`.

- **What goes wrong:** Chrome DevTools puts `console.debug` under the "Verbose" level, which is off by default.
- **Scenario:** the devtools overlay calls `el.enableLogging()` (default `'debug'`). Every `this.log.X.debug(...)` line is emitted but hidden, and the user concludes it doesn't work. `loggers.X.debug` on the type logger is visible.
- **Fix:** use the same console mapping as log-core: `debug` → `log`, and `trace` → `log` (or `trace`).
- **Side note:** instance loggers are wrappers, so devtools shows `create-loggers.ts` as the call site (the line-number trick from log-core is lost). Document this, or return bound functions recomputed on level change.

### L-04 — Medium — bug — preset excludes the file where registration happens
`src/cem/config.ts:45`: `exclude: ['**/*.test.ts', '**/*.d.ts', '**/index.ts']`.

- **What goes wrong:**
  - Every component calls `registerComponent()` in `src/index.ts`: web-multiselect:149, web-treeview:155, web-daterangepicker:100, web-editor:198, web-commandpalette:63.
  - With the preset's exclude, `parseRegisterComponentCall` never sees those calls, so the feature advertised in `plugin.ts:110-128` / `cem/CLAUDE.md` never fires.
  - Every component config also hard-codes `'src/index.ts'` in its exclude.
  - web-multiselect only gets `tagName` because `src/web-component.ts:1106-1108` repeats `customElements.define(...)`. That is a silent workaround for exactly this gap.
- **Fix:**
  - Drop `**/index.ts` from the default exclude.
  - Or keep it excluded from class analysis but have the plugin pre-scan registration files: an option `registrationFiles` that reads them with `ts.createSourceFile`.
  - Then remove the duplicate defines in the components.

### L-05 — Medium — bug — plugin merges by bare class name across modules
`src/cem/plugin.ts:80` and `:83` (Maps keyed by `className`), `:103`, `:113`.

- **What goes wrong:** in `moduleLinkPhase`, every declaration named `Item` / `Row` / `Demo` in any module receives the extracted attributes, the core-declared `defer` / `theme-source` / `motion` / `responsive`, and `tagName` / `customElement: true` with a `custom-element-definition` export.
- **Probe:** an unrelated `Item` declaration in `b.ts` got `["a","defer","theme-source","motion","responsive"]`.
- **Realistic failure:** monorepos (web-dropzone), example/demo classes, two components sharing a helper class name.
- **Fix:** key by `${sourceFile.fileName}#${className}` and match `moduleDoc.path`. For registrations, resolve the class identifier through imports (or at least prefer the same module, and warn on ambiguity).

### L-06 — Medium — bug — converter type/default inference gaps
`src/cem/extract.ts:158-227`.

- **Probe results:**
  - `toList({ itemType: 'int' })` → `string[]`; the runtime value is `number[]`.
  - `toBool('default-true')` with no row default → manifest has no default; the runtime default is `true`. Editors imply false.
  - `toText()` → no default; the runtime gives `''`.
  - `toEnum([...], { shouldNullOnInvalid: true })` → `'a' | 'b'`; the runtime allows `null`. The same applies to `toEnum` with no `default` (fallback is null).
  - `toFunction()` → `Function`; the runtime type is `F | null`.
  - `toInt` / `toFloat` / `toBytes` without a default are `undefined` at runtime, but typed `number`.
- **Fix:**
  - Derive the default from the `toBool` mode (`default-true` → `true`, `default-false` / `presence` → `false`, `tristate` → `null`).
  - `toText` default: `''`, or `null` when `isNullable`.
  - Read `itemType`.
  - Add `| null` for `shouldNullOnInvalid` / no-default enums and for `toFunction`.
  - Add `| undefined` for numeric converters with no default.

### L-07 — Medium — bug — rows/classes the extractor silently skips
`src/cem/extract.ts:289-333`.

- **What gets dropped:**
  - Spread rows: `static inputs = [...SHARED_ROWS, {...}]`. `unwrap(el)` returns a `SpreadElement`, which is not an object literal, so it is skipped. The probe kept only `['b']`.
  - `export const X = class extends BlissElement {...}`, because only `ClassDeclaration` is visited.
  - `static get inputs() {…}`, because only `PropertyDeclaration` is checked.
  - `static inputs = Base.inputs.concat([...])`.
  - A subclass with no own table returns `undefined`, so it gets no core-declared entries either.
- **Mitigation:** when the spread comes from the parent (`...Base.inputs` with `extends Base`), the analyzer's own inheritance step may restore the parent's rows (speculative). A shared const array of rows, a common DRY pattern, is lost with no warning.
- **Fix:**
  - Resolve `SpreadElement` identifiers through `resolveArrayLiteral` (same file) and recurse.
  - Visit `ClassExpression` bound to a variable.
  - Accept `GetAccessor` returning an array literal.
  - Emit a `console.warn` from the plugin when `static inputs` exists but cannot be resolved to a literal.

### L-08 — Medium — docs-drift/design — the manifest lacks core's public API
`src/cem/core-declared.ts:219-250`.

- **What goes wrong:**
  - Only `shouldDefer`, `themeSource`, `motion`, `responsive`, `responsiveCallback` and the `ready` event are injected.
  - `BlissElement` is in `node_modules`, outside `globs: ['src/**/*.ts']`, so analyzer inheritance cannot supply it.
  - As a result, no component manifest documents `release()`, `destroy()`, `whenReady()`, `whenSettled()`, `flush()`, `setAttributes()`, `batch()`, `enableLogging()` / `disableLogging()`, `isReady`, `isDestroyed`, `isLoggingEnabled`, `isEffectivelyDisabled`, `validity`, `checkValidity()` / `reportValidity()`, or the `onReady` twin.
- **Fix:** add `CORE_DECLARED_METHODS` / extra fields (kind `'method'` members) to `withCoreDeclared`, and keep them in sync via a unit test that compares against `Object.getOwnPropertyNames(BlissElement.prototype)`.

### L-09 — Medium — design — one CORE bundle per core copy
`src/logging/element-logger.ts:29`, `global-logging.ts:23-30,63-71`.

- **What goes wrong:**
  - Each copy evaluates `createLoggers('CORE', …)`, which creates its own `CORE:*` loggers (`byName` is per copy, `log-core.ts:140`).
  - The page switch reaches all of them, but there is no page-wide per-category control: `GlobalLoggingControls` has no `setCategoryLevel`.
  - The exported `coreLogging` controls only the importing copy.
  - `getCategories()` dedupes labels, which hides that there are N loggers behind `CORE:ELEMENT`.
- **Probe:** with two copies, copy A's `setCategoryLevel('ELEMENT','debug')` gave level 1 in A and 3 in B.
- **Fix:**
  - Add `setCategoryLevel(label, level)` to the global controls; it iterates the shared bundles and matches `namespace:category`.
  - Document `coreLogging` as per-copy, or stop exporting it in favour of the global control.

### L-10 — Medium — design/duplication — shared-state pattern copy-pasted seven times, unversioned
Hand-rolled getters (`globalThis as unknown as Record<symbol, …>`):

- `logging/global-logging.ts:49-78`
- `dom/render-loader.ts:62-66`
- `element/responsive.ts:89-94`
- `environment/environment.ts:142-145`
- `environment/motion.ts:71-75`
- `environment/theme.ts:111-114`
- `overlay/scroll-lock.ts:41-44`

- **Inconsistent keys:** `'@keenmate/web-components-core:logging'`, `'@keenmate/web-components-core/theme@1'`, `'km-scroll-lock'`, `'km-overlay-all-groups'`.
- **No shape check:** the first core version to load creates the object. Components are pinned to different rcs (rc15 / rc17 per the memory index), so a field added in a newer core is `undefined` when an older copy won the race. Only theme has a version tag.
- **Fix:** one internal helper, e.g. `sharedState<T>(name, version, init, upgrade?)`, keyed `Symbol.for('@keenmate/web-components-core:<name>@<v>')`. It should fill missing fields on an existing object, and every module should use it. The same helper would host L-02 (prefix) and L-11 (instances).

### L-11 — Medium — design (cross-cutting, `global/`) — instance registry is per-copy
`src/global/instances.ts:14`.

- **What goes wrong:**
  - `getRegisteredTags()` / `getInstances()` are public main-index exports documented as "every tag on the page".
  - A devtools overlay or app code that bundles its own core gets `[]`.
  - `window.components[tag].getInstances()` works, because it closes over the copy that registered the tag.
- **Fix:** either move `REGISTRY` into shared state (`Map<tag, Set>`, which is safe because a tag belongs to one copy), or document the exports as copy-local and point to `window.components`.
- `logger-registry.ts:10` (`BY_TAG`) is also per copy, but that is benign (tag → its own copy).

### L-12 — Medium — test-gap — `defineOnce` / `uniqueTag` can run a test against the wrong class
`src/testing/fixtures.ts:30-33`, `:14`.

- **What goes wrong:**
  - `defineOnce(tag, B)` returns `tag` silently when `tag` is already defined with `A` (probe confirmed).
  - `TAG_SEQ` is per module copy. A component's test that pulls `/testing` and a helper package with its own copy of `/testing`, sharing a browser realm (Playwright component tests, Storybook), both hand out `bliss-test-0`.
  - The second test then mounts the first test's class, and its assertions pass or fail for the wrong reason.
- **Fix:**
  - `defineOnce` should throw (or warn) when `customElements.get(tag) !== ctor`.
  - `uniqueTag` should skip tags already in `customElements` (`while (customElements.get(t)) …`) and/or keep the counter in shared state.

### L-13 — Medium — missing-helper — `/testing` lacks the helpers components keep re-implementing
- **Console capture:** core routes every message through `coreLog` with `%c` + CSS args. Asserting "warned about X" needs `consoleLine()`, which is `src/logging/console-line.test-util.ts` and excluded from the build (`tsconfig.build.json`). Every component re-implements it. Add `captureConsole()` → `{ lines: string[], restore() }` to `/testing`.
- **Global reset:** page-wide state (logging level and bundles, responsive page rules, motion, breakpoints, theme mode, scroll lock, overlays) lives on `globalThis`. Its `__reset*` hooks are not exported from any public entry point. Add `resetCoreGlobals()` to `/testing`.
- **`__resetGlobalLogging`** (`global-logging.ts:115`) resets only `level`, so `bundles` keeps growing across tests (see L-15).
- **No async event helper:** add `waitForEvent(target, type, { timeoutMs })` or `spy.next(): Promise<E>`. Also `spy.details: D[]`.

### L-14 — Low — bug/design — `Logger.setLevel` persists by default, and there is no public clear
`src/logging/log-core.ts:219-221`, `create-loggers.ts:22-30`.

- **What goes wrong:**
  - The public `Logger.setLevel(level, persist?)` keeps loglevel's "persist unless false" behaviour. A component author's one-off `loggers.DATA.setLevel('debug')` writes `km-log:NS:DATA=DEBUG` into the user's localStorage (probe confirmed).
  - That level then overrides `DEFAULT_LOG_LEVEL` on every future visit.
  - Bundle and global `setLogLevel` use `persist:false`, so they never clear it (probe: still `DEBUG` after `setLogLevel('warn')`).
  - `resetLevel()` exists on the implementation but not on the `Logger` type.
- **Fix:** flip the default to non-persisting (`persist === true` to write), and add `resetLevel()` to `Logger` plus `clearPersistedLevels()` to the bundle and global controls.

### L-15 — Low — bug — unbounded growth in the logging registries and the perf logger
`global-logging.ts:378-383`; `perf-logger.ts:386-429`.

- **Bundles:** every `createLoggers` / `createPerfLogger` call adds a new bundle object to the shared `Set`, and nothing ever removes it. 100 `createPerfLogger('TREE')` calls gave +100 entries (probe).
- **Perf logger:**
  - Pushes to `spans` and computes timings even when `NS:PERF` is silent (no level gate), so production pages accumulate spans for as long as the page lives.
  - `marks` keeps any `start()` that is never ended.
  - A nested `start('a')`/`start('a')` overwrites the first mark: the second `end('a')` warns and returns 0 (probe).
  - `measure()` records nothing when `fn` throws (no `finally`).
- **Fix:**
  - Dedupe bundles by namespace plus category list (return the existing bundle), or keep a `WeakRef`.
  - In the perf logger: early-out when `logger.getLevel() > DEBUG`, cap `spans`, and record in `finally`.

### L-16 — Low — naming/bug — `disableLogging()` means two different things
`src/element/bliss-element.ts:858-870`.

- **What goes wrong:**
  - `el.disableLogging()` clears the instance override, so type-level warnings still print.
  - `bundle.disableLogging()` and `window.components.logging.disableLogging()` silence everything.
  - Same name, opposite user expectation (README shows them side by side).
  - `isLoggingEnabled` checks `!== 'silent' && !== 5`, so `enableLogging('SILENT')` or `enableLogging('bogus')` (which `toLevelNum` maps to SILENT) reports `true`.
- **Fix:**
  - Rename the instance method `resetLogging()` / `clearLogLevel()`, or make it set `'silent'` and add a separate reset.
  - Compute `isLoggingEnabled` through the shared numeric normalizer.

### L-17 — Low — duplication — three level normalizers
`log-core.ts:124` (`normalizeLevel`, throws), `create-loggers.ts:106` (`toLevelNum`, silently → SILENT, accepts out-of-range numbers), `bliss-element.ts:869` (string literal compare). `global-logging.ts:64` hard-codes `'debug'` instead of `DEFAULT_ENABLED_LEVEL`.

- **Fix:** export one `toLogLevelNumber(desc): number | undefined` and one `isLogLevel` from log-core, and use them everywhere (this also fixes L-01 and L-16).

### L-18 — Low — design — four `window.components` publishers, four behaviours
`global-logging.ts:90-100` defines a value with `writable:false`, and its `hasOwnProperty` guard keeps any pre-set `logging` (so core's controls become unreachable). `render-loader.ts:76-91` and `motion.ts:93-105` define accessors and adopt a pre-set value. `responsive.ts:167-185` defines a pair of accessors.

- **Exports are inconsistent too:** `publishLoaderHook` is in the public main index; `publishGlobalLogging`, `publishMotionHook` and `publishResponsiveHooks` are not.
- **Fix:** one internal `publishComponentsHook(key, { get, set?, adopt? })`. Make `publishLoaderHook` internal; it is called by `registerComponent` anyway.

### L-19 — Low — bug — leading-comment fallback loses prose and tags
`src/cem/extract.ts:113-127`.

- **What goes wrong:**
  - Only the last comment range is used. With `// First line.` followed by `// Second line.`, the description is `"Second line."` (probe).
  - JSDoc tags are flattened into the prose (`"Shows x. @deprecated use y @default 'q'"`) and `deprecated` stays undefined.
  - This conflicts with the root CLAUDE.md, which says docs come from JSDoc (C-CEM-13).
- **Fix:**
  - Join consecutive `//` ranges.
  - For `/** */`, use `ts.getJSDocCommentsAndTags` / `ts.getJSDocTags`: map `@deprecated` → `deprecated` and `@default` → `default` (when the row has none), and strip other tags from the prose.

### L-20 — Low — test-gap — `mountBeforeUpgrade` can silently not test what it says
`src/testing/fixtures.ts:75-92`. If `tag` is already defined, `document.createElement(tag)` upgrades immediately and `configure()` runs on the upgraded instance (probe: `instanceof C` was true inside `configure`). The test passes without exercising pre-upgrade capture.

- **Fix:** throw when `customElements.get(tag)` is already set before `createElement`.

### L-21 — Low — bug/docs — `mount({ container })` ownership
`src/testing/fixtures.ts:47-66`.

- **What goes wrong:**
  - With a `container`, nothing is added to `MOUNTED`, so `cleanup()` leaves the element in the DOM (probe: still `isConnected` after cleanup).
  - A detached container gives an unconnected element (probe), contradicting "The element is connected, so a BlissElement runs its first reinit()".
- **Fix:** track mounted elements themselves (not only hosts), or document both behaviours. Optionally accept a `ShadowRoot` container.

### L-22 — Low — packaging
`package.json`; `cem/index.ts`.

- `dist/cem/extract.d.ts` contains `import type * as TsNamespace from 'typescript'`, but `typescript` is only a devDependency. A consumer importing `/cem` with `skipLibCheck: false` and no TS of their own (or a mismatched TS) gets errors. Add `peerDependencies: { typescript: '>=5' }` with `peerDependenciesMeta.typescript.optional = true` (and optionally `@custom-elements-manifest/analyzer`).
- There is no `engines` field.
- There is no `"./package.json"` export (some tooling reads it).
- `CemPackageDoc` is used in the exported `CemPlugin.packageLinkPhase` signature but is not re-exported from `/cem`.
- The `__reset*` hooks ship in `dist/**` d.ts files. They are unreachable through the exports map, which is fine.

### L-23 — Low — tree-shaking — import-time side effect under `sideEffects: false`
`src/logging/element-logger.ts:29`.

- **What goes wrong:**
  - `export const coreLogging = createLoggers('CORE', …)` registers on `globalThis` and defines `window.components.logging` when the module is evaluated.
  - With `"sideEffects": false`, a bundler may drop the module when only types or other names are imported. So `window.components.logging` may not exist until some component's `createLoggers` runs.
  - It works today only because `bliss-element.ts` imports `coreLog`.
  - Everything else top-level is pure (`Symbol.for`, `Object.freeze`, `createThrottle` closures).
- **Fix:** create the CORE bundle lazily inside `coreLog()` / `getElementLoggers()` (a `getCoreLogging()` accessor). Or add the file to a `sideEffects` array.

### L-24 — Low — docs-drift
- `README.md` never mentions about 60 value exports, including:
  - `runBeforeCallback`, `runBeforeCallbackEager`, `runBeforeCallbackSync`
  - `renderLoader`, `publishLoaderHook`
  - `createPerfLogger`, `setLogPersistKeyPrefix`, `getLogPersistKeyPrefix`, `LOG_LEVELS`, `coreLogging`
  - `registerOverlay`, `notifyOverlayActivated`, `dismissAllOverlays`, `onOverlayActivated`
  - `observeEnvironment`, `observeElementSize`, `observeThemeContext`
  - `collectEngineConfig`, `deriveClearableKeys`, `resolveFromAttribute`, `resolveFromProperty`
  - `lintCssVars`
  - all of `/actions` and most of `/search`
  - all `/cem` exports except `blissAnalyzerConfig`
- Fine if SPEC.md is the reference, but README should at least link SPEC sections per subpath.
- `src/cem/CLAUDE.md`'s core-declared list ("defer, theme-source, the ready event") omits `motion`, which `core-declared.ts:229` adds.

### L-25 — Nit — naming
- **Loader hook names:** `renderLoadingCallback` (instance) vs `renderLoaderCallback` (page) vs the `RenderLoaderCallback` type (`dom/render-loader.ts:7-8,50`). Pick one noun.
- **Notification hooks with the `*Callback` suffix** (house rule: the suffix means state-affecting): `placedCallback` / `computedCallback` / `driftCallback` (`positioning/types.ts:135,137,149`) and `closeCallback` (`menu/types.ts:50`). Either broaden the rule to "option hooks" or rename them (`onPlaced`, …); `before*Callback` / `get*Callback` fit the rule.
- **Factory with no verb:** `menuDivider()` (vs `createRegexCompiler`, `createPopover`). Suggest `createMenuDivider()`.
- **Same-name helpers:** `hasDom()` (`theme.ts:126`) and `hasDocument()` (`active-overlay.ts:81`), plus about 25 inline `typeof window/document` checks. A single internal `dom/env.ts` `hasDom()` would do. JSON parse-with-warn is also duplicated (`converters.ts:34` `parseJson` vs `bliss-element.ts:1719`, the responsive attribute); the responsive attribute could use `toObject({ validate: isResponsiveMap })`.

---

## Test coverage map

There is no coverage provider installed (`@vitest/coverage-*` is absent; per instructions none was installed). The map below is reasoned from imports. "unit" = a `*.test.ts` exercising the module (direct or through an importing module under test). "e2e" = a spec/fixture page that drives it.

| Module | Unit | e2e | Notes / missing scenarios |
|---|---|---|---|
| logging/log-core.ts | via create-loggers, core-routing | page.spec (levels) | **No test** for `setLogPersistKeyPrefix`, invalid levels, `resetLevel`, the persist-by-default write (L-14), or the two-copy case (`vi.resetModules`) |
| logging/create-loggers.ts | create-loggers.test (9) | page.spec | Missing: same namespace with different category lists, `setCategoryLevel` on a foreign namespace, instance debug→console method (L-03) |
| logging/global-logging.ts | core-routing.test (5 cases) | page.spec | Missing: invalid level (L-01), a pre-set `window.components.logging`, a replaced `window.components`, cross-copy bundles |
| logging/element-logger.ts | core-routing.test | page.spec | Covered well. Missing: SEQ numbering across copies (cosmetic) |
| logging/logger-registry.ts | indirect (register-component) | page.spec | Tag case-insensitivity untested |
| logging/perf-logger.ts | perf-logger.test (4) | — | `summary()` output not asserted. Missing: nested labels, `measure` throwing, silent-level gating, growth |
| cem/extract.ts | extract.test (11) | — | Missing: spread rows, class expressions, getters, `toList` itemType, `toBool` defaults, `//` multi-line, JSDoc tags |
| cem/plugin.ts | core-declared.test | — | Missing: same class name in two modules (L-05), registration in another module |
| cem/core-declared.ts | core-declared.test (5) | — | No sync test against `BlissElement` (L-08) |
| cem/css-variables.ts | css-variables.test (4) | — | Missing: a missing manifest file (throws in `packageLinkPhase`, crashing the analyze with a raw ENOENT) |
| cem/config.ts | **none** | — | Trivial, but L-04 would have been caught by an "index.ts registration" test |
| testing/fixtures.ts | testing.test | used by unit suites | Missing: `defineOnce` with a different ctor, `mountBeforeUpgrade` on a defined tag, container cleanup |
| testing/event-spy.ts | testing.test (via index) | — | `stop()` / options not asserted |
| global/instances.ts | register-component.test | page.spec | Cross-copy (L-11) untested |
| global/register-component.ts | register-component.test, responsive.test | page.spec | — |
| inputs/apply.ts | only indirect (via element) | inputs.spec | `resolveFromAttribute` / `resolveFromProperty` are public exports with no direct unit test |
| element/context.ts | indirect (`emit` in bliss-element / events tests) | events.spec | `withComponentContext` / `COMPONENT_CONTEXT_KEYS` (public) not unit-tested directly |
| dom/composed-tree.ts | **none** | indirect | No direct test (others' slice) |
| positioning/tooltip.ts, popover.ts | via positioning.test (index) | tooltip.spec, popover.spec | popover is exact-match only (COVERAGE.md △) |
| search/* | via index tests | search.spec | — |
| everything else (actions, menu, overlay, environment, dom/*) | dedicated tests exist | specs exist | see reviewers 03–05 |

**Weakest covered (in this slice):**
- `cem/config.ts`: no test.
- `logging/log-core.ts`: no direct test of persistence or prefix.
- `logging/global-logging.ts`: no negative paths.
- `logging/perf-logger.ts`: no output assertions.
- `cem/plugin.ts`: no cross-module test.
- `testing/fixtures.ts`: misuse paths untested.

**Public-surface gaps:** `resolveFromAttribute` / `resolveFromProperty` and `withComponentContext` are exported with no direct unit test.

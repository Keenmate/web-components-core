# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status: core v1 implemented

The `@keenmate/web-components-core` package (inputs model + `BlissElement`) is
built under `src/` with full unit tests. **`docs/SPEC.md` remains the source of
truth** for design intent — read the relevant section before changing behavior,
and keep it in sync. §11 open questions resolved so far: config key field is
`configKey` (§11.2); the string converter is `toText` (§11.1); `applyConfig`
is split into `reinit()` + `update(partial)` hooks (§11.3, see below). §11.4
(store/satellite) stays dropzone-local for now.

Note: `esbuild`'s postinstall may be blocked by the sandbox on `npm install`;
if vitest can't start, run `npm approve-scripts esbuild` (or reinstall
unsandboxed). Tests run in jsdom (`vitest.config.ts`); `*.test.ts` files live
next to the code they cover. Source uses explicit `.js` extensions on relative
imports (moduleResolution `Bundler`) and `verbatimModuleSyntax` (type-only
imports must use `import type`).

One runtime dependency: **`@floating-ui/dom`** (the `/positioning` module,
§12.2), imported only under `src/positioning/`, so it stays out of the base
import graph. The logging engine is a vendored port of `loglevel`
(`src/logging/log-core.ts`) — no `loglevel` package dependency.

## Why this package exists

Five shipping KeenMate web components (`web-multiselect`,
`web-daterangepicker`, `web-treeview`, `web-dropzone`, `web-grid`) each
re-implement the same custom-element plumbing and have drifted into four
different "attribute table" dialects plus private copies of the base wiring.
Core consolidates that into one reactive input model and one base class. See
§1 and §7 of the spec for the per-component divergence and fit check.

## Core architecture (v1)

Two load-bearing concepts. Understanding both requires reading §4–§6 of the spec.

1. **One reactive input table.** Every public input — attribute, complex
   property, or callback — is a single `InputDef` row (`configKey`, optional
   kebab `attribute`, `converter`, `default`, `on` reactivity, `shouldReflect`).
   There is **no central switch statement**: dispatch is
   `def.converter.fromAttribute(raw)`. A new input type is a new converter
   created anywhere (core or a component) — never a core edit or a closed union.

2. **The `Converter<V>` owns both parsing and validation.** One converter per
   input handles the attribute path (`fromAttribute`: raw string → validated
   `V`) *and* the property path (`validate`: is this JS-assigned value
   acceptable?), plus optional reflection (`toAttribute`). Correctness lives in
   one place so it can't drift across the three spots it used to. The `to*`
   factory library (`toEnum`, `toInt`, `toFloat`, `toText`, `toBool`,
   `toBytes`, `toList`, `toCustom`, `toFunction`) sets both paths from the same
   inputs. Note: `toText` (not `toString` — avoids the `Object.prototype`
   collision).

3. **`BlissElement` base class** wires both entry points through the *same*
   pipeline (parse/validate → stage → dispatch per `on`), so everything is
   reactive by construction. It is SSR-safe via the
   `typeof HTMLElement !== 'undefined'` stub, computes `observedAttributes`
   from the input table, coalesces bursts (`setAttributes()` / `batch()` /
   microtask), and provides typed events via `this.emit()` (the free
   `dispatch()` function underneath; bubbles, **not composed**). `emit()` attaches
   the component context (`controller` from `createController()`, `element`,
   both non-enumerable, + `eventContext()` extras), calls the `on<Name>` twin
   **with the detail**, then dispatches the same object (SPEC §12.5). The input table is
   **opt-in**: `web-grid` extends `BlissElement` for the SSR base + `emit`
   only and keeps its config-object API.

   A coalesced batch drives one of two subclass hooks (both no-op by default):
   - **`reinit()`** — full rebuild; called on first connect and whenever the
     batch changes any `on: 'reinit'` input. Reads `this.config` (already
     merged); given no partial, because a rebuild absorbs any `update` keys
     that changed in the same batch.
   - **`update(partial)`** — in-place patch with just the changed `on: 'update'`
     keys; called only when the batch has NO reinit-level change.

   This resolves SPEC §11.3: reinit dominates update in a mixed batch, so the
   update partial is suppressed when a rebuild will happen anyway.

   **Lifecycle (build-once + activate/deactivate, Lit's model).** Two more
   opt-in hooks manage *live* resources separately from structure:
   - **`connect()`** — every connect, after any `reinit()`/`update()`. Start
     listeners, observers, floating-ui `autoUpdate`, timers.
   - **`disconnect()`** — every disconnect. Stop what `connect()` started.

   A DOM move (reorder/re-parent) fires `disconnect()`→`connect()` and
   **re-activates without rebuilding** (`reinit()` runs only on first connect or
   an `on:'reinit'` change) — so transient UI state survives. `connect()`/
   `disconnect()` can run many times; keep them balanced. Config changed while
   detached is held and applied on reconnect, before `connect()`.

   A hook that throws is rethrown to whoever flushed, but never wedges the
   element: `whenSettled()` waiters still resolve, a failed `reinit()` is
   retried on the next flush (or reconnect), and `connect()` runs only once a
   build has succeeded — `disconnect()` only if `connect()` ran.

## Key invariants (enforce these in review and when migrating components)

- Web components build **on** core — do not re-implement observed-attribute,
  parse, or dispatch plumbing in a component.
- Reactivity is declared per input (`on: 'update' | 'reinit' | 'none'`) and
  enforced centrally. No input can be added that forgets to parse, validate, or
  react.
- The `static inputs` table is sanity-checked once per class at construction
  (`console.warn`, never throws): duplicate `configKey`/`attribute`, or
  `shouldReflect: true` without an `attribute` / without `converter.toAttribute`. Watch
  the console when authoring a table.
- Removing an attribute is reactive: it resets that input to its `default`
  (absent == default), consistent with construction.
- Invalid values follow one rule on both paths: warn and keep the previous value
  (the default before any valid one). Converters flag a bad attribute string via
  `fromAttribute`'s `reportInvalid` argument; a reflected input then writes its
  current value back (SPEC §6).
- Docs/IntelliSense are **secondary** and fed from JSDoc comments (BlissFramework
  C-CEM-13 format), *not* from the parser structure. Converter introspection
  (e.g. `toEnum(...).values`) is optional and nothing depends on it.
- Migration is one PR per component, behind that component's existing tests,
  with **no consumer-facing attribute/event changes**. Order: build core →
  treeview → multiselect + dropzone → daterangepicker → web-grid (§9).

## Module notes (lazy-loaded)

Clickable items (buttons / toolbars / menus) and the `action` event live in
`src/actions/` (subpath `/actions`, SPEC §12.12); `before*Callback`s go through
`runBeforeCallback` (`false` cancels, value replaces; `runBeforeCallbackEager`
keeps a sync hook's flow synchronous). `runAction` order: `beforeActionCallback` →
item `onClick` → built-in → `action` event (a notification after the fact; a throwing
built-in is logged and the event still fires). The cross-component
migration is tracked in `docs/interaction-model-plan.md`.

The shared context / dropdown menu lives in `src/menu/` (subpath `/menu`, SPEC
§12.13): `openMenu(entries, ctx, opts)` over `/actions` + `/positioning`.

Per-module design notes live next to the code and load when working there:
`src/logging/`, `src/cem/`, `src/testing/`, `src/positioning/`, `src/dom/`,
`src/search/`, `src/menu/` (each has a `CLAUDE.md`).

**No direct `console.*` in core** (SPEC §12.1). Core messages with an element
behind them (input validation → `INIT`, actions / menus / twins / before-callbacks
→ `UI`) go through that element's instance logger via `coreLog(source, category,
coreCategory)` (`src/logging/element-logger.ts`); no element, or a tag with no
logging bundle → core's `CORE` bundle (`ELEMENT/ACTIONS/MENU/THEME`). Every
bundle defaults to `warn`; `window.components.logging` (non-enumerable) is the
page-wide switch. The old "input-validation warnings bypass the loggers"
exception is revoked — they're silenced by `disableLogging()` like everything else.

## `whenSettled()` / `flush()` (SPEC §12.7)

`BlissElement.whenSettled(): Promise<void>` (in **core**, not just tests)
resolves after the pending flush's `reinit()`/`update()` runs — immediately when
nothing is pending, after the microtask for loose assignments, already-settled
after `setAttributes()`/`batch()`, on next connect for detached changes. It's the
deterministic read-after-write signal. Its synchronous sibling is `flush()` —
applies pending writes *now* (runs `reinit()`/`update()` before returning), the
escape hatch for **imperative methods**: call `this.flush()` at the top of a
method that reads/mutates live state so `el.prop = x; el.method()` keeps working
when `prop` coalesced on a microtask (no `await` in between).

## Beyond v1

§12 is fully built out. Decisions are recorded in §11 (resolved), §12.1 (logger),
§12.2 (positioning), §12.3 (global registration), §12.5 (events), §12.6 (CEM),
§12.7 (testing), §12.8 (style injection). No §12 candidates remain unbuilt; the
theming work reduced to the two §12.8 runtime helpers plus pure CSS-guideline
authoring rules. Don't add further shared modules without confirming the shape.

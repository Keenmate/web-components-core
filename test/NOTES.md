# Test infrastructure notes

Running notes from building the e2e fixtures + specs. Each entry is something noticed while writing
tests that looks like a bug, a friction point, or a design decision worth revisiting in core itself —
not a problem with the tests. Fixed entries stay (struck through) so the history is visible.

---

## 1. ~~`el.form` throws on an element that isn't form-associated~~ — FIXED in 1.0.0-rc15

**Where:** `src/element/bliss-element.ts` `get form()` read `this.internals?.form` unguarded.

**Symptom:** in a real browser, reading `el.form` on a `BlissElement` without
`static formAssociated = true` threw "Failed to read the 'form' property from 'ElementInternals': The
target element is not a form-associated custom element" — and attached internals as a side effect.
jsdom doesn't throw, so the unit tests never saw it.

**Fix:** `return this.#formInternals?.form ?? null;` (like the validity members).
**Test:** `e2e/core-regressions.spec.ts` + `e2e/forms.spec.ts` (`el.form === null` inside a `<form>`).

---

## 2. ~~One throwing environment / theme listener stopped the rest~~ — FIXED in 1.0.0-rc15

**Where:** `src/environment/environment.ts` `recompute()` / `fireViewport()` and
`src/environment/theme.ts` `deliver()` called listeners without a try/catch.

**Symptom:** one listener that throws (an app callback, a component's `environmentChanged`) kept every
later listener from hearing the change — other components' responsive rules / theme froze.

**Fix:** each listener is called in its own try/catch; the error is logged (`CORE:ELEMENT` /
`CORE:THEME`). **Test:** `e2e/core-regressions.spec.ts` (+ unit tests).

---

## 3. `whenSettled()` doesn't resolve while an element is deferred — DECIDED: intended, documented

**Where:** the defer gate (SPEC §6.3) + `whenSettled()` (§12.7).

`el.shouldDefer = true; append; el.label = 'x'; await el.whenSettled()` waits until `release()` /
removing `defer` — the held flush counts as pending (verified: unresolved after 100 ms, resolved right
after `release()`). Consistent with "resolves after the pending flush runs", but §12.7 / CLAUDE.md list
the cases (immediate, microtask, `setAttributes`/`batch`, next connect for detached) without the
deferred one, so code awaiting `whenSettled()` on a deferred element waits indefinitely.

**Decision (2026-10-31):** keep it — already "intended" in SPEC §6.3 and the JSDoc; now also in the
§12.7 summary and CLAUDE.md. No caller in any repo awaits it while held (the only one is core's own
unit test pinning the behaviour); app code doesn't call it at all. Release first, then await;
`e2e/lifecycle.spec.ts` waits a frame while held.

---

## 4. A field named `hidden` on a BlissElement subclass shadows `HTMLElement.hidden`

Silent at runtime; only `tsc` catches it — and nothing typechecks `e2e/` or `test/*.ts` today
(`tsconfig.json` includes `src/` only; Playwright doesn't typecheck). Fixtures use `hiddenInput`.
**Proposal:** a `tsconfig.e2e.json` (or `e2e/` + `test/` in `typecheck`) so fixture/spec mistakes fail the gate.

---

## 5. Test-authoring friction (expected behaviour, not bugs)

- **`removedCallback` is frame-timed.** After a detach, a hook-log read may or may not already contain
  `removedCallback`, depending on whether a frame passed. Assert "no reinit" rather than an exact list.
- **An open menu closes on ANY page scroll** (`'scroll'` reason, checked page-wide). Playwright's
  scroll-into-view lands a frame later and can close a menu that just opened. `test/menu.html` keeps
  every trigger in view, so no spec scrolls.
- **A page wider than the phone viewport changes device classification.** Mobile Chrome widens the
  layout viewport when content overflows 390 px, and an iPhone then classifies as `tablet`. Fixtures
  for touch emulation need `<meta name="viewport">` and must not overflow.
- **The example smoke spec allowlists lazily-defined demo tags** (`LAZY_TAGS` in
  `e2e/examples.spec.ts`; today `core-demo-pg-early`) — add any new one there.

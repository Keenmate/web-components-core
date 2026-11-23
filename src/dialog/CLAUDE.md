## Dialog (`src/dialog/`, subpath `/dialog`, SPEC §12.19 — implemented)

`openDialog(opts)` → `{ result, close(value?), panel, body }`; `confirmDialog` / `promptDialog` are thin wrappers.
Mounts `div.km-dialog-layer` (open shadow root: `DIALOG_CSS` + `SHEET_CHROME_CSS`, motion via
`adoptMotionStyles(panel)`) on `container` (default `<body>`), then `startModalSession(panel, { backdrop: true })`.
`finish(value, shouldAsk)`: `beforeCloseCallback` (via `runSafely`; `false` keeps it open) → `session.end()` →
layer removed → `result` resolves. `close()` from code skips the callback. `message` = textContent (escaped);
`content` = a node, raw. Role `alertdialog` when an action `isDanger`. Initial focus: `[autofocus]` in the body →
primary → first button (a danger confirm has no primary, so Cancel). Keyboard inset stays OFF (it would size
the centered card to the viewport). Layout: `top/left: 50%` + `translate` (not `inset: 0; margin: auto;
height: fit-content` — Chromium stretched that to max-height); `@media (max-width: 480px)` = bottom sheet.
Labels: `labels: { ok, cancel, close }`, English defaults. Known limit: `/dialog` has no `/locale` lookup of its
own (no `createLabels`, no page-wide dictionary keys for core's UI) — the calling component passes its own
`createLabels` values as `labels`; an English hard-code in a component is an adoption bug. e2e: `e2e/modal.spec.ts`
(`test/modal.html`); `test/dialog.html` is the older native-`<dialog>` top-layer fixture.

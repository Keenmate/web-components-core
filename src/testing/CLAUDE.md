## Testing utilities (`src/testing/`, SPEC §12.7 — implemented)

`@keenmate/web-components-core/testing` is a separate subpath of runner-agnostic
DOM fixtures (pure DOM, **zero deps**): `mount`/`cleanup`, `mountBeforeUpgrade`
(pre-upgrade capture), `uniqueTag`/`defineOnce`, `nextTick`/`nextFrame`, and
`listen()` → `EventSpy`. Playwright/a11y-contrast fixtures are **deferred** (out
of the input-model core).

`BlissElement.whenSettled()` / `flush()` are documented in the root `CLAUDE.md`.

Playwright + device classes (SPEC §12.7 note): `isMobile: true` on a page WITHOUT
`<meta name="viewport">` reports `innerWidth` 980 → `classifyDevice` = `tablet`. For
`mobile`, emulate touch (`hasTouch: true`) or a device profile on a page WITH the
meta tag. A narrow viewport without touch is still `desktop` (width rules need a
`responsiveCallback`).

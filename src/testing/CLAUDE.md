## Testing utilities (`src/testing/`, SPEC §12.7 — implemented)

`@keenmate/web-components-core/testing` is a separate subpath of runner-agnostic
DOM fixtures (pure DOM, **zero deps**): `mount`/`cleanup`, `mountBeforeUpgrade`
(pre-upgrade capture), `uniqueTag`/`defineOnce`, `nextTick`/`nextFrame`, and
`listen()` → `EventSpy`, `waitForEvent()`, `captureConsole()` (readable lines, `%c` stripped),
`resetPageState()` (core's page-wide state: overlays, scroll lock, environment, theme,
responsive rules, global log level, style caches). `uniqueTag`'s counter is page-wide;
`defineOnce` / `mountBeforeUpgrade` throw on a tag already defined by another class. Playwright/a11y-contrast fixtures are **deferred** (out
of the input-model core).

`BlissElement.whenSettled()` / `flush()` are documented in the root `CLAUDE.md`.

Playwright + device classes (SPEC §12.7 note): `isMobile: true` on a page WITHOUT
`<meta name="viewport">` reports `innerWidth` 980 → `classifyDevice` = `tablet`. For
`mobile`, emulate touch (`hasTouch: true`) or a device profile on a page WITH the
meta tag. A narrow viewport without touch is still `desktop` (width rules need a
`responsiveCallback`).

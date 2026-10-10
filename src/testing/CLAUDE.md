## Testing utilities (`src/testing/`, SPEC §12.7 — implemented)

`@keenmate/web-components-core/testing` is a separate subpath of runner-agnostic
DOM fixtures (pure DOM, **zero deps**): `mount`/`cleanup`, `mountBeforeUpgrade`
(pre-upgrade capture), `uniqueTag`/`defineOnce`, `nextTick`/`nextFrame`, and
`listen()` → `EventSpy`. Playwright/a11y-contrast fixtures are **deferred** (out
of the input-model core).

`BlissElement.whenSettled()` / `flush()` are documented in the root `CLAUDE.md`.

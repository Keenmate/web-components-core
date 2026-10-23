# Code review → rc15 — plan and status

Working plan for the October 2026 review of `@keenmate/web-components-core` and the
follow-up migration of the components. Last updated 2026-10-23.

## Done in core (prod, not pushed)

| Commit | What |
|---|---|
| `e831fb2` | Round 1 bug fixes: throwing `reinit()`/`update()` no longer wedges (settle resolves, failed reinit retried, `connect()`/`disconnect()` balanced); row `default` applies when the converter has none; `mount(html, {container})`; `findHighlightRanges` ß overlap; `anchor()` ignores results after `destroy()`; `data-theme` inheritance crosses shadow roots; fixed-CB detection matches Floating UI; keyboard-inset / environment cancel queued frames; `configureBreakpoints` with viewport-only subscribers. Helpers `dom/frame-scheduler.ts`, `dom/composed-tree.ts`. Docs: loglevel is vendored; `emit()` not `dispatch()`. |
| `c47c832` | Round 2 helpers: `dom/throttle.ts`, `dom/once.ts`, converter `parseJson` / `scalarToAttribute` / `toNumber`, `#liftPreUpgrade`, `#withoutReflect`, logger `withStorage`. Fixes: rejected pre-upgrade value no longer blocks the initial attribute; `toList` / `toObjectArray` defaults copied per instance; `toValue` reflects `null` not `"undefined"`; `lockBodyScroll()` before `<body>`. Removed `getRootLogger` and the `TABLET_MIN_SHORT_SIDE` re-export; `@internal` on apply/event plumbing. |
| `074bbea` | Round 3 — BREAKING clean renames, no aliases (full table in CHANGELOG `[Unreleased]`): `reflect`→`shouldReflect`, `themeContext`→`hasThemeContext`, `resized`→`sizeChanged`, `isRTL`→`isRtl`, `onError`→`errorCallback`, `flip`→`shouldFlip`, `autoUpdate`→`shouldAutoUpdate`, `beforeCompute`→`onBeforeCompute`, `fixedContainingBlock`→`shouldUseFixedContainingBlock`, `followCursor`→`shouldFollowCursor`, `immediate`→`shouldFireImmediately`, `ObserveOptions`→`ObserveEnvironmentOptions` (+ `ObserveThemeContextOptions`), `OverlayHandle.dispose`→`destroy`, `presentationContext`→`createPresentationContext`, `declaredCssVars`→`extractDeclaredCssVars`, `caseInsensitive`→`isCaseInsensitive`, `/search` `prepare`→`getSearchTermCallback`. |

Verified: typecheck, 423 unit, 16 e2e, build. `docs/search-migration-plan.md` has the
user's own uncommitted edits — never stage it.

## Components (all on prod / their branch, not pushed)

All updated components point at `file:../web-components-core` (dropzone / grid:
`file:../../../web-components-core`) until core rc15 is published.

| Component | Renames | Theme context | Commits |
|---|---|---|---|
| web-multiselect | ✓ | ✓ already | `e24c125` (CHANGELOG block `2.6.0-rc04`, unpublished) |
| web-treeview (branch `feature/rc03-svelte-parity`) | ✓ | ✓; OS-only rule removed | `8c98db2` (user WIP), `ee6cd94`, `26fc76d`, `6c7c3f8` |
| web-dropzone | ✓ | ✓ migrated, satellites subscribe via `observeThemeContext` | `3e06e06`, `47badda` |
| web-commandpalette | ✓ | ✓ migrated | `55ad94c`, `9c82fe9` |
| web-editor | ✓ | ✗ only its own `theme="dark"` — ask before migrating | `2a6ee5c` |
| web-grid | none needed | ✓ migrated; core rc02 → local | `dcf80bf` |
| web-daterangepicker | ✓ | ✓ already | `a92140f` (user WIP), `0070ac2` |

Theme policy (decided): components follow the **page**, never the OS on their own.
No `prefers-color-scheme` rules; a page follows the OS with
`html { color-scheme: light dark }`. Page signals come from core's theme context
(`data-context-theme`); a themed wrapper needs `theme-source="closest"`.

## Open

1. **web-daterangepicker** — done. Its e2e has 2 failures that come from the user's own work,
   not the renames: `context-callbacks:77` (test still expects `{ data, picker }`, detail now
   also has `controller`) and `icon-theming:76` (`--drp-shadow-xl` no longer chains to
   `--base-dropdown-box-shadow`). `test/shot-*` / `mobile-time.html` left untracked.
2. **User-owned leftovers to mention.** commandpalette: README paragraph edit sits in their
   uncommitted README; CHANGELOG needs a theme-context line. web-grid: `package-lock.json`
   uncommitted (mixed with their `docs/package.json` vite 8 / happy-dom change).
3. **Core rc15 publish** — on hold: the user is testing the `file:` builds in a few components first, and the interaction-model work (`interaction-model-plan.md`) ships in rc15 too. (`/publish rc` after bumping to `1.0.0-rc15`): README What's New
   (keep two blocks), `release-notes/1.0.0-rc15.md` with the rename table + upgrade checklist.
   Then switch every component from `file:` to `1.0.0-rc15`; commandpalette peer dep
   `^1.0.0-rc12` → `^1.0.0-rc15`. Caret ranges (`^1.0.0-rc13` etc.) would pick rc15 up, so
   don't publish rc15 before the components are ready.
4. **Remaining review findings (behaviour changes — need the user's OK):**
   - logging: instance loggers use `console.debug` (hidden in Chrome); wrappers lose the
     caller's line; `setLevel(getLevel())` detaches from root level changes
   - tooltip stays at (0,0) when its trigger is removed while shown; `cursorRect` not reset
   - element size measured with `getBoundingClientRect` (CSS scale animation)
   - device-class change doesn't fire `environmentChanged`
   - one throwing overlay dismiss handler stops the rest
   - `setAttributes()` attribute-name keys aren't parsed as attribute strings
   - `toEnum({ shouldNullOnInvalid })` can't be cleared with `null` via the property
   - `whenSettled()` resolves before first connect
   - duplicate tag registration is silent
   - subclass class fields can clobber input accessors (`useDefineForClassFields`)
   - `findRegexMatches` recompiles a RegExp per row per keystroke
   - API left as is: `onPlaced` vs `onComputed`; `resolveEnumAttribute` vs `toEnum`;
     `resolveMobilePresentation` (deprecated)
5. **Idea, not agreed:** core ships the four `data-context-theme` / `data-theme` CSS rules
   (adopted by `BlissElement`) so components stop repeating them. CLAUDE.md requires
   confirming a new shared module first.
6. **web-editor theme context** — not requested yet.

## Testing notes

- The user's long-running dev servers hold ports 12200 (multiselect, started Oct 19) and
  12400 (core, Oct 20). Dropzone, commandpalette and grid default to the same ports, and
  Playwright reuses a running server, so their e2e silently tests the wrong app. Run with a
  temporary config (`playwright.alt.config.ts`, deleted afterwards) on 12290–12293:
  `{ ...base, use: { ...base.use, baseURL }, webServer: { ...ws, command: 'npx vite --port N --strictPort', url, reuseExistingServer: false } }`
  (grid: `npm run dev -w docs -- --port 12293 --strictPort`). Don't kill the user's servers.
- After rebuilding core, a Vite server started earlier serves a stale core
  (`does not provide an export named …`) — use a fresh server.
- Known flaky under load (pass alone): multiselect `search-abort` "destroying the element…",
  dropzone `api.spec` upload lifecycle and `satellites-extra` progress.

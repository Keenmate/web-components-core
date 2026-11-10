---
description: Prepare @keenmate/web-components-core for npm publish — bump version, finalize CHANGELOG/README, build, test, commit
argument-hint: rc|release|patch|minor|major
---

# /publish — prepare an npm release of @keenmate/web-components-core

You are preparing this package for `npm publish`. **Do not run `npm publish`** — the user logs in and publishes manually.

This command follows the canonical `/publish` structure defined in the BlissFramework component guidelines at
`web-components/publish-command.md`. Sections marked **[canonical]** are byte-identical across every
component's `/publish`; sections marked **[per-repo]** are customized for this repo's layout, build, and tests.

## Argument [canonical]

The release type: **$ARGUMENTS**

Must be one of:

- `rc` — ship the WIP rc as-is. The topmost CHANGELOG heading (e.g. `## [1.10.0-rc02] - 2026-06-18`) gets ` [PUBLISHED]` appended.
- `release` — promote a WIP rc to a final release. `X.Y.Z-rcN` → `X.Y.Z`. CHANGELOG heading is renamed to match the new version.
- `patch` — SemVer patch bump. Drops any `-rc` suffix.
- `minor` — SemVer minor bump. Drops `-rc`. Resets patch.
- `major` — SemVer major bump. Drops `-rc`. Resets minor and patch.

If missing or invalid, stop and ask the user which one to use (don't guess).

## Repo layout [per-repo]

Single-package **library** repo, everything at root. Core is not a component: it is the input model, the
`BlissElement` base class and the page-wide helpers that every Keenmate component bundles
(web-multiselect, web-daterangepicker, web-treeview, …), so a broken core breaks all of them.

- **`./package.json`** — `version` field is the source of truth.
- **`./CHANGELOG.md`** — at the root. Keep-a-Changelog: the WIP entries sit under **`## [Unreleased]`** at the top; released versions sit below as `## [X.Y.Z] - YYYY-MM-DD` (see the per-repo paragraph under "CHANGELOG convention").
- **`./README.md`** — at the root. Carries `## What's New in vX.Y.Z` sections near the top (one per release, the **two most recent** retained). npm ships it regardless of `files`.
- **`./docs/`** — `usage.md` / `theming.md` / `examples.md` / `accessibility.md` and `reactivity-and-batching.md`, published with the package. `docs/SPEC.md`, `docs/review/` and the plan files are contributor working docs and are **not** in `files`.
- **`./release-notes/<X.Y.Z[-rcN]>.md`** — one per release (no `v` in the file name), published. The upgrade guide and the highlights; the CHANGELOG stays the exhaustive list. Written in step 1 (repo-specific bullet).
- **`./dist/`** — gitignored. Produced by `npm run build` (`tsc -p tsconfig.build.json` → ESM + `.d.ts`). Never staged.
- **`./component-variables.manifest.json`** — published (the `--km-menu-*` / `--base-*` surface core's modules read). Edit it if that surface changes.
- **No Custom Elements Manifest of its own** — core defines no element. It ships the CEM *tooling* (`./cem`) the components run.
- **Subpath exports:** `.`, `./testing`, `./cem`, `./positioning`, `./actions`, `./search`, `./menu` — each must resolve to a built file under `dist/` after the build.

## CHANGELOG convention in this repo [canonical]

There is **no `## [Unreleased]` section**. The WIP section is the topmost `## [X.Y.Z] - YYYY-MM-DD` heading without a `[PUBLISHED]` tag. Already-released sections carry `[PUBLISHED]` at the end of their heading:

```
## [1.10.0-rc02] - 2026-06-18                  ← WIP, the one you're shipping
### Added
- ...

## [1.9.0] - 2026-06-09 [PUBLISHED]
### Added
- ...
```

Publishing the WIP section means **appending ` [PUBLISHED]`** to its heading — exact format: `## [X.Y.Z] - YYYY-MM-DD [PUBLISHED]`. The next development cycle creates a fresh `## [next-version] - <date>` heading on its first CHANGELOG edit.

**This repo keeps Keep-a-Changelog's `## [Unreleased]` instead** (an accepted deviation, `VALIDATION-NOTES.md` → C-PC-1). Released sections are `## [X.Y.Z] - YYYY-MM-DD` with **no** `[PUBLISHED]` tag: every section below `## [Unreleased]` is published (each release commit is tagged `vX.Y.Z`). Wherever the canonical steps below talk about the WIP section or the `[PUBLISHED]` tag, read them like this:

- **The WIP section** is `## [Unreleased]`, and `WIP_VERSION` is `NEW_VERSION` (an Unreleased section has no version of its own).
- **Step 3 / the `rc` argument:** instead of appending ` [PUBLISHED]`, rename `## [Unreleased]` to `## [NEW_VERSION] - YYYY-MM-DD` (today's date) and insert a fresh, empty `## [Unreleased]` heading above it. That fresh heading is this repo's convention; the canonical "do not create an empty `[Unreleased]`" rule doesn't apply here.
- **Step 6:** "the previous `[PUBLISHED]` tag" is the first `## [X.Y.Z] - …` heading below the one you just finalized; its commit carries the git tag `vX.Y.Z`.
- **Step 11:** "the `[PUBLISHED]` tag is now in place" means "the `[Unreleased]` → `[NEW_VERSION]` rename is in place" — revert it (and the version bump) if the publish fails.
- **Never add `[PUBLISHED]`** to any heading in this repo, old or new.

## Resolve versions [canonical]

Read `./package.json` `version` as `CURRENT_VERSION`.
Read the topmost `## [X.Y.Z...]` heading from `./CHANGELOG.md` as `WIP_VERSION` (the version the latest WIP section is tagged for).

Compute `NEW_VERSION`:

| Argument | Logic |
|---|---|
| `rc` | If `CURRENT_VERSION` matches `X.Y.Z-rcN`, `NEW_VERSION = CURRENT_VERSION` (no bump — we're shipping what's already in package.json). If `CURRENT_VERSION` is not an rc, stop and ask the user (they probably wanted `release`/`patch`/etc.). |
| `release` | If `CURRENT_VERSION` matches `X.Y.Z-rcN`, `NEW_VERSION = X.Y.Z`. Otherwise stop. |
| `patch` | Strip any `-rcN`, then bump patch. |
| `minor` | Strip any `-rcN`, then bump minor, reset patch. |
| `major` | Strip any `-rcN`, then bump major, reset minor and patch. |

If `WIP_VERSION` ≠ `NEW_VERSION` (e.g. the WIP is `X.Y.Z-rcN` but the user asked for `release`), the CHANGELOG heading rename in step 3 also re-tags the section to `NEW_VERSION` — call this out in the report so the user notices.

## Steps (in order)

### 1. Sanity checks [canonical]

- Run `git status`. The repo intentionally keeps `.claude/settings.local.json`, `test-results/`, `playwright-report/`, `coverage/` and `dist-examples/` untracked — those are fine. If there are **other** uncommitted changes that aren't `CHANGELOG.md`, `README.md`, or `package.json`, list them and ask the user before continuing. (Typical case: substantive source changes belonging in this release that haven't been committed yet — confirm they're intended for this version before bumping.)
- **Verify the new version isn't already on npm.** Run `npm view @keenmate/web-components-core@<NEW_VERSION> version 2>/dev/null` — if it returns the version string, that version is already published and **stop**: bumping over it would fail at publish time and pollute the commit.
- **Verify the registry hasn't drifted past you.** Run `npm view @keenmate/web-components-core version` to fetch the latest published version on the `latest` tag; if it's higher than `NEW_VERSION` (e.g. someone shipped from another machine, or there's a registry-vs-local mismatch from before the [PUBLISHED] convention landed), warn the user and ask before continuing.
- Confirm the WIP CHANGELOG section has at least one bullet of substantive content under `### Added`, `### Changed`, `### Removed`, `### Fixed`, or `### Internal`. If empty, stop — there's nothing meaningful to release.
- Confirm `./README.md` has a `## What's New in vWIP_VERSION` section. If it's missing, draft one from the CHANGELOG and present it to the user for approval before continuing:
  - Read the WIP CHANGELOG section, distill it to 5–8 scannable bullets covering the Added/Changed themes (paraphrase, don't copy CHANGELOG bullets verbatim — those are exhaustive; What's New is the highlight reel). Pure internal refactors and Fixed-only entries don't need coverage, though headline bug fixes worth advertising are worth a bullet.
  - **Follow the canonical "What's New" format** defined in the BlissFramework component guidelines (`web-components/readme-structure.md` → "`## What's New in vX.Y.Z` — canonical format"). Auto-check **C-RS-16** in `readme-structure.checks.sh` enforces it. Concretely:
    - **Heading:** `## What's New in vNEW_VERSION` — lowercase `v`, no backticks around the version, no date.
    - **Each bullet:** `- **<area or component> — <one-line headline>** — <engineer-level prose, 3–8 sentences>`. Bold-wrapped lead phrase, then a true em-dash (` — `, U+2014 with surrounding spaces), then a prose body explaining *what changed*, *why* (regression history / motivation), *what surface is affected* (concrete component / prop / file names listed inline), and *the mechanism* (the technique used). Plain hyphens or en-dashes fail the check.
    - **No `### ` sub-headings** inside a What's New section — no `### Added` / `### Fixed` lifted from the CHANGELOG. It's a flat bullet list.
    - **Reference implementation:** the `## What's New in v1.3.3` / `v1.3.2` sections at the top of `svelte-fluentui/README.md` are the canonical shape — mirror that voice and structure.
  - Show the user the proposed draft as plain markdown in your reply. Ask whether to (a) insert as-is, (b) edit, or (c) abort so they can write it themselves.
  - Only proceed past step 1 once the user approves the draft (or supplies their own). On approval, insert the section directly above the current top `## What's New in vX.Y.Z` heading in `./README.md`, then continue.
  - Do not silently insert the draft without confirmation — release highlights are a writing call and the user owns the voice.
- Confirm `./release-notes/NEW_VERSION.md` exists. Every rc, minor and major ships one, and so does a patch whose WIP CHANGELOG section has an `Added`, `Changed`, `Removed` or `Security` entry; a patch with only `Fixed` / `Internal` entries may skip it (`web-components/release-notes.md` → "Which versions get notes") — ask the user whether to write one. If it's missing and required, draft it and present it to the user for approval before continuing, exactly as for What's New:
  - **Follow the canonical template** in the BlissFramework component guidelines (`web-components/release-notes.md` → "The template"); `release-notes.checks.sh` (C-RN-1 … C-RN-9) enforces the shape. Header (title, `**Released:**` status line, baseline paragraph, absolute CHANGELOG link) → Contents → Requirements → Upgrade checklist (`- [ ]` items grouped by audience, each linking its details) → Breaking changes → Behaviour changes → New features → New API → Visible changes without a migration → Fixes → Documentation → Internal; drop empty optional sections.
  - **Baseline:** the last version on npm (`npm view @keenmate/web-components-core versions`) — except for `release` (a final after rcs), whose notes are a **consolidated guide from the previous final**, written fresh, linking the rc notes. Fold in any version that never reached npm and say so.
  - Draft from the CHANGELOG sections between the baseline and `NEW_VERSION`: every Removed / breaking Changed entry gets a Breaking-changes `###` **and** an Upgrade-checklist item.
  - Show the draft, ask (a) insert as-is, (b) edit, or (c) abort; write the file only on approval.

Repo-specific sanity checks:

- **Consumers.** Core is bundled by every component; each `### Changed — BREAKING` entry needs a matching upgrade-checklist item in the release notes.

### 2. Bump version (if needed) [canonical]

If `NEW_VERSION` ≠ `CURRENT_VERSION`, edit `./package.json` and change `"version": "CURRENT_VERSION"` to `"version": "NEW_VERSION"`.

For `rc` arg this is normally a no-op — version was bumped earlier in the development cycle.

### 3. Finalize CHANGELOG [canonical]

In `./CHANGELOG.md`:

- If `WIP_VERSION` ≠ `NEW_VERSION` (e.g. promoting `X.Y.Z-rcN` → `X.Y.Z`), rename the WIP heading from `## [WIP_VERSION] - <date>` to `## [NEW_VERSION] - <today>` (today's date from system context).
- If `WIP_VERSION` == `NEW_VERSION`, leave the bracketed version alone but update the date to today **if** the existing date is stale (more than a few days old). The WIP date is usually whatever day the section was opened; refresh it so the changelog reflects the actual ship date.
- In either case, **append ` [PUBLISHED]`** to the heading so it reads exactly: `## [NEW_VERSION] - YYYY-MM-DD [PUBLISHED]`.
- Leave all bullet content untouched.
- **Do not** create an empty new WIP section — the next dev cycle's first CHANGELOG edit will create one.

### 4. Update README "What's New" — only if version changed [canonical]

In `./README.md`:

- If the existing `## What's New in vWIP_VERSION` section's version differs from `NEW_VERSION` (e.g. promoting `X.Y.Z-rcN` → `X.Y.Z`), rename its heading to `## What's New in vNEW_VERSION`. (No content rewrites — the text was already curated for this release.)
- Then count the `## What's New in vX.Y.Z` headings. If there are more than **two**, delete the oldest ones so only the **two most recent** remain (the just-finalized one plus the one before it).

For `rc` arg this is normally a no-op on the heading itself — only trims if someone left an extra-old section behind.

Each What's New section opens with its upgrade-guide line (`Upgrade guide: the [NEW_VERSION release notes](release-notes/NEW_VERSION.md); …`); add it if missing. When a section is trimmed, move its release-notes link to the front of the `Earlier releases:` line below the retained sections.

### 5. Validate README reflects the release [canonical]

Read both the finalized CHANGELOG section and the matching `What's New in vNEW_VERSION` section. Every **Added** or **Changed** bullet in the CHANGELOG that represents a user-facing feature or behavior change should have a corresponding hit in the What's New section (paraphrased, not verbatim). Pure internal refactors and `Fixed`-only entries don't need coverage, though headline bug fixes worth advertising (e.g. "X used to silently fail; now works") are worth a bullet.

If you find a significant CHANGELOG entry that isn't reflected in What's New, add a bullet for it. If the section ends up with more than ~8 bullets after this pass, condense — What's New should be scannable, not exhaustive.

Then validate `./release-notes/NEW_VERSION.md`, when there is one, against the same CHANGELOG sections (C-RN-12): every breaking change has an Upgrade-checklist item, the Requirements table matches the `@keenmate/*` dependencies in `package.json` (C-RN-10), and `release-notes.checks.sh` passes. Fix the notes, or ask the user, before continuing.

### 6. Validate CHANGELOG entries match recent work [canonical]

Find the previous `[PUBLISHED]` tag in CHANGELOG (the version just before NEW_VERSION) and locate the commit that bumped to it — usually a commit whose subject starts with `v<previous-version>` or `- v<previous-version>`. Run `git log --oneline <previous-publish-commit>..HEAD` to list commits since.

Also check `git diff` (or `git status`) for any uncommitted source/test work outside the files you're editing in this command.

For every substantive commit or uncommitted change, verify the WIP CHANGELOG section mentions it. If something significant is missing, **stop and ask the user** before finalizing — don't invent entries on their behalf. Pure example/doc tweaks and trivial typo fixes don't need entries.

### 7. Run tests [per-repo]

Run, in order — every one must pass:

1. `npm run typecheck` — `tsc --noEmit` over `src/` and the tests.
2. `npm test` (or `make verify`, which runs both of these) — the vitest unit suite.
3. `npm run test:e2e` (or `make test-e2e`) — the Playwright e2e suite (Chromium) against the `test/` fixtures and the example pages.
4. `npx kmwc doctor` — 0 errors: devkit checks, package contents and the rulebook suites that apply to a library (accepted deviations are listed in `VALIDATION-NOTES.md`).

If anything fails, **stop and report**. Do not proceed to build/commit. The user fixes the regression (or decides to fixme the spec) before the publish flow can continue. This gate is what keeps a broken core away from every component that bundles it.

If Playwright complains that chromium isn't installed, suggest `make test-e2e-install` and stop.

### 8. Build the package [per-repo]

Run `npm run clean:dist` and then `npm run build` (or `make build`). The build runs `tsc -p tsconfig.build.json`, which emits ESM + `.d.ts` into `dist/`; cleaning first keeps a file from a removed module out of the package (`make publish` / `make publish-rc` clean too).

If the build errors, stop and report.

After build, do a quick smoke check on the emitted artifacts — every export-map subpath must exist and be non-empty:

- `dist/index.js` + `dist/index.d.ts`
- `dist/testing/index.js` + `.d.ts`
- `dist/cem/index.js` + `.d.ts`
- `dist/positioning/index.js` + `.d.ts`
- `dist/actions/index.js` + `.d.ts`
- `dist/search/index.js` + `.d.ts`
- `dist/menu/index.js` + `.d.ts`

There is no Custom Elements Manifest to regenerate: core defines no element (the spec's CEM bullet is N/A for this library).

### 9. Verify the package contents [per-repo]

Run `npm pack --dry-run` (or `make publish-dry`, which also cleans and builds first) and confirm the file list includes:

- `dist/` (JS + `.d.ts` for every subpath above)
- `component-variables.manifest.json`
- `release-notes/` (the upgrade guide for every published version)
- `docs/usage.md`, `docs/theming.md`, `docs/examples.md`, `docs/accessibility.md`, `docs/reactivity-and-batching.md`
- `release-notes/NEW_VERSION.md`
- `README.md`
- `LICENSE`
- `package.json`

If anything user-facing is missing or anything private leaked in (e.g. `src/`, `test/`, `e2e/`, `*.test.ts`, `*.spec.ts`, `examples-*.html`, `docs/SPEC.md`, `docs/review/`, `CLAUDE.md`, `tsconfig*.json`, `vite.config.ts`, `Makefile`), stop and report — the `files` field in `package.json` controls this and the leak needs fixing before publish.

### 10. Commit [canonical]

Stage:

- `./CHANGELOG.md`
- `./README.md`
- `./package.json`
- `./release-notes/NEW_VERSION.md`

Do **not** stage `dist/` — it's gitignored.

Commit message format:

```
vNEW_VERSION - <one-line summary of the headline change>

<grouped bullets paraphrased from the CHANGELOG section — split into the same
groups the CHANGELOG used: Added, Fixed, Changed, Internal, etc. Keep bullets
terse; full prose lives in the CHANGELOG.>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### 11. Report [canonical]

Report back with:

- The new version number
- The commit SHA
- The exact commands to publish. **Pick the right one for the arg type:**
  - For `rc` (publishing a pre-release):
    ```
    npm login          # if not already logged in
    npm publish --tag rc
    ```
    The `--tag rc` is critical — without it npm assigns the `latest` dist-tag, which would make the pre-release the default install for everyone running `npm install @keenmate/web-components-core`. With `--tag rc`, the `latest` tag stays put and consumers opt in via `@rc` or pinning the exact version.
  - For `release` / `patch` / `minor` / `major` (publishing a stable release):
    ```
    npm login          # if not already logged in
    npm publish
    ```
    No `--tag` needed — it correctly lands as `latest`.
- A reminder that the CHANGELOG `[PUBLISHED]` tag is now in place — if `npm publish` fails, the user should revert both the tag (CHANGELOG heading) and the version bump (`package.json`) before retrying, since the registry will refuse to re-publish the same version.
- `make publish-rc` / `make publish` run the same `npm publish` after the release gates (`kmwc check-release`: the version fits the dist-tag and isn't on npm yet).

## Things not to do [canonical]

- **Do not run `npm publish`.** The user publishes manually after `npm login`.
- **Do not push to git remote.** The commit stays local until the user pushes.
- **Do not create an empty `[Unreleased]` or new WIP heading** in CHANGELOG after finalizing — the next dev cycle's first edit creates the next heading.
- **Do not retro-fix older CHANGELOG sections** that are missing the `[PUBLISHED]` tag or carry legacy markers — only finalize the section you're shipping.
- **Do not silently insert a drafted What's New section.** If you draft one in Step 1 because it's missing, you must present it and wait for explicit approval (or edits) before inserting — the writing voice is the user's call, even when you're handing them a starting point.
- **Do not keep more than two `## What's New in vX.Y.Z` sections in the README.** Step 4 trims older ones; if you see three or more after Step 4, you missed one.
- **Do not skip the build step** — without it `dist/` is stale and the publish would ship outdated artifacts (or fail entirely if `dist/` was wiped by `make clean`).
- **Do not skip the test gate** if the repo has one — the gate is what catches regressions before they ship.
- **Do not invent CHANGELOG entries** to cover commits you find; ask the user if something's missing.
- **Do not bump if there's nothing meaningful in the WIP section** — stop and explain.

### Repo-specific don'ts

- **The `[Unreleased]` mapping wins.** In this repo step 3 *does* insert a fresh empty `## [Unreleased]` (see "CHANGELOG convention"), and no heading ever gets `[PUBLISHED]`.
- **`make publish-rc` / `make publish` are the user's publish commands** — they prompt, run the gate, clean, build and publish; name them in the report next to the `npm publish` lines.
- **Do not stage `dist/`, `test-results/`, `playwright-report/`, `coverage/` or `dist-examples/`** — they're either ignored or test artifacts.
- **Do not stage the user's own work-in-progress files** (e.g. `docs/search-migration-plan.md`) — they are not part of a release.

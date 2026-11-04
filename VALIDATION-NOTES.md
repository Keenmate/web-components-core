# Validation notes — accepted deviations

This file records deviations from the BlissFramework component guidelines
(`guidelines/web-components/`) that are the correct outcome for this package.
Each entry explains *why the deviation is correct here*; `kmwc doctor` and
`/validate-web-component` runs read the `## C-…` headings and count a matching
failure as an accepted deviation.

Deferrals ("we'll fix this later") are **not** valid entries — they get
re-promoted to failures on every run by design. Only architectural decisions
belong here.

`@keenmate/web-components-core` is a **library** (registry `kind: "library"`):
the input model, the `BlissElement` base class and the page-wide helpers that
every Keenmate component bundles. It defines no custom element of its own and
ships no component stylesheet. Doctor runs only the suites that apply to a
library (naming-conventions, readme-structure, publish-command, example-pages).

## C-NC-1 — No custom-element tag of its own

C-NC-1 checks the tag a component passes to `customElements.define()`. Core has
no tag: each component names and defines its own element. The only
`customElements.define` call in `src/` is inside `define(name, ctor, options)`
(`src/element/define.ts`), the idempotent, SSR-safe helper components call with
*their* tag, so the name is a parameter, never a literal. The example pages'
demo elements (`core-demo-*`) live outside `src/` and are not part of the
package. Giving core a tag just to satisfy the check would ship an element
nobody uses. The tag rule itself is enforced in every component repo. (The
suite has no library mode yet — `rulebook-gaps-from-devkit.md` item 5.)

## C-NC-2 — `km-overlay-activate` is a page-wide protocol event, prefixed on purpose

C-NC-2 asks for bare component event names (`change`, `select`), dispatched on
the component's host. `km-overlay-activate` (`OVERLAY_ACTIVATE_EVENT`,
`src/overlay/active-overlay.ts`) is not a component event. It is dispatched on
`document` as the one coordination channel between every overlay on the page:
each component's bundled copy of core, and outside code that imports nothing
(a Svelte popover, a plain-DOM widget) — "opening one dismisses the others in
its group". On `document` a bare `overlay-activate` would share a namespace with
every other library and page script, so it carries the same `km-` namespace as
core's other page-wide keys (`km-log:*`). It is present tense, and its payload
is typed (`OverlayActivateDetail`). Every event core dispatches on a
component's host (`emit()`, `input-rejected`, `action`) stays bare.

## C-PC-1 — CHANGELOG keeps Keep-a-Changelog's `## [Unreleased]`

publish-command.md says every repo uses the `[PUBLISHED]`-tag convention with
no `## [Unreleased]` section. Core keeps Keep-a-Changelog: work in progress
goes under `## [Unreleased]`, `/publish` renames it to
`## [X.Y.Z] - YYYY-MM-DD` and opens a fresh empty `[Unreleased]` above it,
and no heading carries `[PUBLISHED]` (every section below `[Unreleased]` is
published; each release commit is tagged `vX.Y.Z`). The reason is the
library's place in the suite: every component bundles core, and the
component sessions migrating to the next core read "what has changed since
the last release" from one fixed heading before anyone has picked the next
version, including the release cut (one rc or two). A versioned WIP heading
would have to name that version up front. The user's call (2026-11-04,
after rc18).

`.claude/commands/publish.md` keeps every `[canonical]` block byte-identical
(C-PC-1…C-PC-10 pass) and adds one per-repo paragraph under "CHANGELOG
convention in this repo" that maps the canonical `[PUBLISHED]` wording onto
this convention, plus a repo-specific don't. No auto check fails because of
it; the entry is here so the deviation is recorded, not silent.

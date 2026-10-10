## Positioning (`src/positioning/`, SPEC §12.2 — implemented)

`@keenmate/web-components-core/positioning` is a subpath over one pinned
`@floating-ui/dom`. `anchor(floating, reference, opts)` is the low-level
primitive (`'fixed'` default; `offset→size→flip→shift` middleware;
`matchWidth: 'min'|'exact'`; `lockPlacement` → `true` = `flip({ fallbackStrategy:
'initialPlacement' })`, `'freeze'` = flip once then pin the resolved placement;
`beforeCompute` per-frame hook (publish reference width to a CSS var / clamp
before measuring); `data-theme` inheritance for portaled layers per C-CS-10;
optional `platform` escape hatch) returning `{ update, destroy }`.
`createTooltip()` (hover/focus + delay + `followCursor` via `VirtualElement`;
`onBeforeShow` to dismiss an overlapping tooltip; `ShadowRoot` container for
shadow-scoped tooltip CSS/vars) and `createPopover()` (portaled dropdown/panel,
width-match, placement lock) are thin wrappers. Decisions: follow-cursor is a
tooltip option not a preset; the bespoke shadow-DOM platform was NOT ported (1.8
handles it + the `platform` hatch — a component with a genuinely custom platform,
like web-multiselect's narrowed fixed-position containing-block heuristic, passes
it via that hatch). Tests mock `@floating-ui/dom` (jsdom has no layout).

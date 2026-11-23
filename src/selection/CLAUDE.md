## Selection model (`src/selection/selection.ts`, main index, SPEC §12.27 — implemented)

`createSelection`: a `Set` (selection order) + anchor; every write goes through `commit(next)` which diffs
against the current set and calls `onChange` via `runSafely` unless nothing changed / `isSilent`. Ranges use
`getOrderedKeys()` per call (display order) and filter `isSelectable`. `mode` read per call. Pure logic — no
DOM; `e2e/selection.spec.ts` only proves real `MouseEvent` modifiers (incl. Cmd via `ControlOrMeta`) reach it.

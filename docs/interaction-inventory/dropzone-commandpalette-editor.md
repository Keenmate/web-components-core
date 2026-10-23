# web-dropzone, web-commandpalette, web-editor — interaction inventory (phase 0)

Read-only pass (2026-10-23). Target shape: `../interaction-model-plan.md`.

## web-dropzone (`C:\Git\KM\web-dropzone`)

Main element `DropzoneElement` (`packages/web-dropzone/src/web-component.ts:247`, BlissElement);
renderer `WebDropzone` (`src/dropzone.ts:136`) extends `DropzoneCore`
(`packages/web-dropzone-core/src/dropzone-core.ts:59`). Satellites (picker, indicator, list,
progress) extend `SatelliteElement` (`src/satellite-base.ts:176`) — **not BlissElement**.
TY = core `src/types.ts`, SA = `store-api.ts`.

### Action items
Internal `RowAction` `'pause'|'resume'|'retry'` + `ACTION_ICONS`/`ACTION_LABELS` (core
`src/icons.ts:87-98`); remove ✕, Clear, Retry-all hard-coded. Nothing host-configurable →
optional later: built-in `ActionItem<FileActionContext>` row actions. Not in phase 6 scope.

### Contexts
| current | fields | file:line | notes |
|---|---|---|---|
| `FileUploadContext` | startBytes, startPercent, metadata, setMetadata, uploadMetadata | TY:214 | 4th positional arg of the upload handler |
| `FileItemRenderContext` | index, displayMode, isInPopover | TY:412 | 2nd positional |
| `StatusSurfaceArgs` | currentFile, currentFilePercent, currentFileStatus, aggregate, overallPercent, overallStatus, files, store | SA:104 | single ctx; `store` → `controller`, + element |

### Events — raw `dispatchComposedEvent()` (core `dom-utils.ts:28`), no events table, **no `on*` twins**

| current | detail | emitted | proposed |
|---|---|---|---|
| `file-added` | {file} | dropzone-core.ts:1277 | `file-add` (README:185 / CLAUDE.md:303 wrongly say {file, files}) |
| `file-removed` | {file} | :1282 | `file-remove` |
| `files-changed` | {changedIds, files} (rAF) | :1301 | `files-change` |
| `change` | none | :1308 | `change` (README says {files} — wrong) |
| `dz-config-changed` | none | :1320 | internal; satellites listen |
| `files-rejected` | {rejectedFiles} | :1324 | `files-reject` (README wrong) |
| `file-retry` | {file} | :1328 | keep |
| `file-uploaded` | {file} | :1332 | `file-upload-complete`? (decide) |
| `file-deleted` | {file} | :1336 | `file-delete` |
| `file-progress` | {id, progress, status, file} | :1347 | keep |
| `file-status-changed` | {id, prevStatus, nextStatus, file} | :1363 | `file-status-change` |
| `file-updated` | {file} | :1381 | `file-update` |
| `file-row-update` | {file}, on the **consumer's row element** | dropzone.ts:822 | keep (renderer hook) or `get*Callback` |
| `overlay-enter` / `overlay-leave` | {overlayElement} | dropzone.ts:2677 / 2690 | keep, add types |
| `dz:overlay-drag-ended` | Event on document | dropzone.ts:2813 | internal |
| `store-ready` | none | web-component.ts:390 (+ `data-ready`) | `ready`; satellite handshake satellite-base.ts:63-68 |
| `dz-summary-click` | none | web-component-list.ts:310 | `summary-activate` |
| `dz-queue-open` | none | web-component-list.ts:536 | `queue-open` |

### Callbacks (positional unless noted)
| current | signature | file:line | contract | proposed |
|---|---|---|---|---|
| `beforeFilesAddedCallback` | `(files, existingFiles) → bool\|Promise` | TY:658; core :1024 | falsy cancels → `files-rejected` code `cancelled`; no replace (INPUTS :222 claims `File[]`) | `beforeFilesAddCallback(ctx)`: `false` / `File[]` |
| `beforeFilesRemovedCallback` | `(files, allFiles)` async | TY:668; core :221, :294 | falsy cancels; UI or `{confirm:true}` only | `beforeFilesRemoveCallback(ctx)` |
| `validateCallback` | `(file, existingFiles) → ValidationResult` | TY:627; file-pipeline.ts:119 | | `validateCallback(ctx)` |
| `fileIconCallback` | `(file) → string\|null` | TY:649 | | `getFileIconCallback(ctx)` |
| `uploadFileCallback` | `(file, onProgress, signal, context)` | TY:285, 680; core :774 | async | `(ctx{file, signal, setProgress, …})` |
| picker `uploadCallback` | same | picker :86 | | rename `uploadFileCallback` |
| `persistStateCallback` / `loadStateCallback` | `(key, state)` / `(key)` | TY:771, 779 | async | ctx |
| `renderFileItemCallback` | `(file, ctx)` | TY:796 | | ctx |
| `renderListWrapperCallback` | `(rowsHtml, files)` | TY:813 | | ctx |
| `renderPromptCallback` / `renderSummaryCallback` | `()` / `(files)` | TY:815, 817 | | ctx |
| `renderRolling{Body,FileInfo,Progress}Callback` | `(args)` single ctx | TY:827-831 | null default, false hides | ok; **not in element INPUTS** |
| indicator `render{Body,FileInfo,Progress}Callback` | same | indicator :138-169 | | names differ from store's `renderRolling*` |
| `customStylesCallback` | `()` | TY:833 | | cross-component |

### Facade
Element: getStore, files, addFiles, removeFile, clear, getFile, updateFileProgress,
setFileStatus, uploadAll, uploadFile, pause/resume/cancel/retry File/All, destroy,
formResetCallback, boolean aliases. `DropzoneStoreAPI` (SA:46) is already a facade →
`DropzoneController` as `el.controller` (replaces `getStore()`); `DropzoneCore` → `DropzoneEngine`.

### Tests / docs
e2e: events, events-extra, gates, api, architecture, satellites-extra, drag-overlay, structural,
validation, upload-edge; fixtures `test/*.html` + COVERAGE.md; README:185-188, CLAUDE.md:303-306
(stale), ARCHITECTURE.md:64-67, core README, docs/api-reference.html; all examples (react/vue
use `files-changed`).

### Drift
No events table/twins; past tense everywhere; `dz-` prefixes + `store-ready`; no
controller/element; positional callbacks; before* boolean-only despite documented `File[]`;
`uploadCallback`/`fileIconCallback` naming; renderRolling* not settable; satellites not
BlissElement; facade named "store", engine "Core"; README/CLAUDE event docs wrong.

## web-commandpalette (`C:\Git\KM\web-commandpalette\src`)

`CommandPaletteElement` `<web-command-palette>` (web-component.ts:145, BlissElement, events
:132-139). T = `types.ts`.

### Item-like config
| current | fields | file:line | proposed |
|---|---|---|---|
| `Command` | id, shortcut ("/go"), name, aliases?, hotkey?, description?, icon?, steps? | T:50 | `extends ActionItem<CommandContext>`: `name`→`text`, `hotkey`→`shortcut`, current `shortcut`→`trigger` (slash token), `description` stays (subtitle) or → `tooltip`; + `onClick`, `isVisible`/`isDisabled` + get-callbacks, `cssClass`, `isDanger`. **`shortcut` name clash** |
| `Context` (search scope) | id, shortcut (":products"), name, aliases?, description?, icon?, search?(query, signal) | T:65 | same renames; `search` → `searchCallback(ctx)` |
| `Option` (step) | id?, label, value?, description?, icon?, steps? | T:81 | `label`→`text` |
| `Result` | id, title, subtitle?, icon?, badge?, badgeVariant?, href?, group? | T:97 | data item, not an action; `title` vs `name`/`label` |
| `Step` | id, prompt?, placeholder?, freeText?, search?, options?, shouldShow?(selections), load?(ctx, signal) | T:23 | `getIsVisibleCallback(ctx)`, `getOptionsCallback(ctx)` |

### Contexts
`StepOptionsContext` {commandId, stepId, query, selections} (T:126, signal separate);
`ConfirmationContext` {type, commandId?, commandName?, selections?, sentence, item?, scope?,
duration} (T:162); `Selection` (T:114); `UsageEntry` (T:143); internal `Effect` (palette.ts:57).

### Events — BlissElement `emit`; twins `onCp*` (web-component.ts:175-180) receive the CustomEvent

| current | detail | emitted | proposed |
|---|---|---|---|
| `cp-open` | {} | :592 | `open` / `onOpen` + controller/element/presentation |
| `cp-close` | {} | :615 | `close` / `onClose` |
| `cp-select` | `SelectEventDetail {item, scope}` (T:298) | :274 | `select` / `onSelect` |
| `cp-complete` | `CompleteEventDetail {commandId, selections}` (T:302) | :278 | `complete` / `onComplete` |
| `cp-command` | `CommandEventDetail {commandId}` (T:306) | :282 | `command` / `onCommand` (+ `command` object) |
| `cp-ready` | {} | :476 | `ready` / `onReady` |

Event map :123-130; FUTURE note :268 (cancelable select/complete/command → `beforeSelectCallback` /
`beforeCommandCallback`). `command` vs `action`: a palette command is an action item → decide
whether `cp-command` becomes the unified `action` event (open question).

### Callbacks
| current | signature | file:line | proposed |
|---|---|---|---|
| `searchCallback` | `(scope, query, signal)` | T:187; palette.ts:895 | `(ctx{scope, query, signal, controller, element})` |
| `Context.search` | `(query, signal)` | T:77 | ctx |
| `stepOptionsCallback` | `(ctx, signal)` | T:188; palette.ts:732 | `signal` into ctx; `getStepOptionsCallback`? |
| `Step.load` / `Step.shouldShow(selections)` | | T:46 / T:40 | ctx |
| `loadUsageCallback()` / `saveUsageCallback(entry)` | | T:183-185 | ctx |
| `renderConfirmationCallback(ctx)` | single ctx | T:181; :320-326 | ok + controller/element |

### Facade
isOpen, open, close, toggle, reset, openWith(query), openFavorites, openRecent, setCommands,
setContexts (web-component.ts:568-660). Internal: `PaletteMachine` (palette.ts:179) →
`PaletteEngine`; `MachineHost` (exported index.ts:9) → `PaletteEngineHost`; UsageStore,
Renderer, GlobalKeys.

### Tests / docs
e2e basic, confirmation, search, usage, wizard, examples; `test/fixture.html:29`; unit helpers,
palette, usage; docs/usage.md:91-104, 120, 186, 266-270; README:39, 80-81, 99-102;
docs/examples.md:33; IMPLEMENTATION_PLAN.md; examples-*.html. **External:** LiveView bridge
`@keenmate/keen-web-commandpalette` consumes event names + `data-search-event` /
`data-step-options-event` (INPUTS :117-120).

### Drift
`cp-` prefix ×6; empty details; twins get the Event; positional search/step callbacks; no
before*; `Command.shortcut` clash; name/label/title inconsistency; engine named `*Machine`.

## web-editor (`C:\Git\KM\web-editor\src`)

`KmEditorElement` `<km-editor>` (web-component.ts:159, BlissElement, events :143-157). Engine
`EditorEngine` (engine/editor-engine.ts:91).

### Item-like config
| current | fields | file:line | proposed |
|---|---|---|---|
| `CommandItem` | type:'command', command, label, icon?, title? | ui/items.ts:13 | `ActionItem<EditorActionContext>`: `command`→`action`, `label`→`text`, `title`→`tooltip`, + `shortcut` (from `CommandSpec.keys`), isVisible, cssClass, get-callbacks, onClick. **Needs `isActive` / `getIsActiveCallback`** (toggle state) — core addition? |
| `SeparatorItem` | {type:'separator'} | items.ts:25 | `{divider:true}` |
| `ToolbarItem` | union | items.ts:29 | `MenuEntry` |
| `ToolGroup` | id, label?, items | items.ts:92 | group / children |
| `StatusItem` | id, render(state), align?, bar?, title? | items.ts:138 | not an action; render(ctx) |
| item sets | core*/default* | items.ts:39-212 | migrate |
| plugin items | link, image, tables, image-browser | plugins/*.ts | migrate |
| `CommandSpec` | id, run (PM command), keys?, isActive?(state), isEnabled?(state) | engine/command-registry.ts:13 | internal backing action |
| `CommandBarOptions.onRun(command)` | | ui/command-bar.ts:22, 66-72 | internal |

### Contexts
`PluginContext` {schema}, `SetupContext` {schema, view, getState} (engine/plugin.ts:40-45),
`PipelineContext` {doc, extra}, `StageRuntime` {view?, dispatch?, runCommand?, signal, ui,
generation}, `InteractionRequest`/`Result` (pipeline/types.ts).

### Events — BlissElement `emit`; twins :164-166 receive the CustomEvent

| current | detail | emitted | proposed |
|---|---|---|---|
| `change` | `EditorChangeDetail {value, format}` | :227, :275 | `ChangeEventDetail` + controller/element |
| `ready` | undefined | :293 (+ `is-ready`) | `ReadyEventDetail` |
| `mode-change` | `EditorModeChangeDetail {mode}` | :222 | `ModeChangeEventDetail` |
| (missing) `action` | | | toolbar/menu clicks → `action` + `onAction` |

Internal bus (not DOM): change, selectionUpdate (camelCase), transaction, ready, lock, destroy;
`PipelineRegistry.on`.

### Callbacks
Plugin builders `commands`/`keymap`/`pmPlugins(ctx)`, `setup(ctx)` — fine; `destroy()`;
`StatusItem.render(state)` → ctx; `CommandSpec.isActive/isEnabled(state)` → ctx;
`PipelineStage.run(ctx, rt)` (halt ≈ before* false); `InteractionHost.request(req, signal)`;
`ImageBrowserOptions.upload(asset, signal)`. No `*Callback` inputs on the element.

### Facade
Element: getValue, getContent, getHTML, getMarkdown, getJSON, setValue, plugins, **`engine`
getter (leaks)**, isReady, focus, destroy. A controller replaces `el.engine`.

### Tests / docs
unit web-component.test.ts, engine.test.ts, toolbar, plugin, pipeline-assemble; e2e smoke;
README:63-64, 93; CLAUDE.md; PLAN.md; PIPELINES.md; docs/pipelines/extensibility.md;
examples-basic/content/plugins; src/dev/*.

### Drift
Names already fine; detail types `Editor*Detail`; no controller/element; `ready` empty;
`CommandItem` close to ActionItem but needs `isActive`; positional pipeline/plugin callbacks;
raw `EditorState` in predicates; `el.engine` leak.

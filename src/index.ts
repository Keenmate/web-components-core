/**
 * `@keenmate/web-components-core` — public surface. See docs/SPEC.md.
 *
 * Thirteen sections, in the order a component author reaches for them; every value is followed by its
 * own types. Subpaths hold what not every component needs: `/positioning` (floating panels, the only
 * `@floating-ui/dom` importer), `/menu`, `/dialog`, `/actions` (action items + shortcuts — the shortcut
 * guard `isTypingTarget` lives there), `/search`, `/locale`, `/a11y` (keyboard models + the focus trap),
 * `/testing`, `/cem`. One entry point per symbol.
 */

// ── 1. Inputs & converters ─────────────────────────────────────────────────────────────────────────
// The reactive input table (SPEC §4–§5): one InputDef row per input, one converter per row.
export type { AttrReader, Converter, InputDef, Reactivity } from './inputs/types.js';
export {
  toBool,
  toBytes,
  toCssLength,
  toCustom,
  toEnum,
  toFloat,
  toFunction,
  toInt,
  toList,
  toObject,
  toObjectArray,
  toText,
  toValue,
} from './inputs/converters.js';
export type { BoolMode, EnumConverter } from './inputs/converters.js';
export { resolveFromAttribute, resolveFromProperty } from './inputs/apply.js';
export type { Resolved } from './inputs/apply.js';
// The free functions under BlissElement#getEngineConfig() / #clearableConfigKeys (null-clear contract).
export { collectEngineConfig } from './inputs/engine-config.js';
export { deriveClearableKeys, isClearableConverter, isClearableInput } from './inputs/clearable.js';

// ── 2. Element, events, registration ──────────────────────────────────────────────────────────────
export { BlissElement, INPUT_REJECTED_EVENT } from './element/bliss-element.js';
export type { InputRejection } from './element/bliss-element.js';
export { dispatch } from './element/dispatch.js';
export type { DispatchOptions } from './element/dispatch.js';
export type { EventDef, EventMap, NormalizedEventDef } from './element/events.js';
export { define } from './element/define.js';
export { withComponentContext, COMPONENT_CONTEXT_KEYS } from './element/context.js';
export type { ComponentContext, EmitDetail, WithoutComponentContext } from './element/context.js';
export { runBeforeCallback, runBeforeCallbackEager, runBeforeCallbackSync } from './element/before-callback.js';
export type { BeforeCallbackResult } from './element/before-callback.js';
// The public controller: forwarded methods + live state over a lazy engine, frozen (SPEC §12.34).
export { createControllerFacade } from './element/controller-facade.js';
export type { ControllerFacadeSpec } from './element/controller-facade.js';
// Call code core doesn't own (a hook, a listener) without letting it throw through: logged + reported.
export { runSafely, notifyListeners } from './logging/safe-call.js';
export type { SafeCallLog, SafeCallResult } from './logging/safe-call.js';
// Responsive rules (SPEC §6.7): page-wide / per-tag / instance partial configs per device class.
export type { ResponsiveMap, ResponsiveMapAxis, ResponsiveContext, ResponsiveCallback } from './element/responsive.js';
// Global registration (window.components) + live-instance registry (SPEC §12.3).
export { registerComponent } from './global/register-component.js';
export type {
  ComponentConfig,
  ComponentLoggingControls,
  RegisteredComponent,
  RegisterComponentOptions,
  ComponentsRegistry,
} from './global/register-component.js';
export { getInstances, getConnectedTags } from './global/instances.js';

// ── 3. Logging ─────────────────────────────────────────────────────────────────────────────────────
// SPEC §12.1 — the engine is vendored (no `loglevel` dependency); see log-core.ts.
export { createLoggers, DEFAULT_LOG_CATEGORIES, DEFAULT_ENABLED_LOG_LEVEL, DEFAULT_LOG_LEVEL } from './logging/create-loggers.js';
export type { LoggerBundle, Logger, LogLevelDesc, InstanceLogger, InstanceLabel } from './logging/create-loggers.js';
export { getPageLogging } from './logging/global-logging.js';
export type { PageLoggingControls } from './logging/global-logging.js';
export { CORE_LOG_CATEGORIES, getCoreLogging } from './logging/element-logger.js';
export type { CoreLogCategory } from './logging/element-logger.js';
export { setLogPersistKeyPrefix, getLogPersistKeyPrefix, isLogLevel, LOG_LEVELS } from './logging/log-core.js';
export type { LogLevelName } from './logging/log-core.js';
export { createPerfLogger } from './logging/perf-logger.js';
export type { PerfLogger, PerfLoggerOptions } from './logging/perf-logger.js';

// ── 4. Environment (device, viewport, own size, direction) ────────────────────────────────────────
// Device / viewport / orientation detection (SPEC §12.9).
export {
  getEnvironment,
  observeEnvironment,
  observeViewport,
  configureBreakpoints,
  BREAKPOINTS_CHANGE_EVENT,
  classifyDevice,
  TABLET_MIN_SHORT_SIDE,
} from './environment/environment.js';
export type {
  EnvironmentSnapshot,
  EnvironmentListener,
  ObserveEnvironmentOptions,
  PointerAccuracy,
  Orientation,
  OS,
  BreakpointMap,
  DeviceClass,
} from './environment/environment.js';
// Per-element size reactivity (own box, via a shared ResizeObserver) — the element-box companion to
// observeViewport. Prefer CSS container queries when the reflow is presentational; use this for
// structural (JS) reflow.
export { observeElementSize, createElementSizeObserver } from './environment/element-size.js';
export type { ElementSize, ElementSizeListener, ElementSizeObserver, ObserveElementSizeOptions } from './environment/element-size.js';
export { CONTAINER_SIZES, CONTAINER_SIZE_TOKENS, DEFAULT_CONTAINER_LINES, readContainerLines, resolveContainerSize } from './environment/container-size.js';
export type { ContainerSize } from './environment/container-size.js';
// Effective writing direction (computed `direction`, across shadow roots) — feeds directionChanged().
export { isRtl } from './dom/direction.js';

// ── 5. Theme, motion, CSS timing ──────────────────────────────────────────────────────────────────
// Theme context (SPEC §12.10): dark/light detected once per page (or per `theme-source` element) and
// mirrored onto every BlissElement host as `data-context-theme`; `setThemeMode()` forces it globally.
export {
  setThemeMode,
  getThemeMode,
  getThemeContext,
  observeThemeContext,
  readThemeSignal,
  resolveThemeSource,
  THEME_CONTEXT_ATTRIBUTE,
  THEME_SOURCE_ATTRIBUTE,
} from './environment/theme.js';
export type { ColorScheme, ThemeMode, ThemeSource, ThemeListener, ObserveThemeContextOptions } from './environment/theme.js';
// Motion level (SPEC §12.16): `motion` on every BlissElement, window.components.motion, [data-motion].
export {
  adoptMotionStyles,
  getPageMotion,
  observePageMotion,
  MOTION_ATTRIBUTE,
  MOTION_CSS,
  MOTION_DATA_ATTRIBUTE,
  MOTION_PRESETS,
  MOTION_VALUES,
} from './environment/motion.js';
export type { Motion } from './environment/motion.js';
// Resolved CSS in JS (durations, lengths, scroll behavior) + exit animations on the motion tokens.
export { isMotionOff, readScrollBehavior, readCssDurationMs, readCssLengthPx, parseCssTimeMs } from './dom/css-values.js';
export { animateOut, EXIT_HEIGHT_VAR, readAnimationMs } from './dom/animate-out.js';
export type { AnimateOutHandle, AnimateOutOptions } from './dom/animate-out.js';

// ── 6. Styles & rendering ─────────────────────────────────────────────────────────────────────────
// Style injection (SPEC §12.8) + the customStyles input.
export { adoptStyles, createStyleElement } from './dom/adopt-styles.js';
export type { StyleElement, StyleElementOptions } from './dom/adopt-styles.js';
export { createCustomStyles } from './dom/custom-styles.js';
export type { CustomStylesCallback, CustomStylesHandle, CustomStylesOptions, CustomStylesSource } from './dom/custom-styles.js';
// CSS-variable lint (dev tooling, also run on custom styles at runtime).
export { extractConsumedCssVars, extractDeclaredCssVars, suggestCssVars, lintCssVars } from './dom/css-var-lint.js';
export type { CssVarFinding } from './dom/css-var-lint.js';
// One contract for every render*Callback: string = HTML, node, null = default, false = hidden, memo (SPEC §12.35).
export { renderSlot, renderSlotHtml } from './dom/render-slot.js';
export type { RenderSlotOptions, SlotHtml, SlotKind, SlotResult } from './dom/render-slot.js';
// Icons are data (SPEC §12.33): markup raw → built-in name masked → window.components.renderIconCallback →
// icon-font classes <i class> → escaped text.
export { renderIcon, ICON_CSS, BUILT_IN_ICON_NAMES, observeIconHook } from './dom/render-icon.js';
export type { RenderIconOptions, RenderIconCallback, IconRenderContext } from './dom/render-icon.js';
// Shared loader (SPEC §12.14): instance renderLoadingCallback > window.components.renderLoadingCallback > <prefix>__loader span.
export { renderLoader } from './dom/render-loader.js';
export type { LoaderRenderContext, RenderLoadingCallback, RenderLoaderOptions } from './dom/render-loader.js';
export { escapeHtml } from './dom/escape-html.js';

// ── 7. Overlays (non-floating; floating panels → `/positioning`) ─────────────────────────────────
// Stacking tiers (SPEC §12.18): dialogs and phone sheets are the modal tier.
export { Z_INDEX } from './dom/z-index.js';
export type { ZIndexTier } from './dom/z-index.js';
// Overlay / fullscreen presentation primitives (SPEC §12.9) — shared by any component that swaps a
// floating panel for a full-viewport sheet on phones. classifyDevice() owns the shared device
// classification; resolvePresentation() owns the (per-component overridable) class→presentation policy.
export { resolvePresentation, DEFAULT_PRESENTATION_MAP, createPresentationContext } from './overlay/presentation.js';
export type { Presentation, ResolvedPresentation, PresentationMap, PresentationContext } from './overlay/presentation.js';
export { lockBodyScroll } from './overlay/scroll-lock.js';
export { fitToVisibleViewport } from './overlay/keyboard-inset.js';
// The phone Back gesture for a sheet: one history entry while it is open (SPEC §12.9).
export { claimBackEntry } from './overlay/back-entry.js';
export { startSheetSession } from './overlay/sheet-session.js';
export type { SheetSession, SheetSessionOptions } from './overlay/sheet-session.js';
// Modal (inert page + Tab trap) and non-modal panel sessions (SPEC §12.19). The trap alone → `/a11y`.
export { startModalSession } from './overlay/modal-session.js';
export type { ModalDismissReason, ModalSession, ModalSessionOptions } from './overlay/modal-session.js';
export { startPanelSession } from './overlay/panel-session.js';
export type { PanelDismissReason, PanelSession, PanelSessionOptions } from './overlay/panel-session.js';
export { guardGhostClick } from './overlay/ghost-click.js';
export type { GhostClickGuardOptions } from './overlay/ghost-click.js';
// The phone sheet chrome (header + title + close button) every sheet shares (SPEC §12.9).
export { SHEET_CHROME_CSS, createSheetHeader } from './overlay/sheet-chrome.js';
export type { SheetHeaderOptions, SheetHeader } from './overlay/sheet-chrome.js';
// Cross-component "one overlay open at a time" coordination (framework-agnostic via a
// `km-overlay-activate` document event; external code can trigger + observe it too).
export {
  registerOverlay,
  notifyOverlayActivated,
  dismissAllOverlays,
  observeOverlayActivation,
  OVERLAY_ACTIVATE_EVENT,
  ALL_OVERLAY_GROUPS,
} from './overlay/active-overlay.js';
export type { ActivateOverlayOptions, OverlayDismissReason, OverlayHandle, OverlayActivateDetail, RegisterOverlayOptions } from './overlay/active-overlay.js';

// ── 8. Shadow-DOM tree & screen reader ────────────────────────────────────────────────────────────
// The composed tree (across shadow roots): focused element, hit test, closest ancestor, containment.
export { deepActiveElement } from './dom/active-element.js';
export { deepElementFromPoint } from './dom/pointer-drag.js';
export { deepClosest, isDeepInside } from './dom/composed-tree.js';
// Screen-reader announcements through one page-wide live region (SPEC §12.23).
export { announce } from './dom/announce.js';
export type { AnnounceOptions, AnnouncePoliteness } from './dom/announce.js';

// ── 9. Keyboard & text, clipboard ─────────────────────────────────────────────────────────────────
// Typed text, IME-safe: one callback per committed change; the IME's own Enter (SPEC §12.30).
// The shortcut guard `isTypingTarget` is in `/actions` (next to matchesShortcut).
export { observeTextInput, isImeEnter } from './dom/text-input.js';
export type { TextInputElement, TextInputOptions } from './dom/text-input.js';
// Clipboard: copy with a fallback, read a paste event (SPEC §12.32).
export { copyText, readPasteText } from './dom/clipboard.js';
export type { ReadPasteOptions } from './dom/clipboard.js';

// ── 10. Forms, async, persistence ─────────────────────────────────────────────────────────────────
// Form submission through light-DOM hidden inputs (SPEC §12.21).
export { createFormInputs, formatFormValue } from './dom/form-inputs.js';
export type { FormInputs, FormValueFormat, FormatFormValueOptions, FormattedFormValue } from './dom/form-inputs.js';
// Latest-request-wins async runner: debounce, abort, stale drop, delayed loader (SPEC §12.22).
export { createAsyncRunner } from './dom/async-runner.js';
export type { AsyncRunner, AsyncRunnerOptions } from './dom/async-runner.js';
// Persisted UI state (SPEC §12.17): storageKey + load / save callbacks, localStorage by default.
export { createStateStore, getStateStorageKey } from './dom/state-store.js';
export type { LoadStateCallback, SaveStateCallback, StateStore, StateStoreOptions } from './dom/state-store.js';

// ── 11. Scrolling, virtual lists, selection ───────────────────────────────────────────────────────
// Container scroll (SPEC §12.15): scroll the one container around an element, never the page.
export { findScrollContainer, getScrollTopForBox, scrollContainerToBox, scrollIntoContainer } from './dom/scroll-container.js';
export type { FindScrollContainerOptions, ScrollAxis, ScrollBox, ScrollContainerToBoxOptions, ScrollIntoContainerOptions } from './dom/scroll-container.js';
// Scroll positions kept across a DOM move (SPEC §12.31).
export { keepScrollAcrossMove } from './dom/keep-scroll.js';
// Virtual window over fixed-height rows: range math, spacer + window, index jump, hit test (SPEC §12.26).
export { computeVirtualRange, createVirtualWindow } from './dom/virtual-window.js';
export type { VirtualRange, VirtualRangeInput, VirtualRenderContext, VirtualWindow, VirtualWindowOptions } from './dom/virtual-window.js';
// Selection model: click / Ctrl / Shift rules, anchor, ranges in display order (SPEC §12.27).
export { createSelection } from './selection/selection.js';
export type { SelectionModel, SelectionChange, SelectionModelMode, SelectionOptions } from './selection/selection.js';

// ── 12. Pointer drag & page drag ──────────────────────────────────────────────────────────────────
// Page-wide drop-active state for drop targets + pointer drags that work with a finger (SPEC §12.28).
export { observePageDrag, setDropActiveState } from './dom/page-drag.js';
export type { ObservePageDragOptions } from './dom/page-drag.js';
export { createPointerDrag } from './dom/pointer-drag.js';
export type { PointerDrag, PointerDragContext, PointerDragOptions } from './dom/pointer-drag.js';

// ── 13. Scheduling & ids ──────────────────────────────────────────────────────────────────────────
export { createMicrotaskScheduler } from './dom/microtask-scheduler.js';
export type { MicrotaskScheduler } from './dom/microtask-scheduler.js';
export { createThrottle } from './dom/throttle.js';
export type { Throttle } from './dom/throttle.js';
export { createDebounce } from './dom/debounce.js';
export type { Debounce } from './dom/debounce.js';
export { createFrameScheduler } from './dom/frame-scheduler.js';
export type { FrameScheduler } from './dom/frame-scheduler.js';
// Page-unique id for ARIA references / `for`.
export { createId } from './dom/create-id.js';

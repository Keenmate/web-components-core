/** `@keenmate/web-components-core` — public surface. See docs/SPEC.md. */

// Reactive input model
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
export { collectEngineConfig } from './inputs/engine-config.js';
export { deriveClearableKeys, isClearableConverter, isClearableInput } from './inputs/clearable.js';

// Reactive element base
export { BlissElement, INPUT_REJECTED_EVENT } from './element/bliss-element.js';
export type { InputRejection } from './element/bliss-element.js';
export { dispatch } from './element/dispatch.js';
export type { DispatchOptions } from './element/dispatch.js';
export { defaultEventProperty, normalizeEventDefs } from './element/events.js';
export type { EventDef, EventMap, NormalizedEventDef } from './element/events.js';
export { define } from './element/define.js';
export { withComponentContext, COMPONENT_CONTEXT_KEYS } from './element/context.js';
export type { ComponentContext, EmitDetail, WithoutComponentContext } from './element/context.js';
export { runBeforeCallback, runBeforeCallbackEager, runBeforeCallbackSync } from './element/before-callback.js';
export type { BeforeCallbackResult } from './element/before-callback.js';
// Responsive rules (SPEC §6.7): page-wide / per-tag / instance partial configs per device class.
export type { ResponsiveMap, ResponsiveMapAxis, ResponsiveContext, ResponsiveCallback } from './element/responsive.js';

// Global registration (window.components) + live-instance registry (SPEC §12.3)
export { registerComponent } from './global/register-component.js';
export type {
  ComponentConfig,
  ComponentLoggingControls,
  RegisteredComponent,
  RegisterComponentOptions,
  ComponentsRegistry,
} from './global/register-component.js';
export { getInstances, getRegisteredTags } from './global/instances.js';

// Generic DOM utilities
export { resolveEnumAttribute } from './dom/resolve-enum-attribute.js';
export { createMicrotaskScheduler } from './dom/microtask-scheduler.js';
export type { MicrotaskScheduler } from './dom/microtask-scheduler.js';
export { adoptStyles, createStyleSlot } from './dom/adopt-styles.js';
export type { StyleSlot, StyleSlotOptions } from './dom/adopt-styles.js';
// Shared loader (SPEC §12.14): instance renderLoadingCallback > window.components.renderLoadingCallback > <prefix>__loader span.
export { renderLoader, publishLoaderHook } from './dom/render-loader.js';
export type { LoaderRenderContext, RenderLoaderCallback, RenderLoaderOptions } from './dom/render-loader.js';
// Container scroll (SPEC §12.15): scroll the one container around an element, never the page.
export { findScrollContainer, scrollIntoContainer } from './dom/scroll-container.js';
export type { FindScrollContainerOptions, ScrollAxis, ScrollIntoContainerOptions } from './dom/scroll-container.js';
export { extractConsumedCssVars, extractDeclaredCssVars, suggestCssVars, lintCssVars } from './dom/css-var-lint.js';
export type { CssVarFinding } from './dom/css-var-lint.js';

// Device / viewport / orientation detection (SPEC §12.9)
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
  PointerType,
  Orientation,
  OS,
  BreakpointMap,
  DeviceClass,
} from './environment/environment.js';
// Per-element size reactivity (own box, via a shared ResizeObserver) — the
// element-box companion to observeViewport. Prefer CSS container queries when
// the reflow is presentational; use this for structural (JS) reflow.
export { observeElementSize } from './environment/element-size.js';
export type { ElementSize, ElementSizeListener, ObserveElementSizeOptions } from './environment/element-size.js';
// Theme context (SPEC §12.10): dark/light detected once per page (or per
// `theme-source` element) and mirrored onto every BlissElement host as
// `data-context-theme`; `setThemeMode()` forces it globally.
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

// Overlay / fullscreen presentation primitives (SPEC §12.9) — shared by any
// component that swaps a floating panel for a full-viewport sheet on phones.
// classifyDevice() owns the shared device classification; resolvePresentation()
// owns the (per-component overridable) class→presentation policy.
export { resolvePresentation, DEFAULT_PRESENTATION_MAP, createPresentationContext } from './overlay/presentation.js';
export type { Presentation, ResolvedPresentation, PresentationMap, PresentationContext } from './overlay/presentation.js';
export { lockBodyScroll, type ScrollLockState } from './overlay/scroll-lock.js';
export { observeKeyboardInset } from './overlay/keyboard-inset.js';
// Cross-component "one overlay open at a time" coordination (framework-agnostic via a
// `km-overlay-activate` document event; external code can trigger + observe it too).
export {
  registerOverlay,
  notifyOverlayActivated,
  dismissAllOverlays,
  onOverlayActivated,
  OVERLAY_ACTIVATE_EVENT,
  ALL_GROUPS,
} from './overlay/active-overlay.js';
export type { ActivateOverlayOptions, OverlayDismissReason, OverlayHandle, OverlayActivateDetail, RegisterOverlayOptions } from './overlay/active-overlay.js';

// Logging (SPEC §12.1) — engine is vendored (no `loglevel` dependency); see log-core.ts.
export { createLoggers, DEFAULT_CATEGORIES, DEFAULT_ENABLED_LEVEL, DEFAULT_LOG_LEVEL } from './logging/create-loggers.js';
export type { LoggerBundle, Logger, LogLevelDesc, InstanceLogger, InstanceLabel } from './logging/create-loggers.js';
export { getGlobalLogging } from './logging/global-logging.js';
export type { GlobalLoggingControls } from './logging/global-logging.js';
export { coreLogging, CORE_LOG_CATEGORIES, getCoreLogging } from './logging/element-logger.js';
export type { CoreLogCategory } from './logging/element-logger.js';
export { setLogPersistKeyPrefix, getLogPersistKeyPrefix, isLogLevel, toLogLevelNumber, LOG_LEVELS } from './logging/log-core.js';
export type { LogLevelName } from './logging/log-core.js';
export { createPerfLogger } from './logging/perf-logger.js';
export type { PerfLogger } from './logging/perf-logger.js';

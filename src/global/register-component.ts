/**
 * `registerComponent` — the one place a KeenMate component publishes itself to
 * the `window.components` global (SPEC §12.3). It replaces the block every
 * shipping component copy-pasted (and drifted): it defines the custom element,
 * exposes build metadata + logging controls, and wires `getInstances()` to the
 * live-instance registry `BlissElement` maintains automatically.
 *
 * ```ts
 * registerComponent('web-multiselect', WebMultiSelectElement, {
 *   config: { name: __PACKAGE_NAME__, version: __VERSION__, author: __AUTHOR__ },
 *   logging,               // the LoggerBundle from createLoggers()
 * });
 * // -> window.components['web-multiselect'] = { version, config, logging, register, getInstances }
 * ```
 */
import { define } from '../element/define.js';
import type { LoggerBundle, LogLevelDesc } from '../logging/create-loggers.js';
import { attachLoggerBundle } from '../logging/logger-registry.js';
import { publishGlobalLogging, type GlobalLoggingControls } from '../logging/global-logging.js';
import { publishLoaderHook, type RenderLoaderCallback } from '../dom/render-loader.js';
import { getInstances } from './instances.js';

/** Build/package metadata surfaced for runtime introspection. Extra keys are allowed. */
export interface ComponentConfig {
  name: string;
  version: string;
  author?: string;
  license?: string;
  repository?: string;
  homepage?: string;
  /** The core package this component was built against, when it wants to surface it. */
  core?: { name: string; version: string };
  [key: string]: unknown;
}

/** The logging controls exposed on the global — a flattened view of a {@link LoggerBundle}. */
export interface ComponentLoggingControls {
  enableLogging(level?: LogLevelDesc): void;
  disableLogging(): void;
  setLogLevel(level: LogLevelDesc): void;
  /** Bare (`'DATA'`) or namespaced as it prints (`'GRID:DATA'`). */
  setCategoryLevel(category: string, level: LogLevelDesc): void;
  getCategories(): string[];
}

/** One `window.components[tag]` entry. */
export interface RegisteredComponent<T extends HTMLElement = HTMLElement> {
  /** The component's build version (shortcut for `config.version`). */
  version(): string;
  config: ComponentConfig;
  logging?: ComponentLoggingControls;
  /** Idempotently define the custom element. Called for you unless `shouldAutoDefine: false`. */
  register(): void;
  /** The live, connected instances of this tag — the per-instance handles. */
  getInstances(): T[];
}

export interface RegisterComponentOptions {
  config: ComponentConfig;
  /** The `createLoggers()` bundle; its controls are exposed under `logging`. */
  logging?: LoggerBundle<string>;
  /** Define the element on registration (default `true`); `register()` stays available regardless. */
  shouldAutoDefine?: boolean;
}

/**
 * `window.components`: one entry per component tag, plus the NON-enumerable
 * page-wide `logging` switch (every bundle — components + CORE) and the
 * NON-enumerable page-wide `renderLoaderCallback` hook (SPEC §12.14). Tag names
 * always contain a hyphen, so neither can clash, and enumerating the object
 * still yields tags only.
 */
export type ComponentsRegistry = Record<string, RegisteredComponent | undefined> & {
  readonly logging?: GlobalLoggingControls;
  /** Page-wide loader look: draws every component's loading states unless an instance `renderLoadingCallback` is set. */
  renderLoaderCallback?: RenderLoaderCallback;
};

declare global {
  interface Window {
    /** Registry of KeenMate web components, keyed by tag name (+ the non-enumerable `logging` switch). */
    components?: ComponentsRegistry;
  }
}

function flattenLogging(bundle: LoggerBundle<string>): ComponentLoggingControls {
  return {
    enableLogging: (level) => bundle.enableLogging(level),
    disableLogging: () => bundle.disableLogging(),
    setLogLevel: (level) => bundle.setLogLevel(level),
    setCategoryLevel: (category, level) => bundle.setCategoryLevel(category, level),
    getCategories: () => [...bundle.LOGGING_CATEGORIES],
  };
}

/**
 * Publish `elementClass` under `tagName` on `window.components` and (by default)
 * define the custom element. Returns the registry entry. SSR-safe: the global
 * write is skipped when `window` is absent, and `define()` no-ops without
 * `customElements`.
 */
export function registerComponent<T extends HTMLElement = HTMLElement>(
  tagName: string,
  elementClass: CustomElementConstructor,
  options: RegisterComponentOptions,
): RegisteredComponent<T> {
  const { config, logging, shouldAutoDefine = true } = options;
  // Make the bundle discoverable by tag so BlissElement can build per-instance
  // loggers (this.log) for elements of this tag (SPEC §12.3).
  if (logging) attachLoggerBundle(tagName, logging);
  const entry: RegisteredComponent<T> = {
    version: () => config.version,
    config,
    ...(logging ? { logging: flattenLogging(logging) } : {}),
    register: () => define(tagName, elementClass),
    getInstances: () => getInstances<T>(tagName),
  };
  if (typeof window !== 'undefined') {
    (window.components ??= {})[tagName] = entry as RegisteredComponent;
    publishGlobalLogging(); // re-publish if the page replaced window.components
    publishLoaderHook();
  }
  if (shouldAutoDefine) define(tagName, elementClass);
  return entry;
}

/**
 * Custom CSS for a component, page-wide per tag and per instance (SPEC §12.8).
 *
 * ```js
 * // every <web-daterangepicker> on the page — one file, fetched once
 * window.components['web-daterangepicker'].customStyles = "@import url('/css/drp-days.css');";
 * // or computed per instance from its context
 * window.components['web-daterangepicker'].getCustomStylesCallback = (ctx) => '…';
 * ```
 *
 * Two `<style>` slots in the component's shadow root: the PAGE layer (the tag's
 * `getCustomStylesCallback`, else its `customStyles`) and, after it, the INSTANCE
 * layer (the same pair on the element — its callback, else its `custom-styles`), so an
 * instance overrides the shared rules. `<style>` on purpose: user CSS may `@import`,
 * which constructable sheets reject. Assigning a page value updates every live
 * instance of the tag (detached ones too — their shadow root keeps the CSS).
 */
import { coreLog } from '../logging/element-logger.js';
import { sharedState, sharedStateKey } from '../global/shared-state.js';
import { createStyleSlot, type StyleSlot } from './adopt-styles.js';

/** Returns the CSS for one layer; `null` / `undefined` / `''` = none. */
export type CustomStylesCallback<Ctx = any> = (ctx: Ctx) => string | null | undefined;

/** One layer's inputs: the callback wins when it is a function. */
export interface CustomStylesSource<Ctx = any> {
  css?: string | null;
  callback?: CustomStylesCallback<Ctx> | null;
}

/** Options for {@link createCustomStyles}. */
export interface CustomStylesOptions<Ctx = any> {
  /** The context both callbacks (page and instance) receive — the component's own (`PickerContext`, …). */
  getContext: () => Ctx;
  /** The instance layer, read on every refresh (usually `this.config.customStyles` / `.getCustomStylesCallback`). */
  getInstanceStyles: () => CustomStylesSource<Ctx>;
  /** Class of the instance `<style>`; the page one gets `<cssClass>--page`. Default `custom-styles`. */
  cssClass?: string;
  /** Where both slots sit in the root (page slot always before the instance slot). Default `'last'`. */
  position?: 'first' | 'last';
  /** Called with each non-empty CSS string applied (e.g. a dev-only variable-name lint). */
  onApply?: (css: string, layer: 'page' | 'instance') => void;
}

/** The handle a component keeps (see {@link createCustomStyles}). */
export interface CustomStylesHandle {
  /** Re-resolve both layers and write them. Call after the instance inputs change. */
  refresh(): void;
  /** Remove both `<style>` elements and stop following the page layer. */
  destroy(): void;
}

interface TagStyles {
  css?: string;
  callback?: CustomStylesCallback;
}

interface PageStylesState {
  /** Per tag: the live handles, held weakly (an element dropped without destroy() is still collectable). */
  listeners: Map<string, Set<WeakRef<CustomStylesHandle>>>;
}

function state(): PageStylesState {
  return sharedState(sharedStateKey('custom-styles'), () => ({ listeners: new Map() }));
}

/** Re-run every live handle of `tag` (its page layer changed). */
function notifyTag(tag: string): void {
  const refs = state().listeners.get(tag);
  if (!refs) return;
  for (const ref of [...refs]) {
    const handle = ref.deref();
    if (!handle) {
      refs.delete(ref);
      continue;
    }
    handle.refresh();
  }
}

const CSS_KEY = 'customStyles';
const CALLBACK_KEY = 'getCustomStylesCallback';

/**
 * Install `customStyles` / `getCustomStylesCallback` accessors on a
 * `window.components[tag]` entry (enumerable, like the entry's other members),
 * adopting values the page set on a pre-existing entry. A wrong type warns and keeps
 * the previous value. Called by `registerComponent()`.
 */
export function installTagStyleHooks(entry: object, tag: string): void {
  const store: TagStyles = {};
  const label = `window.components['${tag}']`;
  const adopt = (key: string): { had: boolean; value: unknown } => {
    const d = Object.getOwnPropertyDescriptor(entry, key);
    if (!d) return { had: false, value: undefined };
    return { had: true, value: d.get ? d.get.call(entry) : d.value };
  };
  const preCss = adopt(CSS_KEY);
  const preCallback = adopt(CALLBACK_KEY);
  const setCss = (value: unknown): void => {
    if (value != null && typeof value !== 'string') {
      coreLog(undefined, 'UI', 'THEME').warn(`${label}.customStyles must be a CSS string or null; keeping previous value`, value);
      return;
    }
    store.css = value || undefined;
    notifyTag(tag);
  };
  const setCallback = (value: unknown): void => {
    if (value != null && typeof value !== 'function') {
      coreLog(undefined, 'UI', 'THEME').warn(`${label}.getCustomStylesCallback must be a function or null; keeping previous value`, value);
      return;
    }
    store.callback = (value as CustomStylesCallback | null) ?? undefined;
    notifyTag(tag);
  };
  Object.defineProperty(entry, CSS_KEY, { enumerable: true, configurable: true, get: () => store.css, set: setCss });
  Object.defineProperty(entry, CALLBACK_KEY, { enumerable: true, configurable: true, get: () => store.callback, set: setCallback });
  if (preCss.had) setCss(preCss.value);
  if (preCallback.had) setCallback(preCallback.value);
}

/** The tag's page layer (empty under SSR / before registration). */
function readTagStyles(tag: string): CustomStylesSource {
  if (typeof window === 'undefined') return {};
  const entry = (window.components as Record<string, unknown> | undefined)?.[tag] as Record<string, unknown> | undefined;
  if (!entry || typeof entry !== 'object') return {};
  const css = entry[CSS_KEY];
  const callback = entry[CALLBACK_KEY];
  return {
    css: typeof css === 'string' ? css : null,
    callback: typeof callback === 'function' ? (callback as CustomStylesCallback) : null,
  };
}

/**
 * Manage a component's custom CSS: the page layer for `host`'s tag
 * (`window.components[tag].getCustomStylesCallback` / `.customStyles`) and the
 * instance layer from `getInstanceStyles()`, each in its own `<style>` slot in
 * `root`, page first. Writes both now; follows page changes until `destroy()`.
 * A throwing callback is logged and leaves that layer empty.
 */
export function createCustomStyles<Ctx = any>(
  host: HTMLElement,
  root: ShadowRoot | HTMLElement,
  opts: CustomStylesOptions<Ctx>,
): CustomStylesHandle {
  const tag = host.localName;
  const cssClass = opts.cssClass ?? 'custom-styles';
  const position = opts.position ?? 'last';
  let page: StyleSlot | null = createStyleSlot(root, { position, cssClass: `${cssClass}--page` });
  let instance: StyleSlot | null = createStyleSlot(root, { position, cssClass });

  const resolve = (source: CustomStylesSource<Ctx>, layer: 'page' | 'instance'): string | null => {
    if (typeof source.callback === 'function') {
      try {
        return source.callback(opts.getContext()) || null;
      } catch (error) {
        const where = layer === 'page' ? `window.components['${tag}'].getCustomStylesCallback` : 'getCustomStylesCallback';
        coreLog(host, 'UI', 'THEME').warn(`${where} threw; that layer stays empty`, error);
        return null;
      }
    }
    return source.css || null;
  };

  /** The page `<style>` must precede the instance one, whichever was inserted first. */
  const order = (): void => {
    const pageEl = page?.element;
    const instanceEl = instance?.element;
    if (pageEl && instanceEl && pageEl.compareDocumentPosition(instanceEl) & Node.DOCUMENT_POSITION_PRECEDING) {
      instanceEl.before(pageEl);
    }
  };

  const handle: CustomStylesHandle = {
    refresh() {
      if (!page || !instance) return;
      const pageCss = resolve(readTagStyles(tag), 'page');
      const instanceCss = resolve(opts.getInstanceStyles(), 'instance');
      page.set(pageCss);
      instance.set(instanceCss);
      order();
      if (pageCss) opts.onApply?.(pageCss, 'page');
      if (instanceCss) opts.onApply?.(instanceCss, 'instance');
    },
    destroy() {
      page?.destroy();
      instance?.destroy();
      page = instance = null;
      state().listeners.get(tag)?.delete(ref);
    },
  };
  const ref = new WeakRef(handle);
  const listeners = state().listeners;
  if (!listeners.has(tag)) listeners.set(tag, new Set());
  listeners.get(tag)!.add(ref);
  handle.refresh();
  return handle;
}

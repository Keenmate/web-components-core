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
 *
 * Fonts: Chromium ignores `@font-face` inside a shadow root, so an `@import`ed icon font
 * (FontAwesome from a CDN) would draw boxes. Each `@import` URL is therefore also linked
 * once in the document `<head>` (`shouldHoistImports`, default on; shadow roots only),
 * shared by every instance and removed when the last one stops using it. The imported
 * sheet's rules then also reach the page.
 */
import { coreLog } from '../logging/element-logger.js';
import { sharedState, sharedStateKey } from '../global/shared-state.js';
import { createStyleSlot, type StyleSlot } from './adopt-styles.js';
import { publishPageSetting } from '../global/page-setting.js';
import { watchRemoval } from '../element/removal-watch.js';

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
  /**
   * Also link each `@import` URL in the document `<head>`, so an imported `@font-face` (an
   * icon font) registers — Chromium ignores it inside a shadow root. Shared and ref-counted
   * across instances; a `<link>` the page already has is reused, never removed. Only when
   * `root` is a ShadowRoot. Default `true`. The page wins: `window.components[tag].shouldHoistImports`,
   * else `window.components.shouldHoistImports` (a page that loads its fonts itself sets `false`).
   */
  shouldHoistImports?: boolean;
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
  shouldHoistImports?: boolean;
}

interface PageStylesState {
  /** Per tag: the live handles, held weakly (an element dropped without destroy() is still collectable). */
  listeners: Map<string, Set<WeakRef<CustomStylesHandle>>>;
  /** Hosts that apply custom CSS through {@link createCustomStyles}. */
  hosts?: WeakSet<Element>;
  /** Tags already warned about a page layer they never apply. */
  warnedTags?: Set<string>;
  /** Page-wide `window.components.shouldHoistImports`; `undefined` = not set. */
  shouldHoistImports?: boolean;
}

function state(): PageStylesState {
  return sharedState(sharedStateKey('custom-styles'), (): PageStylesState => ({ listeners: new Map() }));
}

const HOIST_KEY = 'shouldHoistImports';

/** Publish `window.components.shouldHoistImports` (non-enumerable; adopts a value set before core loaded). */
function publishHoistSetting(): void {
  publishPageSetting(HOIST_KEY, {
    get: () => state().shouldHoistImports,
    set: (value: unknown) => {
      if (value != null && typeof value !== 'boolean') {
        coreLog(undefined, 'UI', 'THEME').warn('window.components.shouldHoistImports must be a boolean or null; keeping previous value', value);
        return;
      }
      state().shouldHoistImports = (value as boolean | null) ?? undefined;
      for (const tag of state().listeners.keys()) notifyTag(tag);
    },
  });
}

/** What core added to a document's head for `@import`s: statement key → element + how many handles use it. */
type HoistedImports = WeakMap<Document, Map<string, { element: HTMLElement; count: number }>>;

const hoisted = (): HoistedImports => sharedState(sharedStateKey('custom-styles-imports'), (): HoistedImports => new WeakMap());

/** One leading `@import`: its URL (`url(…)` or a string), then its conditions (`layer()`, `supports()`, media). */
const IMPORT_RE = /^@import\s+(?:url\(\s*(['"]?)([^'")\s]+)\1\s*\)|(['"])([^'"]+)\3)([^;]*);/i;
/** Statements allowed before an `@import` (`@charset`, a `@layer a, b;` declaration). */
const PRELUDE_RE = /^@(?:charset\s+"[^"]*"|layer\s+[\w\s,.-]+);/i;

/** A hoisted `@import`: the absolute URL, its conditions and the statement written to the head. */
export interface HoistedImport {
  href: string;
  conditions: string;
  statement: string;
}

/**
 * The `@import`s a CSS string really loads: only the leading ones (the browser ignores an
 * `@import` after another rule), comments skipped, URLs resolved against the document's base
 * URL, conditions (`layer()`, `supports()`, media) kept.
 */
export function importStatements(css: string, doc: Document): HoistedImport[] {
  const out = new Map<string, HoistedImport>();
  let rest = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (;;) {
    rest = rest.trimStart();
    const prelude = PRELUDE_RE.exec(rest);
    if (prelude) {
      rest = rest.slice(prelude[0].length);
      continue;
    }
    const m = IMPORT_RE.exec(rest);
    if (!m) break;
    rest = rest.slice(m[0].length);
    const raw = m[2] ?? m[4];
    if (!raw) continue;
    let href: string;
    try {
      href = new URL(raw, doc.baseURI).href;
    } catch {
      continue; // not a URL — the browser ignores that @import too
    }
    const conditions = (m[5] ?? '').trim().replace(/\s+/g, ' ');
    const statement = `@import url(${JSON.stringify(href)})${conditions ? ` ${conditions}` : ''};`;
    out.set(statement, { href, conditions, statement });
  }
  return [...out.values()];
}

/**
 * Use (add if needed) one import in `doc`'s head: a plain one as a `<link>` (or the page's own
 * `<link>` for that URL, reused), a conditional one as a `<style>` holding the statement, so its
 * layer / media / supports still apply.
 */
function acquireImport(doc: Document, imp: HoistedImport): void {
  const map = hoisted();
  let held = map.get(doc);
  if (!held) map.set(doc, (held = new Map()));
  const entry = held.get(imp.statement);
  if (entry) {
    entry.count++;
    return;
  }
  let element: HTMLElement;
  if (imp.conditions) {
    const style = doc.createElement('style');
    style.textContent = imp.statement;
    element = style;
  } else {
    const own = [...doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')].some((l) => l.href === imp.href && !l.hasAttribute('data-km-custom-styles'));
    if (own) return; // the page links it itself: nothing to add or remove
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = imp.href;
    element = link;
  }
  element.setAttribute('data-km-custom-styles', '');
  doc.head.append(element);
  held.set(imp.statement, { element, count: 1 });
}

/** Stop using one import; the last user removes what core added. */
function releaseImport(doc: Document, statement: string): void {
  const held = hoisted().get(doc);
  const entry = held?.get(statement);
  if (!entry) return;
  if (--entry.count > 0) return;
  entry.element.remove();
  held!.delete(statement);
}

/**
 * Warn once per tag when the page set `window.components[tag].customStyles` /
 * `.getCustomStylesCallback` but this built element doesn't apply custom CSS through
 * {@link createCustomStyles} (the value would silently do nothing). BlissElement calls it at
 * `ready`; a page assignment checks the live instances.
 */
export function warnUnusedPageStyles(host: Element): void {
  if (typeof window === 'undefined') return;
  const tag = host.localName;
  const { css, callback } = readTagStyles(tag);
  if (!css && !callback) return;
  const st = state();
  if (st.hosts?.has(host) || st.warnedTags?.has(tag)) return;
  (st.warnedTags ??= new Set()).add(tag);
  coreLog(host as HTMLElement, 'UI', 'THEME').warn(
    `window.components['${tag}'].customStyles / getCustomStylesCallback is set, but <${tag}> doesn't apply page-wide custom CSS (it doesn't use createCustomStyles()) — the value has no effect`,
  );
}

/** A page assignment for `tag`: warn when its live instances never apply it. */
function checkLiveInstances(tag: string): void {
  if (state().listeners.get(tag)?.size) return;
  const entry = (window.components as Record<string, unknown> | undefined)?.[tag] as { getInstances?: () => readonly Element[] } | undefined;
  const first = entry?.getInstances?.()[0];
  if (first) warnUnusedPageStyles(first);
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
const TAG_HOIST_KEY = 'shouldHoistImports';

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
  const preHoist = adopt(TAG_HOIST_KEY);
  const setCss = (value: unknown): void => {
    if (value != null && typeof value !== 'string') {
      coreLog(undefined, 'UI', 'THEME').warn(`${label}.customStyles must be a CSS string or null; keeping previous value`, value);
      return;
    }
    store.css = value || undefined;
    notifyTag(tag);
    checkLiveInstances(tag);
  };
  const setCallback = (value: unknown): void => {
    if (value != null && typeof value !== 'function') {
      coreLog(undefined, 'UI', 'THEME').warn(`${label}.getCustomStylesCallback must be a function or null; keeping previous value`, value);
      return;
    }
    store.callback = (value as CustomStylesCallback | null) ?? undefined;
    notifyTag(tag);
    checkLiveInstances(tag);
  };
  const setHoist = (value: unknown): void => {
    if (value != null && typeof value !== 'boolean') {
      coreLog(undefined, 'UI', 'THEME').warn(`${label}.shouldHoistImports must be a boolean or null; keeping previous value`, value);
      return;
    }
    store.shouldHoistImports = (value as boolean | null) ?? undefined;
    notifyTag(tag);
  };
  Object.defineProperty(entry, CSS_KEY, { enumerable: true, configurable: true, get: () => store.css, set: setCss });
  Object.defineProperty(entry, TAG_HOIST_KEY, { enumerable: true, configurable: true, get: () => store.shouldHoistImports, set: setHoist });
  Object.defineProperty(entry, CALLBACK_KEY, { enumerable: true, configurable: true, get: () => store.callback, set: setCallback });
  if (preCss.had) setCss(preCss.value);
  if (preCallback.had) setCallback(preCallback.value);
  if (preHoist.had) setHoist(preHoist.value);
  publishHoistSetting();
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

/** Is `@import` hoisting on for `tag`? The tag's page value, else the page-wide one, else the component's option. */
function isHoistOn(tag: string, componentDefault: boolean): boolean {
  if (typeof window === 'undefined') return false;
  const entry = (window.components as Record<string, unknown> | undefined)?.[tag] as Record<string, unknown> | undefined;
  const forTag = entry && typeof entry === 'object' ? entry[TAG_HOIST_KEY] : undefined;
  if (typeof forTag === 'boolean') return forTag;
  const forPage = state().shouldHoistImports;
  if (typeof forPage === 'boolean') return forPage;
  return componentDefault;
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
  publishHoistSetting();
  const doc = typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot ? root.ownerDocument : null;
  /** Removed from the page (core's removal check): hold no imports until it returns. */
  let isRemoved = false;
  /** The `@import` statements this handle holds in the document head. */
  let imports: string[] = [];
  /** Each layer is its own sheet: its leading `@import`s count, the union is held. */
  const syncImports = (layers: readonly (string | null)[]): void => {
    if (!doc?.head) return;
    if (isRemoved || !isHoistOn(tag, opts.shouldHoistImports !== false)) layers = [];
    const next = [...new Map(layers.flatMap((css) => (css ? importStatements(css, doc) : [])).map((i) => [i.statement, i])).values()];
    const keys = next.map((i) => i.statement);
    for (const imp of next) if (!imports.includes(imp.statement)) acquireImport(doc, imp);
    for (const key of imports) if (!keys.includes(key)) releaseImport(doc, key);
    imports = keys;
  };

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
      syncImports([pageCss, instanceCss]);
      if (pageCss) opts.onApply?.(pageCss, 'page');
      if (instanceCss) opts.onApply?.(instanceCss, 'instance');
    },
    destroy() {
      unwatch();
      syncImports([]);
      page?.destroy();
      instance?.destroy();
      page = instance = null;
      state().listeners.get(tag)?.delete(ref);
    },
  };
  (state().hosts ??= new WeakSet()).add(host);
  const unwatch = watchRemoval(host, {
    onRemoved() {
      isRemoved = true;
      handle.refresh();
    },
    onReturned() {
      isRemoved = false;
      handle.refresh();
    },
  });
  const ref = new WeakRef(handle);
  const listeners = state().listeners;
  if (!listeners.has(tag)) listeners.set(tag, new Set());
  listeners.get(tag)!.add(ref);
  handle.refresh();
  return handle;
}

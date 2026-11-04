/**
 * Shared loader (SPEC §12.14) — the one way every component draws a loading
 * state (tree `isLoading` overlay, grid infinite-scroll row, async search,
 * upload, summary, …), so the page can change the look in ONE place.
 *
 * Precedence, highest first:
 * 1. the instance `renderLoadingCallback` (same name in every component);
 * 2. the page-wide `window.components.renderLoadingCallback`;
 * 3. the default `<span class="<prefix>-loader">`, drawn by the component's CSS
 *    from its `--<prefix>-loader-*` tokens (chained to `--base-loader-*`).
 *
 * The container always gets `role="status"` + `aria-label` (the component's
 * `labels.loading` / `labels.searching`, …). Core ships no loader CSS — each
 * component copies the drawing rule (SPEC §12.14) into its own stylesheet.
 */
import { sharedState } from '../global/shared-state.js';
import { publishPageSetting } from '../global/page-setting.js';
import { coreLog } from '../logging/element-logger.js';

/** What a loader render hook receives. */
export interface LoaderRenderContext {
  /** The component's tag name, lowercase (`'web-tree-view'`). */
  component: string;
  /** Which loading state, per component: `'overlay' | 'row' | 'search' | 'upload' | 'summary' | …`. */
  context: string;
  /** The element to fill. Already carries `role="status"` + `aria-label`. */
  containerElement: HTMLElement;
  /** The component host. */
  element: HTMLElement;
  /** The accessible label set on the container (the component's localized loading text). */
  label: string;
}

/**
 * A loader render hook — the instance `renderLoadingCallback` and the page-wide
 * `window.components.renderLoadingCallback` share this shape. Fill
 * `containerElement`; optionally return a cleanup run when the loader is removed
 * (stop timers / animations). Nodes the hook appended before returning are removed for you;
 * nodes it appends later (asynchronously) are its cleanup's job.
 */
export type RenderLoaderCallback = (ctx: LoaderRenderContext) => void | (() => void);

export interface RenderLoaderOptions {
  /** Accessible label for the container (`aria-label`); empty → no `aria-label`. */
  label: string;
  /** Component CSS prefix — the default element is `<span class="<prefix>-loader">`. */
  prefix: string;
  /**
   * The instance hook. Omitted → read from `host.renderLoadingCallback` (the
   * generated BlissElement property); pass it explicitly when the component
   * keeps it elsewhere (a config object). `null` / `undefined` → no instance hook.
   */
  renderLoadingCallback?: RenderLoaderCallback | null;
}

// ---------------------------------------------------------------------------
// Page-wide hook: window.components.renderLoadingCallback (non-enumerable)
// ---------------------------------------------------------------------------

interface LoaderHookState {
  callback: RenderLoaderCallback | undefined;
}

/** On globalThis because each component bundles its own core copy (like logging). */
const STATE_KEY = '@keenmate/web-components-core:loader';
const HOOK_KEY = 'renderLoadingCallback';

function state(): LoaderHookState {
  return sharedState(STATE_KEY, () => ({ callback: undefined }));
}

/**
 * Publish `window.components.renderLoadingCallback` as a NON-enumerable accessor,
 * so enumerating `window.components` still yields component tags only. A value
 * the page assigned earlier as a plain property is adopted. Idempotent;
 * SSR-safe. Called by `registerComponent()` and `renderLoader()`.
 */
export function publishLoaderHook(): void {
  const s = state();
  publishPageSetting(HOOK_KEY, {
    get: () => s.callback,
    set: (value: unknown) => {
      s.callback = typeof value === 'function' ? (value as RenderLoaderCallback) : undefined;
    },
  });
}

function pageHook(): RenderLoaderCallback | undefined {
  publishLoaderHook();
  const cb = typeof window !== 'undefined' ? window.components?.renderLoadingCallback : state().callback;
  return typeof cb === 'function' ? cb : undefined;
}

// ---------------------------------------------------------------------------
// renderLoader
// ---------------------------------------------------------------------------

function restoreAttribute(el: HTMLElement, name: string, previous: string | null): void {
  if (previous === null) el.removeAttribute(name);
  else el.setAttribute(name, previous);
}

/**
 * Draw a loading state into `containerElement` and return a remove function
 * (idempotent): it runs the hook's cleanup, removes the nodes the render added
 * and restores the container's previous `role` / `aria-label`.
 *
 * A hook that throws is logged (`UI` category of the host's logger) and the
 * default loader is drawn instead — a loading state is never left blank.
 *
 * ```ts
 * this._removeLoader = renderLoader(this, overlayEl, 'overlay', {
 *   prefix: 'wtv', label: this.labels.loading,
 * });
 * // later
 * this._removeLoader?.();
 * ```
 */
export function renderLoader(
  host: HTMLElement,
  containerElement: HTMLElement,
  context: string,
  options: RenderLoaderOptions,
): () => void {
  const { label, prefix } = options;
  const prevRole = containerElement.getAttribute('role');
  const prevLabel = containerElement.getAttribute('aria-label');
  containerElement.setAttribute('role', 'status');
  if (label) containerElement.setAttribute('aria-label', label);
  else containerElement.removeAttribute('aria-label');

  const before = new Set<Node>(Array.from(containerElement.childNodes));
  const added = (): Node[] => Array.from(containerElement.childNodes).filter((n) => !before.has(n));
  const discard = (nodes: Node[]): void => {
    for (const node of nodes) node.parentNode?.removeChild(node);
  };

  const instanceHook =
    'renderLoadingCallback' in options
      ? options.renderLoadingCallback
      : (host as unknown as { renderLoadingCallback?: unknown }).renderLoadingCallback;

  let cleanup: (() => void) | undefined;
  let isDrawn = false;
  const hooks = [
    { cb: typeof instanceHook === 'function' ? (instanceHook as RenderLoaderCallback) : undefined, name: 'renderLoadingCallback' },
    { cb: pageHook(), name: 'window.components.renderLoadingCallback' },
  ];
  for (const { cb, name } of hooks) {
    if (!cb) continue;
    try {
      const result = cb({ component: host.localName, context, containerElement, element: host, label });
      if (typeof result === 'function') cleanup = result;
      isDrawn = true;
    } catch (error) {
      coreLog(host, 'UI', 'ELEMENT').error(`${name} threw — drawing the default loader`, error);
      discard(added());
    }
    break; // the highest-precedence hook decides; a throwing one falls back to the default
  }
  if (!isDrawn) {
    const doc = containerElement.ownerDocument;
    const span = doc.createElement('span');
    span.className = `${prefix}-loader`;
    span.setAttribute('aria-hidden', 'true');
    containerElement.appendChild(span);
  }
  // What THIS render added, recorded now: nodes the component (or another loader) appends
  // to the container later are not ours to remove. A hook that appends later (async)
  // removes those in its cleanup.
  const owned = added();

  let isRemoved = false;
  return () => {
    if (isRemoved) return;
    isRemoved = true;
    try {
      cleanup?.();
    } catch (error) {
      coreLog(host, 'UI', 'ELEMENT').error('loader cleanup threw', error);
    }
    discard(owned);
    restoreAttribute(containerElement, 'role', prevRole);
    restoreAttribute(containerElement, 'aria-label', prevLabel);
  };
}

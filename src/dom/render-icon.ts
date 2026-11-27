/**
 * Icons are DATA (SPEC §12.33): the page hands a component a string, and every component turned it into markup
 * its own way (web-commandpalette's `renderIcon`, `/menu`'s raw `innerHTML`, web-grid / web-treeview / web-
 * multiselect each their own). One rule, keen-pure-admin's icon resolution plus two steps for string data —
 * first match wins:
 *
 * 1. starts with `<` (an `<svg>`, an `<img>`, an `<i class="fa …">`) → inserted raw — the page vouches for it;
 * 2. the element's own `icons` map (`el.icons[name]`);
 * 3. the page-wide flat `window.components.icons` map (`'<tag>.<name>'` before `'<name>'`);
 * 4. a built-in name ({@link BUILT_IN_ICON_NAMES}: `close`, `chevron`, `check`, …) → `<span class="km-icon
 *    <prefix>__icon <prefix>__icon--close">`, a glyph masked from the `--base-icon-<name>` token in `currentColor`
 *    (unset: the base-css-variables default `ICON_CSS` carries, so a built-in draws without the package).
 *    The hooks never see them (a theme restyles them through the token; the maps above can replace them);
 * 5. the element's own `renderIconCallback(name, ctx)`, then the page-wide `window.components.renderIconCallback` →
 *    markup, or `null` / `undefined` = not mine (the next one decides) — one multiselect needs no page setup;
 * 6. the component's own defaults (the `defaults` option: its name → icon map);
 * 7. ASCII class names (`fa-solid fa-folder`, `bi-gear`, `material-symbols-outlined`) → `<i class="<prefix>__icon
 *    fa-solid fa-folder" aria-hidden="true">` — an icon font (keen-pure-admin's `<i class={name}>`);
 * 8. anything else (an emoji, a letter in another script) → escaped text.
 *
 * A name not in a map falls through to the next rule. A map value (2, 3, 6) is itself an icon string, resolved by
 * the same rules (a built-in name draws the built-in; a name already met on the way is skipped — `{ a: 'b', b: 'a' }`
 * can't loop, `{ close: 'close' }` draws the built-in).
 *
 * `ICON_CSS` (the `.km-icon` rule) goes into the root the icon renders in (`adoptStyles`).
 */

import { escapeHtml } from './escape-html.js';
import { sharedState } from '../global/shared-state.js';
import { publishPageSetting } from '../global/page-setting.js';
import { runSafely, dispatchToListeners } from '../logging/safe-call.js';
import { coreLog } from '../logging/element-logger.js';

export interface RenderIconOptions {
  /** The component's BEM block: adds `<prefix>__icon` (+ `<prefix>__icon--<name>` on a built-in) to the icon. */
  prefix?: string;
  /**
   * The component host: its `renderIconCallback` is the instance hook, `component` / `element` go into the hooks'
   * context, and a throwing hook is logged through its logger.
   */
  host?: Element | null;
  /**
   * The component name for the hooks' `ctx.component` when the host is not the component's own element (a Svelte /
   * React component renders into a plain `<div>`, whose `localName` says nothing). Default: `host.localName`.
   */
  component?: string;
  /**
   * The instance hook. Omitted → read from `host.renderIconCallback` (the component's input row); pass it explicitly
   * when the component keeps it elsewhere. `null` / `undefined` → no instance hook.
   */
  renderIconCallback?: RenderIconCallback | null;
  /** Component extras for the hooks' context (`{ node }`, `{ item }`), next to `component` / `element` / `prefix`. */
  context?: Readonly<Record<string, unknown>>;
  /**
   * The instance icon map (name → icon string). Omitted → read from `host.icons` (the component's `icons` input
   * row); `null` → none. Non-string values are ignored.
   */
  icons?: Readonly<Record<string, string>> | null;
  /**
   * The component's own icons (its name → icon string: markup, a built-in name, class names) — asked last, after
   * the maps, built-ins and hooks, before the icon-font / text rules. Lets a component name its icons (`'rowDelete'`) so the
   * page can replace them through `el.icons` / `window.components.icons` / the hooks.
   */
  defaults?: Readonly<Record<string, string>> | null;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/** An icon map: a plain object whose values are all strings — the `icons` input row's validator (`toObject({ validate: isIconMap })`). */
export function isIconMap(value: unknown): value is Record<string, string> {
  return isPlainObject(value) && Object.values(value).every((v) => typeof v === 'string');
}

/** What a `renderIconCallback` (instance or page-wide) receives next to the name, + the component's extras. */
export interface IconRenderContext {
  [extra: string]: unknown;
  /** The component's name (`'web-multiselect'`): the `component` option, else the host's tag; `''` without either. */
  component: string;
  /** The component host, when the caller passed it. */
  element: Element | null;
  /** The component's BEM block (`'ms'`), when the caller passed it. */
  prefix: string;
}

/**
 * An icon hook (the element's `renderIconCallback` and the page-wide one share it): map an icon name (`'fa delete'`, `'lucide-rocket'`, `'star'`) to markup, or answer
 * `null` / `undefined` for a name that isn't yours (the next rule decides). A string is used as is (`''` = no icon).
 */
export type RenderIconCallback = (name: string, ctx: IconRenderContext) => string | null | undefined;

/**
 * The built-in names — the base-css-variables `--base-icon-*` glyphs, masked from their token (its contract default
 * when the page has none). No hook sees them,
 * but the icon maps come first: `el.icons` / `window.components.icons` may replace one (`{ close: 'fa-solid fa-xmark' }`).
 * A component may name its own icons with these names (`add`, `delete`).
 */
export const BUILT_IN_ICON_NAMES: readonly string[] = Object.freeze([
  'add', 'bell', 'caret-down', 'caret-up', 'check', 'chevron', 'clear', 'close', 'collapse', 'copy', 'danger',
  'delete', 'download', 'edit', 'ellipsis', 'expand', 'external-link', 'filter', 'indeterminate', 'info', 'link',
  'refresh', 'remove', 'save', 'search', 'settings', 'success', 'user', 'warning',
]);

const BUILT_IN = new Set(BUILT_IN_ICON_NAMES);
const CLASS_LIST = /^[A-Za-z][A-Za-z0-9_-]*(?:\s+[A-Za-z][A-Za-z0-9_-]*)*$/;

// ---------------------------------------------------------------------------
// Page-wide hook: window.components.renderIconCallback (non-enumerable)
// ---------------------------------------------------------------------------

interface IconHookState {
  callback: RenderIconCallback | undefined;
  /**
   * Bumped whenever the page-wide hook changes — lets a re-connecting element tell whether it missed one.
   * Absent on state created by core rc24 and older (added on first use by a newer copy).
   */
  revision?: number;
  /** `observeIconHook` listeners (all copies of core). Absent on state from rc24 and older. */
  listeners?: Set<() => void>;
  /** The accessor this generation of core installs; an accessor with another setter is an older copy's. */
  get?: () => RenderIconCallback | undefined;
  set?: (value: unknown) => void;
  /** The page-wide flat `window.components.icons` map (a frozen copy). Absent on state from rc25 and older. */
  icons?: Readonly<Record<string, string>>;
  /** The `window.components.icons` accessor. Absent on state from rc25 and older. */
  getIcons?: () => Readonly<Record<string, string>> | undefined;
  setIcons?: (value: unknown) => void;
}

/** On globalThis because each component bundles its own core copy. */
const STATE_KEY = '@keenmate/web-components-core:icon';

type LiveIconHookState = Required<Omit<IconHookState, 'icons'>> & Pick<IconHookState, 'icons'>;

function bump(s: IconHookState): void {
  s.revision = (s.revision ?? 0) + 1;
  dispatchToListeners(s.listeners as Set<() => void>, undefined, { message: 'icon hook listener threw' });
}

/** Validate + copy an assigned `window.components.icons`: ONE flat dictionary of strings. */
function freezeIcons(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value == null) return undefined;
  if (!isPlainObject(value)) {
    coreLog(null, 'INIT', 'ELEMENT').warn("window.components.icons must be a flat object ('web-grid.rowDelete': 'fa-solid fa-trash') — ignored");
    return undefined;
  }
  const icons: Record<string, string> = {};
  let isNested = false;
  for (const [key, icon] of Object.entries(value)) {
    if (typeof icon === 'string') icons[key] = icon;
    else isNested = true;
  }
  if (isNested) {
    coreLog(null, 'INIT', 'ELEMENT').warn(
      "window.components.icons is ONE flat dictionary of strings ('web-grid.rowDelete': '…') — other values are ignored",
    );
  }
  return Object.freeze(icons);
}

function state(): LiveIconHookState {
  const s = sharedState<IconHookState>(STATE_KEY, () => ({ callback: undefined }));
  // State created by an older copy of core (rc24 and older) has no revision / listeners / notifying
  // accessor: extend it in place (same key, compatible shape — the older copy still reads `callback`).
  s.revision ??= 0;
  s.listeners ??= new Set();
  if (!s.get || !s.set) {
    s.get = () => s.callback;
    s.set = (value: unknown) => {
      const next = typeof value === 'function' ? (value as RenderIconCallback) : undefined;
      if (next === s.callback) return;
      s.callback = next;
      bump(s);
    };
  }
  if (!s.getIcons || !s.setIcons) {
    s.getIcons = () => s.icons;
    s.setIcons = (value: unknown) => {
      const next = freezeIcons(value);
      if (next === undefined && s.icons === undefined) return;
      s.icons = next;
      bump(s);
    };
  }
  return s as LiveIconHookState;
}

/**
 * Publish `window.components.renderIconCallback` and `window.components.icons` as NON-enumerable accessors (a plain
 * property assigned earlier is adopted). Idempotent; SSR-safe. Called by `registerComponent()` and `renderIcon()`. An accessor an older copy
 * of core installed (its setter stores the callback without notifying anyone) is replaced — the state is shared,
 * so the current callback is kept.
 */
export function publishIconHook(): void {
  const s = state();
  if (typeof window !== 'undefined') {
    const components = (window.components ??= {}) as Record<string, unknown>;
    const existing = Object.getOwnPropertyDescriptor(components, 'renderIconCallback');
    if (existing?.get && existing.set !== s.set && existing.configurable) delete components.renderIconCallback;
  }
  publishPageSetting('renderIconCallback', { get: s.get, set: s.set });
  publishPageSetting('icons', { get: s.getIcons, set: s.setIcons });
}

/** A counter bumped on every change of the page-wide `renderIconCallback` / `icons` — lets a re-connecting element tell whether it missed one. */
export function getIconHookRevision(): number {
  return state().revision;
}

/**
 * Subscribe to changes of the page-wide `window.components.renderIconCallback` (assigned / replaced / cleared —
 * an assignment of the same function is no change) and `window.components.icons` (every assignment); returns the
 * unsubscribe. The page may set the hook after
 * components rendered (load order can't be ensured): re-render the icons. A BlissElement gets this through the
 * `iconsChanged()` hook instead.
 */
export function observeIconHook(listener: () => void): () => void {
  publishIconHook();
  const { listeners } = state();
  const wrapped = (): void => listener();
  listeners.add(wrapped);
  return () => listeners.delete(wrapped);
}

function pageHook(): RenderIconCallback | undefined {
  publishIconHook();
  const cb = typeof window !== 'undefined' ? window.components?.renderIconCallback : state().callback;
  return typeof cb === 'function' ? cb : undefined;
}

function pageIcons(): Readonly<Record<string, string>> | undefined {
  publishIconHook();
  return state().icons;
}

function lookup(map: Readonly<Record<string, unknown>> | null | undefined, key: string): string | undefined {
  if (!map || !Object.prototype.hasOwnProperty.call(map, key)) return undefined;
  const value = map[key];
  return typeof value === 'string' ? value : undefined;
}

// ---------------------------------------------------------------------------
// renderIcon
// ---------------------------------------------------------------------------

/** HTML for an icon value; `''` for none. */
export function renderIcon(icon: string | null | undefined, options: RenderIconOptions = {}): string {
  if (icon == null) return '';
  return resolveIcon(String(icon).trim(), options, new Set());
}

/** A safety cap on map-to-map chains (the `seen` set already stops a loop). */
const MAX_ICON_DEPTH = 16;

function resolveIcon(value: string, options: RenderIconOptions, seen: Set<string>): string {
  if (!value) return '';
  if (value.startsWith('<')) return value;
  const prefix = options.prefix ?? '';
  seen.add(value);
  const host = options.host ?? null;
  const component = options.component ?? host?.localName ?? '';
  // A map hit is an icon string itself — resolved by the same rules, unless it leads back to a name already met
  // (then that map entry is skipped and the next rule decides).
  const follow = (mapped: string | undefined): string | undefined => {
    if (mapped === undefined) return undefined;
    const next = mapped.trim();
    if (seen.has(next) || seen.size >= MAX_ICON_DEPTH) return undefined;
    return resolveIcon(next, options, seen);
  };
  const instanceIcons = 'icons' in options ? options.icons : (host as { icons?: unknown } | null)?.icons;
  const fromInstance = follow(lookup(isPlainObject(instanceIcons) ? instanceIcons : null, value));
  if (fromInstance !== undefined) return fromInstance;
  const page = pageIcons();
  const fromPage = follow((component ? lookup(page, `${component}.${value}`) : undefined) ?? lookup(page, value));
  if (fromPage !== undefined) return fromPage;
  if (BUILT_IN.has(value)) {
    const own = prefix ? ` ${prefix}__icon ${prefix}__icon--${value}` : '';
    return `<span class="km-icon${own}" style="--_km-icon: var(--_km-icon-${value})" aria-hidden="true"></span>`;
  }
  const ownHook = 'renderIconCallback' in options ? options.renderIconCallback : (host as { renderIconCallback?: unknown } | null)?.renderIconCallback;
  const hooks: Array<[unknown, string]> = [
    [ownHook, 'renderIconCallback'],
    [pageHook(), 'window.components.renderIconCallback'],
  ];
  for (const [hook, name] of hooks) {
    if (typeof hook !== 'function') continue;
    const ctx: IconRenderContext = { ...options.context, component, element: host, prefix };
    const result = runSafely(() => (hook as RenderIconCallback)(value, ctx), {
      source: host,
      message: `${name} threw for "${value}" — the next rule decides`,
    });
    if (result.isOk && typeof result.value === 'string') return result.value;
  }
  const fromDefaults = follow(lookup(options.defaults, value));
  if (fromDefaults !== undefined) return fromDefaults;
  if (CLASS_LIST.test(value)) {
    const own = prefix ? `${prefix}__icon ` : '';
    return `<i class="${own}${value.split(/\s+/).join(' ')}" aria-hidden="true"></i>`;
  }
  return escapeHtml(value);
}

/** The `.km-icon` drawing rule (1em square, `currentColor`, masked). Adopt it where named icons render. */
export const ICON_CSS = `
@layer component {
.km-icon {
  display: inline-block;
  flex: none;
  inline-size: 1em;
  block-size: 1em;
  vertical-align: -0.125em;
  background-color: currentColor;
  -webkit-mask: var(--_km-icon) center / contain no-repeat;
  mask: var(--_km-icon) center / contain no-repeat;
  /* The built-in glyphs: the page's --base-icon-<name> when set, else the base-css-variables default
     (byte-identical to the contract, checked by check:contract) — a built-in name draws without the package. */
  --_km-icon-add: var(--base-icon-add, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M5 12h14%22/%3E%3Cpath d=%22M12 5v14%22/%3E%3C/svg%3E"));
  --_km-icon-bell: var(--base-icon-bell, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M10.268 21a2 2 0 0 0 3.464 0%22/%3E%3Cpath d=%22M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326%22/%3E%3C/svg%3E"));
  --_km-icon-caret-down: var(--base-icon-caret-down, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22%23000%22 d=%22M12 15 6 9h12z%22/%3E%3C/svg%3E"));
  --_km-icon-caret-up: var(--base-icon-caret-up, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22%23000%22 d=%22M12 9 6 15h12z%22/%3E%3C/svg%3E"));
  --_km-icon-check: var(--base-icon-check, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M20 6 9 17l-5-5%22/%3E%3C/svg%3E"));
  --_km-icon-chevron: var(--base-icon-chevron, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22m9 18 6-6-6-6%22/%3E%3C/svg%3E"));
  --_km-icon-clear: var(--base-icon-clear, var(--base-icon-close, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M18 6 6 18%22/%3E%3Cpath d=%22m6 6 12 12%22/%3E%3C/svg%3E")));
  --_km-icon-close: var(--base-icon-close, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M18 6 6 18%22/%3E%3Cpath d=%22m6 6 12 12%22/%3E%3C/svg%3E"));
  --_km-icon-collapse: var(--base-icon-collapse, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M5 12h14%22/%3E%3C/svg%3E"));
  --_km-icon-copy: var(--base-icon-copy, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Crect width=%2214%22 height=%2214%22 x=%228%22 y=%228%22 rx=%222%22 ry=%222%22/%3E%3Cpath d=%22M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2%22/%3E%3C/svg%3E"));
  --_km-icon-danger: var(--base-icon-danger, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Ccircle cx=%2212%22 cy=%2212%22 r=%2210%22/%3E%3Cpath d=%22m15 9-6 6%22/%3E%3Cpath d=%22m9 9 6 6%22/%3E%3C/svg%3E"));
  --_km-icon-delete: var(--base-icon-delete, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M3 6h18%22/%3E%3Cpath d=%22M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2%22/%3E%3Cpath d=%22M10 11v6%22/%3E%3Cpath d=%22M14 11v6%22/%3E%3C/svg%3E"));
  --_km-icon-download: var(--base-icon-download, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M12 15V3%22/%3E%3Cpath d=%22M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4%22/%3E%3Cpath d=%22m7 10 5 5 5-5%22/%3E%3C/svg%3E"));
  --_km-icon-edit: var(--base-icon-edit, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z%22/%3E%3C/svg%3E"));
  --_km-icon-ellipsis: var(--base-icon-ellipsis, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Ccircle cx=%2212%22 cy=%2212%22 r=%221%22/%3E%3Ccircle cx=%2219%22 cy=%2212%22 r=%221%22/%3E%3Ccircle cx=%225%22 cy=%2212%22 r=%221%22/%3E%3C/svg%3E"));
  --_km-icon-expand: var(--base-icon-expand, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M5 12h14%22/%3E%3Cpath d=%22M12 5v14%22/%3E%3C/svg%3E"));
  --_km-icon-external-link: var(--base-icon-external-link, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M15 3h6v6%22/%3E%3Cpath d=%22M10 14 21 3%22/%3E%3Cpath d=%22M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6%22/%3E%3C/svg%3E"));
  --_km-icon-filter: var(--base-icon-filter, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpolygon points=%2222 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3%22/%3E%3C/svg%3E"));
  --_km-icon-indeterminate: var(--base-icon-indeterminate, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M5 12h14%22/%3E%3C/svg%3E"));
  --_km-icon-info: var(--base-icon-info, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Ccircle cx=%2212%22 cy=%2212%22 r=%2210%22/%3E%3Cpath d=%22M12 16v-4%22/%3E%3Cpath d=%22M12 8h.01%22/%3E%3C/svg%3E"));
  --_km-icon-link: var(--base-icon-link, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71%22/%3E%3Cpath d=%22M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71%22/%3E%3C/svg%3E"));
  --_km-icon-refresh: var(--base-icon-refresh, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8%22/%3E%3Cpath d=%22M21 3v5h-5%22/%3E%3Cpath d=%22M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16%22/%3E%3Cpath d=%22M3 21v-5h5%22/%3E%3C/svg%3E"));
  --_km-icon-remove: var(--base-icon-remove, var(--base-icon-close, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M18 6 6 18%22/%3E%3Cpath d=%22m6 6 12 12%22/%3E%3C/svg%3E")));
  --_km-icon-save: var(--base-icon-save, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z%22/%3E%3Cpath d=%22M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7%22/%3E%3Cpath d=%22M7 3v4a1 1 0 0 0 1 1h7%22/%3E%3C/svg%3E"));
  --_km-icon-search: var(--base-icon-search, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Ccircle cx=%2211%22 cy=%2211%22 r=%228%22/%3E%3Cpath d=%22m21 21-4.3-4.3%22/%3E%3C/svg%3E"));
  --_km-icon-settings: var(--base-icon-settings, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915%22/%3E%3Ccircle cx=%2212%22 cy=%2212%22 r=%223%22/%3E%3C/svg%3E"));
  --_km-icon-success: var(--base-icon-success, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Ccircle cx=%2212%22 cy=%2212%22 r=%2210%22/%3E%3Cpath d=%22m16 9-5.5 5.5L8 12%22/%3E%3C/svg%3E"));
  --_km-icon-user: var(--base-icon-user, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2%22/%3E%3Ccircle cx=%2212%22 cy=%227%22 r=%224%22/%3E%3C/svg%3E"));
  --_km-icon-warning: var(--base-icon-warning, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3%22/%3E%3Cpath d=%22M12 9v4%22/%3E%3Cpath d=%22M12 17h.01%22/%3E%3C/svg%3E"));
}
@media (forced-colors: active) {
  .km-icon { background-color: CanvasText; forced-color-adjust: none; }
}
}
`;

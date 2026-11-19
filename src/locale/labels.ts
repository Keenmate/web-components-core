/**
 * UI strings (SPEC §12.24, rulebook D-NC-24): one seam every component resolves its texts through.
 *
 * Keys are flat `<elementType>.<name>` (`buttons.add`, `tooltips.clearAll`); the FULL key prefixes the
 * component name: `web-grid.buttons.add`. Per key: the instance `labels` (short key, or the full key — a
 * string, `''` included, wins) → the page-wide flat dictionary `window.components.locale.labels['<full key>']`
 * → the component's built-in English default. A key the instance set is formatted as is (`{name}`); any other
 * goes to `window.components.locale.translateCallback` first (i18next / ICU / the app's own lookup — gets the
 * full key, the resolved template and the RAW params; `null` / `undefined` = "not mine"), else the default
 * `{name}` replacement — a NUMBER param is shown through `formatNumber` (the resolved locale and separators:
 * `12 345` in Czech). Pass a string for a number that mustn't be grouped (a year, an id). Then escaping:
 *
 * - {@link Labels.text} — for `textContent` / attributes: nothing is escaped (text can't inject).
 * - {@link Labels.html} — for `innerHTML`: with `window.components.security.shouldEscapeLabels`
 *   off (default) the template is HTML and the placeholder VALUES are escaped (they are data — a
 *   typed value, a file name); on, the finished label is escaped as a whole.
 */

import { escapeHtml } from '../dom/escape-html.js';
import { callSafely } from '../logging/safe-call.js';
import { getPageLocale, getPageSecurity } from './page-locale.js';
import { resolveLocale } from './settings.js';
import { formatNumber } from './numbers.js';

export type LabelParams = Readonly<Record<string, unknown>>;

export interface Labels<L extends object> {
  /** The resolved template for `key` (unformatted). */
  template(key: keyof L & string): string;
  /** Formatted, NOT escaped — for `textContent`, `aria-label`, `title`, `placeholder`. */
  text(key: keyof L & string, params?: LabelParams): string;
  /** Formatted for `innerHTML` (escaping per `window.components.security.shouldEscapeLabels`). */
  html(key: keyof L & string, params?: LabelParams): string;
  /** Every resolved template — for a renderer that takes a labels object. */
  all(): L;
}

export interface CreateLabelsOptions {
  /**
   * The component name — the prefix of the full keys (`web-grid` → `web-grid.buttons.add`). Pass the
   * component's own name, so a custom tag (`my-grid`) still reads `web-grid.*` from the app dictionary.
   * Default: the host's `localName`.
   */
  tag?: string;
  /** The element's own locale (its `locale` input), for `translateCallback`'s `ctx.locale`. */
  getLocale?: () => string | null | undefined;
}

/** `{name}` → `params.name`; an unknown placeholder stays as written. */
export function formatLabel(template: string, params?: LabelParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name] ?? '') : match));
}

type LabelSource = 'instance' | 'page' | 'default';

/** An instance's `labels`: short keys (`buttons.add`) and / or full keys (`web-grid.buttons.add`). */
export type OwnLabels<L extends object> = Partial<L> | Readonly<Record<string, unknown>> | null | undefined;

function lookup<L extends object>(tag: string, defaults: L, own: OwnLabels<L>, key: keyof L & string): { template: string; source: LabelSource } {
  const full = `${tag}.${key}`;
  const mine = (own as Record<string, unknown> | null | undefined)?.[key] ?? (own as Record<string, unknown> | null | undefined)?.[full];
  if (typeof mine === 'string') return { template: mine, source: 'instance' };
  const page = getPageLocale()?.labels?.[full];
  if (typeof page === 'string') return { template: page, source: 'page' };
  const fallback = defaults[key];
  return { template: typeof fallback === 'string' ? fallback : '', source: 'default' };
}

/**
 * Resolve `key` (short: `buttons.add`): `own[key]` / `own['<tag>.<key>']` → page-wide `labels['<tag>.<key>']`
 * → `defaults[key]`. A string wins (`''` is a deliberate empty label); anything else falls through.
 */
export function resolveLabel<L extends object>(tag: string, defaults: L, own: OwnLabels<L>, key: keyof L & string): string {
  return lookup(tag, defaults, own, key).template;
}

/**
 * The labels of one component instance. `getOwn` reads the instance `labels` input on every call, so
 * a changed input or page-wide object is picked up by the next render (re-render on
 * `localeChanged()` / a `labels` update).
 *
 * ```ts
 * #labels = createLabels(this, DEFAULT_LABELS, () => this.config.labels, { tag: 'web-dropzone', getLocale: () => this.config.locale });
 * button.setAttribute('aria-label', this.#labels.text('ariaLabels.cancelFile', { name: file.name }));
 * row.innerHTML = this.#labels.html('labels.addNew', { value: typed });
 * ```
 */
export function createLabels<L extends object>(
  host: Element,
  defaults: L,
  getOwn: () => OwnLabels<L>,
  options: CreateLabelsOptions = {},
): Labels<L> {
  const tag = options.tag ?? host.localName;
  const own = (): OwnLabels<L> => {
    const value = getOwn();
    return value && typeof value === 'object' ? value : null;
  };
  const template = (key: keyof L & string): string => resolveLabel(tag, defaults, own(), key);

  const format = (key: keyof L & string, params: LabelParams | undefined, isHtml: boolean): string => {
    const { template: raw, source } = lookup(tag, defaults, own(), key);
    const shouldEscapeAll = isHtml && getPageSecurity()?.shouldEscapeLabels === true;
    const values: LabelParams | undefined =
      params && isHtml && !shouldEscapeAll
        ? Object.fromEntries(Object.entries(params).map(([name, v]) => [name, typeof v === 'string' ? escapeHtml(v) : v]))
        : params;
    let out: string | undefined;
    // A key the instance set was written for this element — the app dictionary must not overwrite it.
    const callback = source === 'instance' ? undefined : getPageLocale()?.translateCallback;
    if (typeof callback === 'function') {
      const result = callSafely(
        () => callback({ component: tag, key: `${tag}.${key}`, template: raw, params: values ?? {}, locale: resolveLocale(options.getLocale?.(), host) }),
        { source: host, message: `translateCallback threw for "${tag}.${key}" — using the default formatting` },
      );
      if (result.isOk && typeof result.value === 'string') out = result.value;
    }
    if (out === undefined) {
      // The default display formats numbers for the locale; the callback above gets the raw values.
      const shown = values
        ? Object.fromEntries(
            Object.entries(values).map(([name, v]) => [name, typeof v === 'number' && Number.isFinite(v) ? formatNumber(v, { locale: options.getLocale?.() ?? undefined }) : v]),
          )
        : values;
      out = formatLabel(raw, shown);
    }
    return shouldEscapeAll ? escapeHtml(out) : out;
  };

  return {
    template,
    text: (key, params) => format(key, params, false),
    html: (key, params) => format(key, params, true),
    all: () => {
      const out = {} as Record<string, string>;
      for (const key of Object.keys(defaults)) out[key] = template(key as keyof L & string);
      return out as L;
    },
  };
}

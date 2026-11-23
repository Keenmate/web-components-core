/**
 * Locale-aware text comparison (SPEC §12.24): one cached `Intl.Collator` per resolved locale + options, so a
 * component sorts with the element's `locale` (instance → page-wide → browser) instead of the browser's
 * (`localeCompare()` with no locale).
 */

import { coreLog } from '../logging/element-logger.js';
import { resolveLocale } from './settings.js';

const cache = new Map<string, Intl.Collator>();

/** A stable cache key: the resolved locale + the defined options, sorted by name. */
function cacheKey(locale: string, options: Intl.CollatorOptions | undefined): string {
  const entries = options && typeof options === 'object'
    ? Object.entries(options).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    : [];
  return JSON.stringify([locale, entries]);
}

/**
 * A cached `Intl.Collator` for the resolved locale: `locale` (an element's `locale` input; `'auto'` / empty /
 * `null` = unset) → `window.components.locale.locale` → `navigator.language` → `en-US` — the same rule as
 * `formatNumber` ({@link resolveLocale}; an invalid tag warns through `source`'s logger and falls through).
 * The same locale + options answer the same instance. Never throws: options `Intl` rejects warn and the
 * collator is built without them.
 *
 * ```ts
 * rows.sort((a, b) => getCollator(this.config.locale, { numeric: true }).compare(a.name, b.name));
 * ```
 */
export function getCollator(locale?: string | null, options?: Intl.CollatorOptions, source?: unknown): Intl.Collator {
  const resolved = resolveLocale(locale, source);
  const key = cacheKey(resolved, options);
  let collator = cache.get(key);
  if (collator) return collator;
  try {
    collator = new Intl.Collator(resolved, options);
  } catch (error) {
    coreLog(source ?? null, 'INIT', 'ELEMENT').warn(`invalid collator options ${JSON.stringify(options)} — ignored`, error);
    collator = new Intl.Collator(resolved);
  }
  cache.set(key, collator);
  return collator;
}
